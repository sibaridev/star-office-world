/**
 * Star Office World — Browser-facing UI routes
 *
 * These are standard Fastify routes (NOT AWN peer protocol).
 * Served alongside the AWN peer routes registered by createWorldServer.
 */

import type { FastifyInstance } from "fastify";
import type { OfficeWorldState } from "./types.js";
import type { OfficeAgent } from "./types.js";
import type { SSEManager } from "./sse.js";
import type { MemoStore } from "./memo-store.js";
import type { AgentRuntime } from "./agents/core/AgentRuntime.js";
import type { AIProvider } from "./ai/interfaces/AIProvider.js";
import type { AntigravityBridge } from "./integrations/antigravity/bridge/AntigravityBridge.js";
import { AntigravityMCPServer } from "./integrations/antigravity/mcp/AntigravityMCPServer.js";
import { PromptDiffEngine } from "./agents/prompts/PromptDiffEngine.js";

export interface UIRouteDeps {
  getState: () => OfficeWorldState;
  setAgentState: (
    agentId: string,
    newState: string,
    detail?: string,
  ) => OfficeAgent | null;
  sse: SSEManager;
  memoStore: MemoStore;
  adminPassword: string;
  agentRuntime?: AgentRuntime;
  aiProvider?: AIProvider;
  antigravityBridge?: AntigravityBridge;
}

