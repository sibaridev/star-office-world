import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createStarOfficeWorld } from "../dist/index.js";
import { WorkspaceRegistry } from "../dist/integrations/antigravity/workspaces/WorkspaceRegistry.js";
import { AntigravityTaskManager } from "../dist/integrations/antigravity/tasks/AntigravityTaskManager.js";
import { AntigravityBridge } from "../dist/integrations/antigravity/bridge/AntigravityBridge.js";
import { AntigravityMCPServer } from "../dist/integrations/antigravity/mcp/AntigravityMCPServer.js";
import { SSEManager } from "../dist/sse.js";
import { MemoStore } from "../dist/memo-store.js";
import { createInitialState } from "../dist/state.js";

function setupTestEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-ag-test-"));
  const workspaceA = path.join(tempDir, "workspace-a");
  const workspaceB = path.join(tempDir, "workspace-b");
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });

  const sse = new SSEManager(60_000);
  const memoStore = new MemoStore(path.join(tempDir, "memos"));
  const officeState = createInitialState({
    worldId: "test-world",
    port: 19999,
  });

  const bridge = new AntigravityBridge({
    officeState,
    sse,
    memoStore,
    dataDir: tempDir,
  });

  return { tempDir, workspaceA, workspaceB, bridge, sse, memoStore, officeState };
}

test("Phase 12 [1 & 13]: Antigravity MCP Server — JSON-RPC initialize, tools/list, and tool execution", async (t) => {
  const { bridge, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  const mcpServer = new AntigravityMCPServer(bridge);

  // 1. Initialize
  const initRes = await mcpServer.handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  assert.equal(initRes["jsonrpc"], "2.0");
  assert.equal(initRes["id"], 1);
  const result = initRes["result"];
  assert.ok(result);
  assert.equal(result.serverInfo.name, "star-office-antigravity-mcp");

  // 2. tools/list
  const toolsRes = await mcpServer.handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.ok(toolsRes["result"].tools);
  assert.ok(toolsRes["result"].tools.length >= 8);
  const toolNames = toolsRes["result"].tools.map((item) => item.name);
  assert.ok(toolNames.includes("list_pending_office_tasks"));
  assert.ok(toolNames.includes("claim_pending_office_task"));
  assert.ok(toolNames.includes("submit_task_results"));
});

test("Phase 12 [2, 3, 14, 15]: Workspace Registry — Discovery, Authorization, Isolation, and Path Traversal Security", async () => {
  const { tempDir, workspaceA, workspaceB } = setupTestEnv();
  const registry = new WorkspaceRegistry(tempDir);

  // 2 & 3. Register authorized workspace
  const ws1 = registry.registerWorkspace({
    workspaceId: "ws_alpha",
    name: "Alpha Project",
    path: workspaceA,
    allowedOperations: ["read", "modify", "test"],
    permissionPolicy: "strict",
  });
  assert.equal(ws1.workspaceId, "ws_alpha");
  assert.equal(ws1.name, "Alpha Project");
  assert.equal(registry.isAuthorizedPath("ws_alpha", path.join(workspaceA, "src", "index.ts")), true);

  // 14. Multiple workspace isolation
  const ws2 = registry.registerWorkspace({
    workspaceId: "ws_beta",
    name: "Beta Project",
    path: workspaceB,
    allowedOperations: ["read"],
    permissionPolicy: "read-only",
  });
  assert.notEqual(ws1.workspaceId, ws2.workspaceId);
  // Cross-workspace access should be unauthorized
  assert.equal(registry.isAuthorizedPath("ws_alpha", path.join(workspaceB, "secret.ts")), false);
  assert.equal(registry.isAuthorizedPath("ws_beta", path.join(workspaceA, "secret.ts")), false);

  // 15. Security & Path Traversal Prevention
  assert.equal(registry.isAuthorizedPath("ws_alpha", path.join(workspaceA, "..", "escape.ts")), false);
  assert.equal(registry.isAuthorizedPath("ws_alpha", "C:\\Windows\\System32"), false);

  // Registering non-existent path throws
  assert.throws(() => {
    registry.registerWorkspace({
      workspaceId: "ws_invalid",
      name: "Invalid",
      path: path.join(tempDir, "does-not-exist"),
      allowedOperations: ["read"],
      permissionPolicy: "standard",
    });
  });
});

test("Phase 12 [4 & 5]: Task Submission, Structured Engineering Prompt, and Status Lifecycle", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_eng",
    name: "Engineering WS",
    path: workspaceA,
    allowedOperations: ["read", "modify", "test", "git"],
    permissionPolicy: "standard",
  });

  // 4. Submit task with rigorous prompt requirements
  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_eng",
    title: "Implement Auth Token Validator",
    objective: "Create a secure session token verifier with replay protection",
    requirements: ["Unit tests cover expired tokens", "No plaintext storage"],
    constraints: ["Zero external network requests", "Execution under 50ms"],
    forbiddenChanges: ["Do not alter package.json", "Do not modify legacy routes"],
    assignedOfficeAgentId: "agent_coordinator",
  });

  assert.ok(task.id.startsWith("ag_task_"));
  assert.ok(["QUEUED", "READY_FOR_SUBMISSION", "SUBMITTED_TO_ANTIGRAVITY", "ACCEPTED_BY_ANTIGRAVITY"].includes(task.status));

  // Verify prompt structure
  assert.ok(task.engineeringPrompt.includes("### 1. EXACT OBJECTIVE"));
  assert.ok(task.engineeringPrompt.includes("### 2. IMPLEMENTATION REQUIREMENTS"));
  assert.ok(task.engineeringPrompt.includes("### 4. ARCHITECTURAL & SECURITY CONSTRAINTS"));
  assert.ok(task.engineeringPrompt.includes("### 5. FORBIDDEN CHANGES"));
  assert.ok(task.engineeringPrompt.includes("Zero external network requests"));
  assert.ok(task.engineeringPrompt.includes("Do not alter package.json"));

  // 5. Lifecycle transitions
  const submitted = bridge.taskManager.updateStatus(task.id, "SUBMITTED", "Dispatched to Antigravity");
  assert.equal(submitted?.status, "SUBMITTED");

  const accepted = bridge.taskManager.updateStatus(task.id, "ACCEPTED", "Antigravity accepted task");
  assert.equal(accepted?.status, "ACCEPTED");

  const running = bridge.taskManager.updateStatus(task.id, "RUNNING", "Running unit tests", 45);
  assert.equal(running?.status, "RUNNING");
  assert.equal(running?.progress, 45);

  const reviewReq = bridge.taskManager.updateStatus(task.id, "REVIEW_REQUIRED", "Changes staged for inspection");
  assert.equal(reviewReq?.status, "REVIEW_REQUIRED");
});

