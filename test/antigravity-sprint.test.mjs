import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../dist/agents/tools/ToolExecutionGateway.js";
import { AgentExecutionContext } from "../dist/agents/core/AgentExecutionContext.js";
import { WorkspaceRegistry } from "../dist/integrations/antigravity/workspaces/WorkspaceRegistry.js";
import { createInitialState, getPublicState, updateBackground } from "../dist/state.js";
import { MemoStore } from "../dist/memo-store.js";
import { SSEManager } from "../dist/sse.js";
import { registerUIRoutes } from "../dist/ui-routes.js";
import { createStarOfficeWorld } from "../dist/index.js";

test("1. ToolExecutionGateway: Blocks path traversal with [SECURITY_VIOLATION]", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-sec-test-"));
  const wsDir = path.join(tmpDir, "workspace");
  fs.mkdirSync(wsDir, { recursive: true });

  const wsRegistry = new WorkspaceRegistry(tmpDir);
  const ws = wsRegistry.registerWorkspace({
    name: "Safe Workspace",
    path: wsDir,
    workspaceId: "safe_ws",
  });

  const toolRegistry = new ToolRegistry();
  const gateway = new ToolExecutionGateway(toolRegistry, tmpDir);

  const context = new AgentExecutionContext({
    agentId: "agent_nova",
    agentName: "Nova",
    taskId: "task_sec_01",
    allowedTools: ["workspace_read_file"],
    permissions: {
      canModifyFiles: true,
      canAccessNetwork: true,
      canCommunicateWithPeers: true,
      canUseAntigravity: true,
      canExecuteCommands: true,
      requiresReview: false,
    },
    dataDir: tmpDir,
    scratchWorkspaceDir: wsDir,
    workspaceId: "safe_ws",
    antigravityBridge: { workspaces: wsRegistry },
  });

  // Attempt to access parent directory outside safe_ws
  const res = await gateway.execute("workspace_read_file", {
    filePath: "../../../sensitive_file.txt",
    workspaceId: "safe_ws",
  }, context);

  assert.equal(res.result.success, false);
  assert.match(res.result.error || "", /\[SECURITY_VIOLATION\]/);
  assert.equal(res.provenance.status, "BLOCKED");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("2. ToolExecutionGateway: Invokes onProvenance listener on execution", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-prov-test-"));
  const toolRegistry = new ToolRegistry();
  
  const recorded = [];
  const gateway = new ToolExecutionGateway(toolRegistry, tmpDir, (prov) => {
    recorded.push(prov);
  });

  const context = new AgentExecutionContext({
    agentId: "agent_researcher",
    agentName: "Robin",
    taskId: "task_prov_01",
    allowedTools: ["workspace_list_files"],
    permissions: {
      canModifyFiles: false,
      canAccessNetwork: false,
      canCommunicateWithPeers: false,
      canUseAntigravity: false,
      canExecuteCommands: false,
      requiresReview: false,
    },
    dataDir: tmpDir,
    scratchWorkspaceDir: tmpDir,
  });

  await gateway.execute("workspace_list_files", {}, context);

  assert.ok(recorded.length > 0);
  assert.equal(recorded[0].taskId, "task_prov_01");
  assert.equal(recorded[0].agentId, "agent_researcher");
  assert.equal(recorded[0].tool, "workspace_list_files");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("3. Admin & Background Management: Set background and async generation queue", async (t) => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-bg-test-"));
  const fastify = Fastify();
  const sse = new SSEManager(60_000);
  const state = createInitialState({});

  registerUIRoutes(fastify, {
    getState: () => getPublicState(state),
    setAgentState: () => null,
    updateBackground: (bg, by) => updateBackground(state, bg, by),
    updateConfig: (cfg) => {
      if (cfg.name) state.officeConfig.name = cfg.name;
      if (cfg.language) state.officeConfig.language = cfg.language;
      if (typeof cfg.maxAgents === "number") state.officeConfig.maxAgents = cfg.maxAgents;
      state.lastUpdated = Date.now();
      return state.officeConfig;
    },
    sse,
    memoStore: new MemoStore(memoryDir),
    adminPassword: "admin-secret-pass",
  });

  t.after(async () => {
    sse.destroy();
    await fastify.close();
    fs.rmSync(memoryDir, { recursive: true, force: true });
  });

  // 1. Set background with password
  const setBgRes = await fastify.inject({
    method: "POST",
    url: "/ui/admin/set-background",
    payload: {
      password: "admin-secret-pass",
      backgroundUrl: "cyberpunk_neon_office.png",
    },
  });
  assert.equal(setBgRes.statusCode, 200);
  assert.equal(setBgRes.json().ok, true);
  assert.equal(state.background.current, "cyberpunk_neon_office.png");

  // 2. Generate background async task
  const genRes = await fastify.inject({
    method: "POST",
    url: "/ui/admin/generate-background",
    payload: {
      password: "admin-secret-pass",
      prompt: "Pixel retro arcade corner",
    },
  });
  assert.equal(genRes.statusCode, 200);
  const genJson = genRes.json();
  assert.equal(genJson.ok, true);
  assert.ok(genJson.taskId);

  // Allow async setImmediate to finish
  await new Promise((r) => setTimeout(r, 60));

  // 3. Poll task status
  const pollRes = await fastify.inject({
    method: "GET",
    url: `/ui/admin/generate-background/poll/${genJson.taskId}`,
  });
  assert.equal(pollRes.statusCode, 200);
  const pollJson = pollRes.json();
  assert.equal(pollJson.ok, true);
  assert.equal(pollJson.task.status, "completed");
  assert.equal(pollJson.task.progress, 100);
  assert.ok(pollJson.task.url);

  // 4. Update office config
  const cfgRes = await fastify.inject({
    method: "POST",
    url: "/ui/admin/config",
    payload: {
      password: "admin-secret-pass",
      name: "Cyberpunk Studio",
      language: "en",
    },
  });
  assert.equal(cfgRes.statusCode, 200);
  assert.equal(cfgRes.json().ok, true);
  assert.equal(state.officeConfig.name, "Cyberpunk Studio");
});

test("4. World Manifest: Delivered via AWN WorldServer protocol", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-manifest-test-"));
  const port = 19992;
  const world = await createStarOfficeWorld({
    worldId: "test-manifest-world",
    port,
    dataDir,
    enableAgentRuntime: false,
  });

  t.after(async () => {
    await world.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const res = await fetch(`http://localhost:${port}/world/manifest`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.type, "programmatic");
  assert.equal(json.theme, "pixel-office");
  assert.equal(json.slug, "test-manifest-world");
});
