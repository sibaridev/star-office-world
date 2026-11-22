/**
 * Star Office World — Entry point
 *
 * Creates an AWN World Server that serves a pixel-art office dashboard.
 * AI agents join via the AWN peer protocol; browsers view via SSE + REST.
 */

import fs from "node:fs";
import path from "node:path";
import { createWorldServer } from "@resciencelab/agent-world-sdk";
import type { WorldServer } from "@resciencelab/agent-world-sdk";
import { loadConfig, resolveConfig } from "./config.js";
import {
  createInitialState,
  getPublicState,
  updateAgentState,
  initSnapshotDir,
  loadAgentsSnapshot,
  rebuildRooms,
} from "./state.js";
import { createOfficeHooks } from "./hooks.js";
import { SSEManager } from "./sse.js";
import { MemoStore } from "./memo-store.js";
import { registerUIRoutes } from "./ui-routes.js";
import type { StarOfficeConfig } from "./types.js";
import { GeminiSessionProvider } from "./ai/providers/gemini/GeminiSessionProvider.js";
import { AgentRuntime } from "./agents/core/AgentRuntime.js";

export { loadConfig, resolveConfig } from "./config.js";
export type { StarOfficeConfig } from "./types.js";
export type {
  OfficeAgent,
  OfficeWorldState,
  AgentState,
  OfficeArea,
  MemoEntry,
  DailyMemo,
} from "./types.js";

export async function createStarOfficeWorld(
  overrides?: Partial<StarOfficeConfig>,
): Promise<WorldServer & { sse: SSEManager; runtime?: AgentRuntime; aiProvider?: GeminiSessionProvider }> {
  const config = await resolveConfig(overrides);
  const dataDir = config.dataDir ?? "./data";
  const state = createInitialState(config);
  const sse = new SSEManager();
  const memoStore = new MemoStore(config.memoryDir ?? "./data/memos");

  // Load yesterday memo into state on startup
  state.yesterdayMemo = memoStore.getYesterday();
  state.todayMemos = memoStore.getToday();

  // Initialize Gemini Session Provider & Agent Runtime if enabled
  let aiProvider: GeminiSessionProvider | undefined;
  let runtime: AgentRuntime | undefined;

  if (config.enableAgentRuntime) {
    aiProvider = new GeminiSessionProvider();
    await aiProvider.initialize();

    runtime = new AgentRuntime({
      officeState: state,
      sse,
      memoStore,
      aiProvider,
      dataDir,
    });
  }

  // Hydrate external agents from last snapshot (all restored as offline)
  initSnapshotDir(dataDir);
  const snapshot = loadAgentsSnapshot(dataDir);
  if (snapshot) {
    for (const agent of Object.values(snapshot)) {
      if (!state.agents[agent.agentId]) {
        state.agents[agent.agentId] = { ...agent, online: false };
      }
    }
    rebuildRooms(state);
    console.log(`[office] Restored ${Object.keys(snapshot).length} agent(s) from snapshot`);
  }

  const hooks = createOfficeHooks({
    state,
    sse,
    memoStore,
    worldId: config.worldId ?? "star-office",
    worldName: config.officeName ?? "Star Office",
    worldTheme: "pixel-office",
    mainAgentId: config.mainAgentId ?? (config.enableAgentRuntime ? "agent_coordinator" : undefined),
  });

  const server = await createWorldServer(
    {
      worldId: config.worldId ?? "star-office",
      worldName: config.officeName ?? "Star Office",
      worldTheme: "pixel-office",
      worldType: "programmatic",
      port: config.port ?? 19000,
      publicPort: config.publicPort,
      publicAddr: config.publicAddr ?? null,
      gatewayUrls: config.gatewayUrls,
      maxAgents: config.maxAgents ?? 20,
      isPublic: config.isPublic ?? true,
      password: config.password ?? "",
      broadcastIntervalMs: config.broadcastIntervalMs ?? 3000,
      dataDir: config.dataDir ?? "./data",
      cardUrl: config.publicAddr
        ? `http://${config.publicAddr}:${config.publicPort ?? config.port ?? 19000}/.well-known/agent.json`
        : undefined,
      cardName: config.officeName ?? "Star Office",
      cardDescription:
        "A pixel-art AI office dashboard on the Agent World Network",
      setupRoutes: async (fastify) => {
        // Register browser-facing routes
        registerUIRoutes(fastify, {
          getState: () => getPublicState(state),
          setAgentState: (agentId, newState, detail) =>
            updateAgentState(state, agentId, newState, detail),
          sse,
          memoStore,
          adminPassword: config.adminPassword ?? "1234",
          agentRuntime: runtime,
          aiProvider,
          antigravityBridge: runtime?.antigravityBridge,
        });

        // Serve static frontend files
        const frontendDir = path.resolve(
          config.frontendDir ?? "./frontend",
        );
        try {
          const staticPlugin = await import("@fastify/static");
          await fastify.register(staticPlugin.default, {
            root: frontendDir,
            prefix: "/",
            decorateReply: false,
          });
        } catch (err) {
          console.warn(
            `[office] Could not register static file serving from ${frontendDir}:`,
            err,
          );
        }

        // CORS for browser access
        try {
          const corsPlugin = await import("@fastify/cors");
          await fastify.register(corsPlugin.default, { origin: true });
        } catch {
          // optional
        }
      },
    },
    hooks,
  );

  console.log(`[office] Star Office World running on port ${config.port ?? 19000}`);
  console.log(`[office] Frontend: http://localhost:${config.port ?? 19000}/`);
  console.log(`[office] SSE: http://localhost:${config.port ?? 19000}/ui/events`);
  console.log(`[office] Health: http://localhost:${config.port ?? 19000}/health`);

  // Wrap stop to also destroy SSE, runtime, and aiProvider
  const originalStop = server.stop.bind(server);
  return {
    ...server,
    sse,
    runtime,
    aiProvider,
    async stop() {
      if (runtime) runtime.shutdown();
      if (aiProvider) await aiProvider.shutdown();
      sse.destroy();
      await originalStop();
    },
  };
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

const isMain =
  Boolean(process.argv[1] && /[/\\]index\.(ts|js)$/.test(process.argv[1]));

if (isMain) {
  if (typeof process.loadEnvFile === "function" && fs.existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // ignore
    }
  }
  createStarOfficeWorld({ enableAgentRuntime: true }).catch((err) => {
    console.error("Failed to start Star Office World:", err);
    process.exit(1);
  });
}