test("Phase 12 [6, 8, 9]: MCP Two-Way Interaction — Progress, Diff, Test Results, and Completion", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_test",
    name: "Test Workspace",
    path: workspaceA,
    allowedOperations: ["read", "modify", "test", "git"],
    permissionPolicy: "standard",
  });

  const mcpServer = new AntigravityMCPServer(bridge);

  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_test",
    title: "Refactor Logger",
    objective: "Migrate logger to structured format",
    requirements: ["Support JSON output"],
    assignedOfficeAgentId: "agent_writer",
  });

  // 1. List pending tasks via MCP
  const listRes = await mcpServer.executeTool("list_pending_office_tasks", {});
  assert.ok(listRes.content[0].text.includes(task.id));

  // 2. Claim task via MCP
  const claimRes = await mcpServer.executeTool("claim_pending_office_task", {
    taskId: task.id,
    antigravitySessionId: "ag_session_123",
  });
  assert.ok(!claimRes.isError);
  assert.equal(bridge.taskManager.getTask(task.id)?.status, "ACCEPTED");

  // 6. Report progress via MCP
  const progRes = await mcpServer.executeTool("report_office_task_progress", {
    taskId: task.id,
    progress: 75,
    message: "Logger formatted, running test suite",
  });
  assert.ok(!progRes.isError);
  const updatedTask = bridge.taskManager.getTask(task.id);
  assert.equal(updatedTask?.status, "RUNNING");
  assert.equal(updatedTask?.progress, 75);

  // 8 & 9. Submit task results with Git Diff and Test Results via MCP
  const mockDiff = "--- a/logger.ts\n+++ b/logger.ts\n@@ -1,2 +1,2 @@\n-console.log(m)\n+process.stdout.write(JSON.stringify(m))";
  const mockTests = "✔ 12 tests passed, 0 failures";

  const submitRes = await mcpServer.executeTool("submit_task_results", {
    taskId: task.id,
    result: "Successfully migrated logger to JSON-RPC formatting.",
    diff: mockDiff,
    testResults: mockTests,
  });
  assert.ok(!submitRes.isError);

  const finalTask = bridge.taskManager.getTask(task.id);
  assert.equal(finalTask?.status, "COMPLETED");
  assert.equal(finalTask?.progress, 100);
  assert.equal(finalTask?.diff, mockDiff);
  assert.equal(finalTask?.testResults, mockTests);
  assert.ok(finalTask?.completedAt);
});