export function registerUIRoutes(
  fastify: FastifyInstance,
  deps: UIRouteDeps,
): void {
  const { getState, setAgentState, sse, memoStore, adminPassword, agentRuntime, aiProvider } = deps;
  const antigravityBridge = deps.antigravityBridge ?? deps.agentRuntime?.antigravityBridge;
  const mcpServer = antigravityBridge ? new AntigravityMCPServer(antigravityBridge) : null;
  type OwnerSnapshotAgent = OfficeAgent & { isMain?: boolean };

  // ── SSE Stream ───────────────────────────────────────────────────────────

  fastify.get("/ui/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const clientId = sse.addClient(reply);

    // Send full state on connect
    sse.sendTo(clientId, "state", getState());

    // Keep connection open — Fastify won't auto-close raw streams
    // The SSEManager handles cleanup on "close" event
    await new Promise<void>(() => {
      // never resolves — connection stays open until client disconnects
    });
  });

  // ── REST Endpoints ───────────────────────────────────────────────────────

  fastify.get("/ui/state", async () => {
    return getState();
  });

  fastify.get("/ui/agents", async () => {
    const state = getState();
    return {
      ok: true,
      agents: Object.values(state.agents),
      rooms: state.rooms,
    };
  });

  fastify.get("/ui/memo/yesterday", async () => {
    const memo = memoStore.getYesterday();
    if (memo) {
      return { success: true, date: memo.date, memo: memo.entries };
    }
    return { success: false, msg: "No memo found for yesterday" };
  });

  fastify.get("/ui/memo/today", async () => {
    return { success: true, entries: memoStore.getToday() };
  });

  // ── Health ───────────────────────────────────────────────────────────────

  fastify.get("/health", async () => {
    const state = getState();
    return {
      status: "ok",
      service: "star-office-world",
      agents: Object.keys(state.agents).length,
      sseClients: sse.size,
      timestamp: new Date().toISOString(),
    };
  });

  // ── Compat: Flask-style status endpoint ──────────────────────────────────

  fastify.get("/status", async () => {
    const state = getState();
    const agents = Object.values(state.agents) as OwnerSnapshotAgent[];
    const mainAgent = agents.find((a) => a.isMain === true);
    if (!mainAgent) {
      return {
        state: "idle",
        detail: "Waiting...",
        progress: 0,
        updated_at: new Date().toISOString(),
        officeName: state.officeConfig.name,
      };
    }
    return {
      state: mainAgent.state,
      detail: mainAgent.detail,
      progress: 0,
      updated_at: new Date(mainAgent.lastSeenAt).toISOString(),
      officeName: state.officeConfig.name,
    };
  });

  // ── Compat: Flask-style agents list ──────────────────────────────────────

  fastify.get("/agents", async () => {
    const state = getState();
    return Object.values(state.agents).map((a) => ({
      agentId: a.agentId,
      name: a.alias,
      isMain: a.isMain ?? false,
      state: a.state,
      detail: a.detail,
      updated_at: new Date(a.lastSeenAt).toISOString(),
      area: a.area,
      source: "awn-peer",
      authStatus: a.online ? "approved" : "offline",
      lastPushAt: new Date(a.lastSeenAt).toISOString(),
      avatar: a.avatar,
    }));
  });

  // ── Compat: Flask-style yesterday-memo ──────────────────────────────────

  fastify.get("/yesterday-memo", async () => {
    const memo = memoStore.getYesterday();
    if (!memo || memo.entries.length === 0) {
      return { success: false, msg: "No memo found for yesterday" };
    }
    const text = memo.entries
      .map((e) => `[${e.alias}] ${e.content}`)
      .join("\n\n");
    return { success: true, date: memo.date, memo: text };
  });

  // ── Compat: Flask-style set_state (for set_state.py) ─────────────────────

  fastify.post("/set_state", async (req) => {
    const body = req.body as Record<string, unknown>;
    const state = getState();
    // Update first online agent or create a "host" agent
    const agents = Object.values(state.agents);
    let target = agents[0];
    if (!target) {
      return { status: "error", msg: "No agents in office" };
    }
    const nextState =
      typeof body["state"] === "string" ? body["state"] : target.state;
    const nextDetail =
      typeof body["detail"] === "string" ? body["detail"] : target.detail;
    const updated = setAgentState(target.agentId, nextState, nextDetail);
    if (!updated) {
      return { status: "error", msg: "Agent not found" };
    }
    sse.broadcast("agent_update", updated);
    return { status: "ok" };
  });

  // ── Asset drawer auth stubs ──────────────────────────────────────────────

  fastify.get("/assets/auth/status", async (req) => {
    const cookies = (req.headers["cookie"] ?? "") as string;
    const authed = cookies.includes("asset_authed=1");
    return { ok: true, authed };
  });

  fastify.post("/assets/auth", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const pass = (body["password"] as string) ?? "";
    if (pass === adminPassword) {
      reply.header("Set-Cookie", "asset_authed=1; Path=/; HttpOnly; SameSite=Lax");
      return { ok: true };
    }
    return { ok: false, msg: "Incorrect password" };
  });

  fastify.get("/assets/list", async () => {
    return { ok: true, items: [] };
  });

  // ── Admin Auth ───────────────────────────────────────────────────────────

  fastify.post("/ui/admin/login", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const pass = (body["password"] as string) ?? "";
    if (pass === adminPassword) {
      // Simple token — in production use proper session/JWT
      reply.header(
        "Set-Cookie",
        `star_office_admin=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
      );
      return { ok: true };
    }
    reply.code(403);
    return { ok: false, msg: "Incorrect password" };
  });

  // ── AI Agent Runtime & Task API ──────────────────────────────────────────

  fastify.get("/api/gemini/health", async () => {
    if (!aiProvider) {
      return {
        status: "ok",
        provider: "none",
        session: { state: "unauthenticated", authenticated: false, isGuest: true, message: "No AI provider configured", lastValidatedAt: 0 },
        queuedRequests: 0,
        activeRequests: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTimeMs: 0,
      };
    }
    return aiProvider.getHealth();
  });

  fastify.get("/api/agents/runtime", async () => {
    if (!agentRuntime) {
      return { ok: true, agents: [] };
    }
    const agents = agentRuntime.listAgents().map((a) => ({
      agentId: a.agentId,
      name: a.name,
      role: a.role,
      status: a.status,
      visualState: a.lifecycle.officeVisualState,
      avatar: a.config.avatar,
      currentTaskId: a.activeTask?.id ?? null,
      currentTaskTitle: a.activeTask?.title ?? null,
    }));
    return { ok: true, agents };
  });

  fastify.get("/api/tasks", async (req) => {
    if (!agentRuntime) {
      return { ok: true, tasks: [] };
    }
    const query = req.query as Record<string, string> | undefined;
    const tasks = agentRuntime.taskManager.listTasks({
      status: query?.["status"] as any,
      assignedAgentId: query?.["agentId"],
    });
    return { ok: true, tasks };
  });

  fastify.get("/api/tasks/:id", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(404);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { id: string };
    const task = agentRuntime.taskManager.getTask(params.id);
    if (!task) {
      reply.code(404);
      return { ok: false, error: "Task not found" };
    }
    return { ok: true, task };
  });

  fastify.post("/api/tasks", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Agent runtime not initialized." };
    }
    const body = (req.body as Record<string, unknown>) ?? {};
    const title = String(body["title"] ?? "").trim();
    const description = String(body["description"] ?? "").trim();
    const assignedAgentId = body["assignedAgentId"] ? String(body["assignedAgentId"]) : undefined;
    const priority = (body["priority"] as "low" | "medium" | "high") || "medium";

    if (!title || !description) {
      reply.code(400);
      return { ok: false, error: "Both title and description are required." };
    }

    const task = agentRuntime.submitTask({
      title,
      description,
      assignedAgentId,
      priority,
    });

    return { ok: true, task };
  });

  // ── Antigravity Autonomous Coding & MCP Endpoints ─────────────────────────

  fastify.get("/api/antigravity/workspaces", async () => {
    if (!antigravityBridge) {
      return { ok: true, workspaces: [] };
    }
    return { ok: true, workspaces: antigravityBridge.workspaces.listWorkspaces() };
  });

  fastify.post("/api/antigravity/workspaces", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const body = (req.body as Record<string, unknown>) ?? {};
    const workspaceId = String(body["workspaceId"] || `ws_${Date.now()}`);
    const name = String(body["name"] || "Authorized Workspace");
    const wsPath = String(body["path"] || "");
    const allowedOperations = Array.isArray(body["allowedOperations"])
      ? (body["allowedOperations"] as any)
      : ["read", "modify", "test", "git"];
    const permissionPolicy = (body["permissionPolicy"] as any) || "standard";

    if (!wsPath) {
      reply.code(400);
      return { ok: false, error: "Workspace path is required" };
    }

    try {
      const workspace = antigravityBridge.workspaces.registerWorkspace({
        workspaceId,
        name,
        path: wsPath,
        allowedOperations,
        permissionPolicy,
      });
      return { ok: true, workspace };
    } catch (err: unknown) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.get("/api/antigravity/tasks", async (req) => {
    if (!antigravityBridge) {
      return { ok: true, tasks: [] };
    }
    const query = req.query as Record<string, string> | undefined;
    const tasks = antigravityBridge.taskManager.listTasks({
      status: query?.["status"] as any,
      workspaceId: query?.["workspaceId"],
    });
    return { ok: true, tasks };
  });

  fastify.get("/api/antigravity/tasks/:id", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(404);
      return { ok: false, error: "Antigravity Bridge not loaded" };
    }
    const params = req.params as { id: string };
    const task = antigravityBridge.taskManager.getTask(params.id);
    if (!task) {
      reply.code(404);
      return { ok: false, error: "Task not found" };
    }
    return { ok: true, task };
  });

  fastify.post("/api/antigravity/tasks", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const body = (req.body as Record<string, unknown>) ?? {};
    const workspaceId = String(body["workspaceId"] || "");
    const title = String(body["title"] || "");
    const objective = String(body["objective"] || "");
    const assignedAgentId = String(body["assignedAgentId"] || "agent_coordinator");
    const constraints = Array.isArray(body["constraints"]) ? body["constraints"].map(String) : [];
    const acceptanceCriteria = Array.isArray(body["acceptanceCriteria"]) ? body["acceptanceCriteria"].map(String) : [];
    const forbiddenChanges = Array.isArray(body["forbiddenChanges"]) ? body["forbiddenChanges"].map(String) : [];

    if (!workspaceId || !title || !objective) {
      reply.code(400);
      return { ok: false, error: "workspaceId, title, and objective are required" };
    }

    try {
      const task = antigravityBridge.submitEngineeringTask({
        workspaceId,
        title,
        objective,
        requirements: acceptanceCriteria.length > 0 ? acceptanceCriteria : [objective],
        constraints,
        forbiddenChanges,
        assignedOfficeAgentId: assignedAgentId,
      });
      return { ok: true, task };
    } catch (err: unknown) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.post("/api/antigravity/tasks/:id/followup", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const params = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const instruction = String(body["instruction"] || "");
    if (!instruction) {
      reply.code(400);
      return { ok: false, error: "Instruction required" };
    }

    const updated = antigravityBridge.taskManager.submitFollowUp(params.id, instruction);
    if (!updated) {
      reply.code(404);
      return { ok: false, error: "Task not found" };
    }
    return { ok: true, task: updated };
  });

  fastify.post("/api/antigravity/tasks/:id/cancel", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const params = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const reason = String(body["reason"] || "Cancelled via UI");

    const updated = antigravityBridge.taskManager.cancelTask(params.id, reason);
    if (!updated) {
      reply.code(404);
      return { ok: false, error: "Task not found" };
    }
    return { ok: true, task: updated };
  });

  fastify.post("/api/antigravity/mcp", async (req, reply) => {
    if (!mcpServer) {
      reply.code(503);
      return {
        jsonrpc: "2.0",
        id: (req.body as Record<string, unknown>)?.["id"] ?? null,
        error: { code: -32000, message: "Antigravity MCP server not available" },
      };
    }
    const result = await mcpServer.handleJsonRpc((req.body as Record<string, unknown>) || {});
    return result;
  });

  // Diagnostics & E2E Testing
  fastify.get("/api/antigravity/diagnostics", async (_req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const diagnostics = await antigravityBridge.runDiagnostics();
    return { ok: true, diagnostics };
  });

  fastify.post("/api/antigravity/diagnostics/run", async (_req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const diagnostics = await antigravityBridge.runDiagnostics();
    return { ok: true, diagnostics };
  });

  fastify.post("/api/antigravity/test-connection", async (_req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const diagnostics = await antigravityBridge.runDiagnostics();
    return { ok: true, diagnostics };
  });

  fastify.post("/api/antigravity/test-e2e", async (req, reply) => {
    if (!antigravityBridge) {
      reply.code(503);
      return { ok: false, error: "Antigravity Bridge not initialized" };
    }
    const body = (req.body as Record<string, unknown>) ?? {};
    const wsId = body["workspaceId"] ? String(body["workspaceId"]) : undefined;
    try {
      const result = await antigravityBridge.runE2ETest(wsId);
      return { ok: true, result };
    } catch (err: unknown) {
      reply.code(500);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Phase 13: Prompt Introspection, Governance & Self-Improvement ─────────

  fastify.get("/api/prompts/agents", async () => {
    if (!agentRuntime) {
      return { ok: true, agents: [] };
    }
    const agents = agentRuntime.listAgents().map((a) => {
      const activeVer = agentRuntime.promptRegistry.getActiveVersion(a.agentId);
      return {
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        avatar: a.config.avatar,
        description: a.config.description,
        version: activeVer?.version || 1,
        versionId: activeVer?.versionId || "v1",
        hash: activeVer?.hash,
        createdAt: activeVer?.createdAt,
        status: activeVer?.status || "active",
        changeDescription: activeVer?.changeDescription,
      };
    });
    return { ok: true, agents };
  });

  fastify.get("/api/prompts/agents/:agentId/effective", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { agentId: string };
    const agent = agentRuntime.getAgent(params.agentId);
    if (!agent) {
      reply.code(404);
      return { ok: false, error: "Agent not found" };
    }

    const effective = agentRuntime.promptRegistry.getEffectivePrompt(params.agentId);
    const activeVer = agentRuntime.promptRegistry.getActiveVersion(params.agentId);

    return {
      ok: true,
      agent: {
        agentId: agent.agentId,
        name: agent.name,
        role: agent.role,
        avatar: agent.config.avatar,
        description: agent.config.description,
      },
      effectivePrompt: effective,
      versionInfo: activeVer,
    };
  });

  fastify.get("/api/prompts/agents/:agentId/versions", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { agentId: string };
    const versions = agentRuntime.promptRegistry.listVersions(params.agentId);
    return { ok: true, agentId: params.agentId, versions };
  });

  fastify.post("/api/prompts/agents/:agentId/propose", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { agentId: string };
    const body = (req.body as Record<string, unknown>) ?? {};

    const category = (body["category"] as any) || "error_recovery";
    const problemStatement = String(body["problemStatement"] || "");
    const proposedChange = String(body["proposedChange"] || "");
    const expectedImprovement = String(body["expectedImprovement"] || "");
    const observedEvidence = Array.isArray(body["observedEvidence"])
      ? body["observedEvidence"].map(String)
      : ["Manual introspection requested via Star Office Governance Panel."];
    const potentialRisks = body["potentialRisks"] ? String(body["potentialRisks"]) : undefined;
    const author = String(body["author"] || params.agentId);

    if (!problemStatement || !proposedChange || !expectedImprovement) {
      reply.code(400);
      return { ok: false, error: "problemStatement, proposedChange, and expectedImprovement are required" };
    }

    try {
      const proposal = await agentRuntime.proposalManager.createProposal({
        targetAgentId: params.agentId,
        author,
        category,
        problemStatement,
        observedEvidence,
        proposedChange,
        expectedImprovement,
        potentialRisks,
      });

      return { ok: true, proposal };
    } catch (err: unknown) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.get("/api/prompts/proposals", async (req) => {
    if (!agentRuntime) {
      return { ok: true, proposals: [] };
    }
    const query = req.query as Record<string, string> | undefined;
    const proposals = agentRuntime.proposalManager.listProposals({
      targetAgentId: query?.["agentId"],
      status: query?.["status"] as any,
    });
    return { ok: true, proposals };
  });

  fastify.get("/api/prompts/proposals/:id", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(404);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { id: string };
    const proposal = agentRuntime.proposalManager.getProposal(params.id);
    if (!proposal) {
      reply.code(404);
      return { ok: false, error: "Proposal not found" };
    }

    // Compute diff against base version
    const baseVer = agentRuntime.promptRegistry.getVersion(proposal.targetAgentId, proposal.baseVersionId);
    const oldContent = baseVer?.content || "";
    const diff = PromptDiffEngine.computeDiff(oldContent, proposal.proposedChange);

    return { ok: true, proposal, baseVersion: baseVer, diff };
  });

  fastify.post("/api/prompts/proposals/:id/approve", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const actor = String(body["actor"] || "human_owner");

    const result = agentRuntime.proposalManager.approveAndApply(params.id, actor);
    if (!result.success) {
      reply.code(400);
      return { ok: false, error: result.error };
    }
    return { ok: true, versionId: result.versionId };
  });

  fastify.post("/api/prompts/proposals/:id/reject", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const reason = String(body["reason"] || "Rejected by owner.");
    const actor = String(body["actor"] || "human_owner");

    try {
      const ok = agentRuntime.proposalManager.rejectProposal(params.id, reason, actor);
      if (!ok) {
        reply.code(404);
        return { ok: false, error: "Proposal not found" };
      }
      return { ok: true };
    } catch (err: unknown) {
      reply.code(403);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.post("/api/prompts/proposals/:id/revision", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const newContent = String(body["proposedChange"] || "");
    const changeSummary = String(body["summary"] || "Revision based on review.");

    if (!newContent) {
      reply.code(400);
      return { ok: false, error: "proposedChange is required" };
    }

    try {
      const updated = agentRuntime.proposalManager.submitRevision(params.id, newContent, changeSummary);
      if (!updated) {
        reply.code(404);
        return { ok: false, error: "Proposal not found" };
      }
      return { ok: true, proposal: updated };
    } catch (err: unknown) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.post("/api/prompts/agents/:agentId/rollback", async (req, reply) => {
    if (!agentRuntime) {
      reply.code(503);
      return { ok: false, error: "Runtime not loaded" };
    }
    const params = req.params as { agentId: string };
    const body = (req.body as Record<string, unknown>) ?? {};
    const targetVersionId = String(body["targetVersionId"] || "");
    const reason = String(body["reason"] || "Rollback initiated by owner.");
    const actor = String(body["actor"] || "human_owner");

    if (!targetVersionId) {
      reply.code(400);
      return { ok: false, error: "targetVersionId is required" };
    }

    const result = agentRuntime.promptRegistry.rollback(params.agentId, targetVersionId, reason, actor);
    if (!result.success) {
      reply.code(400);
      return { ok: false, error: result.error };
    }
    return { ok: true, version: result.version };
  });

  fastify.post("/api/prompts/diff", async (req) => {
    const body = (req.body as Record<string, unknown>) ?? {};
    const oldText = String(body["oldText"] || "");
    const newText = String(body["newText"] || "");
    return { ok: true, diff: PromptDiffEngine.computeDiff(oldText, newText) };
  });
}