test("Phase 12 [7]: Follow-up Instructions Delivery", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_fu",
    name: "Followup WS",
    path: workspaceA,
    allowedOperations: ["read", "modify"],
    permissionPolicy: "standard",
  });

  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_fu",
    title: "Initial Feature",
    objective: "Implement basic endpoint",
    requirements: ["Basic endpoint"],
  });

  bridge.taskManager.updateStatus(task.id, "REVIEW_REQUIRED", "Please review PR");

  // 7. Deliver follow-up prompt
  const updated = bridge.taskManager.submitFollowUp(task.id, "Please add rate limiting headers to the endpoint response.");
  assert.ok(updated);
  assert.equal(updated.status, "SUBMITTED");
  const lastEvent = updated.events[updated.events.length - 1];
  assert.equal(lastEvent.type, "followup_instruction");
  assert.ok(lastEvent.message.includes("rate limiting headers"));
});

test("Phase 12 [10]: Task Cancellation", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_canc",
    name: "Cancel WS",
    path: workspaceA,
    allowedOperations: ["read"],
    permissionPolicy: "standard",
  });

  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_canc",
    title: "Unneeded Feature",
    objective: "Will be cancelled",
    requirements: ["None"],
  });

  const cancelled = bridge.taskManager.cancelTask(task.id, "Requirements superseded by user");
  assert.ok(cancelled);
  assert.equal(cancelled.status, "CANCELLED");
  assert.ok(cancelled.error?.includes("Requirements superseded"));
});

test("Phase 12 [11]: Error Recovery and Failed State Handling", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());
  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_err",
    name: "Error WS",
    path: workspaceA,
    allowedOperations: ["read", "modify", "test"],
    permissionPolicy: "standard",
  });

  const mcpServer = new AntigravityMCPServer(bridge);
  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_err",
    title: "Failing Feature",
    objective: "Trigger compile failure",
    requirements: ["Trigger failure"],
  });

  // Report error via MCP
  const errRes = await mcpServer.executeTool("report_task_error", {
    taskId: task.id,
    error: "SyntaxError: Unexpected identifier at line 42",
  });
  assert.ok(!errRes.isError);

  const failedTask = bridge.taskManager.getTask(task.id);
  assert.equal(failedTask?.status, "FAILED");
  assert.ok(failedTask?.error?.includes("SyntaxError"));
});

test("Phase 12 [12]: Application Restart Recovery — Interrupted Tasks Recovery", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-restart-test-"));
  const tasksDir = path.join(tempDir, "antigravity", "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  // Manually write an in-progress task as if the server died mid-execution
  const interruptedTask = {
    id: "ag_task_crash_1",
    workspaceId: "ws_crash",
    title: "Crash Recovery Test",
    engineeringPrompt: "Prompt",
    status: "RUNNING",
    progress: 50,
    progressMessage: "Processing...",
    assignedOfficeAgentId: "agent_coordinator",
    events: [],
    clarifications: [],
    followUpInstructions: [],
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 5000,
  };
  fs.writeFileSync(path.join(tasksDir, `${interruptedTask.id}.json`), JSON.stringify(interruptedTask));

  // Instantiate new TaskManager simulating startup
  const taskManager = new AntigravityTaskManager(tempDir);
  const recovered = taskManager.getTask("ag_task_crash_1");

  assert.ok(recovered);
  assert.equal(recovered.status, "INTERRUPTED");
  assert.ok(recovered.error?.includes("restarted"));
});

test("Phase 12: Star Office World HTTP API End-to-End for Antigravity", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-e2e-test-"));
  const port = 19688;

  const server = await createStarOfficeWorld({
    port,
    publicPort: port,
    dataDir: tempDir,
    memoryDir: path.join(tempDir, "memos"),
    worldId: "test-ag-api-world",
    isPublic: false,
    enableAgentRuntime: true,
  });

  try {
    const baseUrl = `http://localhost:${port}`;
    const closeHeaders = { Connection: "close" };

    // 1. GET /api/antigravity/workspaces
    const wsRes = await fetch(`${baseUrl}/api/antigravity/workspaces`, { headers: closeHeaders });
    assert.equal(wsRes.status, 200);
    const wsData = await wsRes.json();
    assert.equal(wsData.ok, true);
    assert.ok(Array.isArray(wsData.workspaces));
    assert.ok(wsData.workspaces.length >= 1, "Default workspace must be auto-registered");

    // 2. POST /api/antigravity/tasks
    const createRes = await fetch(`${baseUrl}/api/antigravity/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...closeHeaders },
      body: JSON.stringify({
        workspaceId: wsData.workspaces[0].workspaceId,
        title: "E2E Coding Delegation",
        objective: "Verify HTTP task dispatch",
        constraints: ["Must pass HTTP tests"],
        acceptanceCriteria: ["HTTP 200 returned"],
      }),
    });
    assert.equal(createRes.status, 200);
    const createData = await createRes.json();
    assert.equal(createData.ok, true);
    const taskId = createData.task.id;
    assert.ok(taskId);

    // 3. POST /api/antigravity/mcp (HTTP JSON-RPC)
    const mcpRes = await fetch(`${baseUrl}/api/antigravity/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...closeHeaders },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "report_office_task_progress",
          arguments: {
            taskId,
            progress: 88,
            message: "Running through HTTP MCP proxy",
          },
        },
      }),
    });
    assert.equal(mcpRes.status, 200);
    const mcpData = await mcpRes.json();
    assert.equal(mcpData.id, 42);
    assert.ok(!mcpData.error);

    // 4. GET /api/antigravity/tasks/:id
    const taskRes = await fetch(`${baseUrl}/api/antigravity/tasks/${taskId}`, { headers: closeHeaders });
    assert.equal(taskRes.status, 200);
    const taskData = await taskRes.json();
    assert.equal(taskData.task.progress, 88);
    assert.equal(taskData.task.status, "RUNNING");

    // 5. POST /api/antigravity/tasks/:id/cancel
    const cancelRes = await fetch(`${baseUrl}/api/antigravity/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...closeHeaders },
      body: JSON.stringify({ reason: "Finished test suite" }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.task.status, "CANCELLED");
  } finally {
    await server.stop();
  }
});

test("Antigravity Real Connection: 8-Point Diagnostics Verification", async (t) => {
  const { bridge, sse } = setupTestEnv();
  t.after(() => sse.destroy());

  const diag = await bridge.runDiagnostics();
  assert.ok(diag);
  assert.ok(["CONNECTED", "CONNECTING", "NOT_CONFIGURED", "NOT_INSTALLED", "AUTHENTICATION_REQUIRED"].includes(diag.overallStatus));
  assert.ok(typeof diag.summary === "string");
  assert.ok(diag.capabilities);

  // Check all 8 required capabilities
  const capKeys = [
    "installationDetection",
    "supportedInterfaceDetection",
    "processAvailability",
    "authenticationReadiness",
    "workspaceDiscovery",
    "taskSubmissionCapability",
    "executionStatusRetrieval",
    "resultRetrieval",
  ];

  for (const key of capKeys) {
    const cap = diag.capabilities[key];
    assert.ok(cap, `Capability ${key} must be defined`);
    assert.ok(typeof cap.name === "string");
    assert.ok(typeof cap.status === "string");
    assert.ok(typeof cap.details === "string");
  }
});

test("Antigravity Real Connection: Tool Execution check_antigravity_bridge", async (t) => {
  const { bridge, sse, tempDir } = setupTestEnv();
  t.after(() => sse.destroy());

  const { checkAntigravityBridgeTool } = await import("../dist/agents/tools/builtins/AntigravityTools.js");
  const result = await checkAntigravityBridgeTool.execute({}, {
    agentId: "agent_coordinator",
    agentName: "Alex",
    taskId: "test_task",
    dataDir: tempDir,
    workspaceDir: tempDir,
    antigravityBridge: bridge,
  });

  assert.equal(result.success, true);
  assert.ok(result.output.includes("Google Antigravity Bridge Status"));
  assert.ok(result.output.includes("Capabilities"));
  assert.ok(result.output.includes("How Access Works"));
});

test("Antigravity Real Connection: Workspace Inspection and Non-Empty/Empty Verification", async (t) => {
  const { bridge, tempDir, sse } = setupTestEnv();
  t.after(() => sse.destroy());

  const emptyWsDir = path.join(tempDir, "empty-ws");
  fs.mkdirSync(emptyWsDir, { recursive: true });

  const ws = bridge.workspaces.registerWorkspace({
    workspaceId: "ws_empty_test",
    name: "Empty Workspace",
    path: emptyWsDir,
  });

  const inspection = bridge.workspaces.inspectWorkspace(ws.workspaceId);
  assert.equal(inspection.exists, true);
  assert.equal(inspection.isEmpty, true);
  assert.equal(inspection.fileCount, 0);

  // Write a file and re-inspect
  fs.writeFileSync(path.join(emptyWsDir, "index.ts"), "console.log('hello');");
  const reInspection = bridge.workspaces.inspectWorkspace(ws.workspaceId);
  assert.equal(reInspection.isEmpty, false);
  assert.equal(reInspection.fileCount, 1);
});

test("Antigravity Real Connection: Strict Task Completion Semantics", async (t) => {
  const { bridge, workspaceA, sse } = setupTestEnv();
  t.after(() => sse.destroy());

  bridge.workspaces.registerWorkspace({
    workspaceId: "ws_semantics",
    name: "Semantics WS",
    path: workspaceA,
  });

  const task = bridge.submitEngineeringTask({
    workspaceId: "ws_semantics",
    title: "Semantics Verification",
    objective: "Ensure task cannot be completed falsely",
    requirements: ["Must have real execution deliverable"],
    assignedOfficeAgentId: "agent_writer",
  });

  // Task must NOT be marked COMPLETED at creation
  assert.notEqual(task.status, "COMPLETED");

  // Attempting to complete task requires valid result
  const completed = bridge.taskManager.completeTask(task.id, {
    result: "Verified code output and changes implemented",
    diff: "diff --git a/file b/file",
    testResults: "All 10 tests passed",
  });

  assert.ok(completed);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.progress, 100);
  assert.ok(completed.result);
  assert.ok(completed.diff);
  assert.ok(completed.completedAt);
});

test("Antigravity Master Agent (Nova): Full Access and Antigravity Tool Suite", async (t) => {
  const { bridge, sse, tempDir } = setupTestEnv();
  t.after(() => sse.destroy());

  const { DEFAULT_AGENTS } = await import("../dist/agents/core/AgentRegistry.js");
  const nova = DEFAULT_AGENTS.find((a) => a.agentId === "agent_nova");
  assert.ok(nova, "Nova (agent_nova) must be configured in DEFAULT_AGENTS");
  assert.equal(nova.name, "Nova");
  assert.equal(nova.role, "Antigravity Principal Engineer & Master");
  assert.equal(nova.avatar, "guest_role_5");

  const expectedTools = [
    "check_antigravity_bridge",
    "delegate_to_antigravity",
    "run_antigravity_e2e_test",
    "list_antigravity_tasks",
    "get_antigravity_task_details",
    "cancel_antigravity_task",
    "inspect_antigravity_workspace",
  ];

  for (const toolName of expectedTools) {
    assert.ok(nova.allowedTools.includes(toolName), `Nova must have access to ${toolName}`);
  }

  // Test list_antigravity_tasks tool execution
  const { listAntigravityTasksTool, inspectAntigravityWorkspaceTool } = await import(
    "../dist/agents/tools/builtins/AntigravityTools.js"
  );

  const listRes = await listAntigravityTasksTool.execute({}, {
    agentId: "agent_nova",
    agentName: "Nova",
    taskId: "test_task",
    dataDir: tempDir,
    workspaceDir: tempDir,
    antigravityBridge: bridge,
  });
  assert.equal(listRes.success, true);

  // Test inspect_antigravity_workspace tool execution
  const inspectRes = await inspectAntigravityWorkspaceTool.execute(
    { workspaceId: "default_workspace" },
    {
      agentId: "agent_nova",
      agentName: "Nova",
      taskId: "test_task",
      dataDir: tempDir,
      workspaceDir: tempDir,
      antigravityBridge: bridge,
    }
  );
  assert.equal(inspectRes.success, true);
  assert.ok(inspectRes.output.includes("Workspace Inspection"));
});

