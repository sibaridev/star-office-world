/**
 * Star Office World — Subagent Tool Access & Anti-False Completion Regression Test Suite
 * Validates execution context propagation, ToolExecutionGateway, provenance tracking,
 * workspace inspection tools, false completion prevention, and incident reproduction.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../dist/agents/tools/ToolExecutionGateway.js";
import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { AgentExecutionContext } from "../dist/agents/core/AgentExecutionContext.js";
import { CompletionVerifier } from "../dist/agents/tasks/CompletionVerifier.js";
import { WorkspaceRegistry } from "../dist/integrations/antigravity/workspaces/WorkspaceRegistry.js";
import { DEFAULT_PERMISSIONS } from "../dist/agents/management/AgentConfigManager.js";

function createTempDir(prefix = "subagent-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("1. Centralized AgentExecutionContext derives child context with capability propagation", () => {
  const testDir = createTempDir();
  const parentContext = new AgentExecutionContext({
    agentId: "agent_coordinator",
    agentName: "Alex",
    taskId: "task_parent_1",
    workspaceId: "default_workspace",
    workspacePath: "C:\\Users\\Sibari\\Desktop\\AI-ROOM",
    allowedTools: [
      "check_antigravity_bridge",
      "delegate_to_antigravity",
      "workspace_list_files",
      "send_agent_message",
    ],
    permissions: DEFAULT_PERMISSIONS,
    acceptanceCriteria: ["Audit repository structure", "Verify git status"],
    requiredTools: ["get_antigravity_workspace_git_status", "list_antigravity_workspace_files"],
    dataDir: testDir,
    scratchWorkspaceDir: path.join(testDir, "workspace"),
  });

  assert.equal(parentContext.agentId, "agent_coordinator");
  assert.equal(parentContext.workspaceId, "default_workspace");
  assert.equal(parentContext.workspacePath, "C:\\Users\\Sibari\\Desktop\\AI-ROOM");
  assert.equal(parentContext.acceptanceCriteria.length, 2);

  // Derive child context for Nova
  const childContext = parentContext.deriveChildContext({
    childAgentId: "agent_nova",
    childAgentName: "Nova",
    childTaskId: "task_child_1",
    childAllowedTools: [
      "check_antigravity_bridge",
      "list_antigravity_workspace_files",
      "read_antigravity_workspace_file",
      "get_antigravity_workspace_git_status",
    ],
    childPermissions: DEFAULT_PERMISSIONS,
  });

  assert.equal(childContext.agentId, "agent_nova");
  assert.equal(childContext.parentTaskId, "task_parent_1");
  assert.equal(childContext.workspaceId, "default_workspace");
  assert.equal(childContext.workspacePath, "C:\\Users\\Sibari\\Desktop\\AI-ROOM");
  assert.deepEqual(childContext.acceptanceCriteria, ["Audit repository structure", "Verify git status"]);
  assert.deepEqual(childContext.requiredTools, ["get_antigravity_workspace_git_status", "list_antigravity_workspace_files"]);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("2. ToolExecutionGateway enforces full lifecycle and provenance logging", async () => {
  const testDir = createTempDir();
  const toolRegistry = new ToolRegistry();
  const gateway = new ToolExecutionGateway(toolRegistry, testDir);

  const mockBridge = {
    runDiagnostics: async () => ({
      overallStatus: "CONNECTED",
      summary: "Ready",
      runningProcesses: [],
      capabilities: {
        installationDetection: { status: "AVAILABLE", details: "ok" },
        supportedInterfaceDetection: { status: "AVAILABLE", details: "ok" },
        processAvailability: { status: "AVAILABLE", details: "ok" },
        authenticationReadiness: { status: "AVAILABLE", details: "ok" },
        workspaceDiscovery: { status: "AVAILABLE", details: "ok" },
        taskSubmissionCapability: { status: "AVAILABLE", details: "ok" },
        executionStatusRetrieval: { status: "AVAILABLE", details: "ok" },
        resultRetrieval: { status: "AVAILABLE", details: "ok" },
      },
    }),
    workspaces: { listWorkspaces: () => [] },
  };

  const context = new AgentExecutionContext({
    agentId: "agent_nova",
    agentName: "Nova",
    taskId: "task_exec_1",
    workspaceId: "default_workspace",
    workspacePath: process.cwd(),
    allowedTools: ["check_antigravity_bridge", "workspace_list_files"],
    permissions: DEFAULT_PERMISSIONS,
    dataDir: testDir,
    scratchWorkspaceDir: path.join(testDir, "workspace"),
    antigravityBridge: mockBridge,
  });

  // Execute authorized tool
  const { result, provenance } = await gateway.execute("check_antigravity_bridge", {}, context);

  assert.ok(provenance.executionId);
  assert.equal(provenance.taskId, "task_exec_1");
  assert.equal(provenance.agentId, "agent_nova");
  assert.equal(provenance.tool, "check_antigravity_bridge");
  assert.ok(provenance.requestedAt > 0);
  assert.ok(provenance.authorizedAt > 0);
  assert.ok(provenance.startedAt > 0);
  assert.ok(provenance.completedAt > 0);
  assert.equal(provenance.status, "COMPLETED");
  assert.ok(result.success);

  // Check persisted provenance records
  const recorded = gateway.getProvenance("task_exec_1");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].executionId, provenance.executionId);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("3. ToolExecutionGateway blocks unauthorized tools and prevents path traversal", async () => {
  const testDir = createTempDir();
  const toolRegistry = new ToolRegistry();
  const gateway = new ToolExecutionGateway(toolRegistry, testDir);

  // Context without file modification permission
  const restrictedContext = new AgentExecutionContext({
    agentId: "agent_restricted",
    agentName: "Restricted",
    taskId: "task_rest_1",
    workspaceId: "default_workspace",
    workspacePath: process.cwd(),
    allowedTools: ["workspace_write_file"],
    permissions: {
      ...DEFAULT_PERMISSIONS,
      canModifyFiles: false,
    },
    dataDir: testDir,
    scratchWorkspaceDir: path.join(testDir, "workspace"),
  });

  const writeRes = await gateway.execute("workspace_write_file", { path: "bad.txt", content: "evil" }, restrictedContext);
  assert.equal(writeRes.result.success, false);
  assert.equal(writeRes.provenance.status, "BLOCKED");
  assert.match(writeRes.result.error || "", /lacks 'canModifyFiles' permission/);

  // Path traversal check with mock Antigravity workspace
  const wsRegistry = new WorkspaceRegistry(testDir);
  wsRegistry.registerWorkspace({
    workspaceId: "ws_safe",
    name: "Safe Workspace",
    path: testDir,
  });

  const wsContext = new AgentExecutionContext({
    agentId: "agent_nova",
    agentName: "Nova",
    taskId: "task_traversal_1",
    workspaceId: "ws_safe",
    workspacePath: testDir,
    allowedTools: ["read_antigravity_workspace_file"],
    permissions: DEFAULT_PERMISSIONS,
    dataDir: testDir,
    scratchWorkspaceDir: path.join(testDir, "workspace"),
    antigravityBridge: { workspaces: wsRegistry },
  });

  const traversalRes = await gateway.execute(
    "read_antigravity_workspace_file",
    { workspaceId: "ws_safe", filePath: "../../Windows/System32/drivers/etc/hosts" },
    wsContext
  );

  assert.equal(traversalRes.result.success, false);
  assert.equal(traversalRes.provenance.status, "BLOCKED");
  assert.match(traversalRes.result.error || "", /Path traversal or unauthorized path/);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("4. Direct Antigravity workspace tools inspect real repository structure and git status", async () => {
  const testDir = createTempDir();
  const toolRegistry = new ToolRegistry();
  const gateway = new ToolExecutionGateway(toolRegistry, testDir);

  const realWorkspacePath = process.cwd();
  const wsRegistry = new WorkspaceRegistry(testDir);
  wsRegistry.registerWorkspace({
    workspaceId: "default_workspace",
    name: "Star Office Workspace",
    path: realWorkspacePath,
  });

  const context = new AgentExecutionContext({
    agentId: "agent_nova",
    agentName: "Nova",
    taskId: "task_audit_real",
    workspaceId: "default_workspace",
    workspacePath: realWorkspacePath,
    allowedTools: [
      "get_antigravity_workspace_git_status",
      "list_antigravity_workspace_files",
      "read_antigravity_workspace_file",
    ],
    permissions: DEFAULT_PERMISSIONS,
    dataDir: testDir,
    scratchWorkspaceDir: path.join(testDir, "workspace"),
    antigravityBridge: { workspaces: wsRegistry },
  });

  // A. Check Git Status
  const gitRes = await gateway.execute("get_antigravity_workspace_git_status", { workspaceId: "default_workspace" }, context);
  assert.equal(gitRes.result.success, true);
  assert.ok(gitRes.result.output.includes("=== Git Status:"));
  assert.ok(gitRes.result.output.includes("Current Branch:"));

  // B. List Workspace Files
  const listRes = await gateway.execute("list_antigravity_workspace_files", { workspaceId: "default_workspace" }, context);
  assert.equal(listRes.result.success, true);
  assert.ok(listRes.result.output.includes("=== Workspace Files:"));
  assert.ok(listRes.result.output.includes("package.json"));

  // C. Read package.json
  const readRes = await gateway.execute(
    "read_antigravity_workspace_file",
    { workspaceId: "default_workspace", filePath: "package.json" },
    context
  );
  assert.equal(readRes.result.success, true);
  assert.ok(readRes.result.output.includes("=== File Content: package.json"));
  assert.ok(readRes.result.output.includes("star-office-world"));

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("5. Anti-False Completion rejects natural language refusal and excuse messages", () => {
  const task = {
    id: "task_sample_1",
    title: "Inspect repository and report git status",
    description: "Analyze working tree and git branch",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    acceptanceCriteria: ["Inspect working tree", "Verify git branch"],
    requiredTools: ["get_antigravity_workspace_git_status"],
  };

  // Agent output contains classic refusal phrase
  const refusalOutput = "I do not have access to Antigravity tools or the terminal. Please run these commands manually in PowerShell: git status";
  const result = CompletionVerifier.verifyCompletion(task, refusalOutput, []);

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockReason || "", /Agent reported lack of capability or missing tools/);
});

test("6. Anti-False Completion blocks inspection tasks with 0 tool executions", () => {
  const task = {
    id: "task_sample_2",
    title: "Perform repository audit and list workspace files",
    description: "Examine repository files",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Agent claims to have completed without running any inspection tools
  const claimOutput = "I have audited the repository. Everything looks good and standard.";
  const result = CompletionVerifier.verifyCompletion(task, claimOutput, []);

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockReason || "", /Execution Integrity Failure: Task requires real workspace or git inspection evidence/);
});

test("7. Anti-False Completion approves task when verified tool evidence is present", () => {
  const provenanceRec = {
    executionId: "exec_123",
    taskId: "task_sample_3",
    agentId: "agent_nova",
    tool: "get_antigravity_workspace_git_status",
    inputParameters: { workspaceId: "default_workspace" },
    requestedAt: Date.now() - 500,
    authorizedAt: Date.now() - 400,
    startedAt: Date.now() - 300,
    completedAt: Date.now() - 100,
    status: "COMPLETED",
    output: JSON.stringify({ branch: "main", clean: true }),
    workspaceId: "default_workspace",
  };

  const task = {
    id: "task_sample_3",
    title: "Verify git status",
    description: "Check branch name",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [provenanceRec],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    requiredTools: ["get_antigravity_workspace_git_status"],
  };

  const validOutput = "Repository git verification completed. Branch: main, clean working tree.";
  const result = CompletionVerifier.verifyCompletion(task, validOutput, task.provenance);

  assert.equal(result.canComplete, true);
  assert.equal(result.status, "COMPLETED");
});

test("8. Incident Reproduction & Resolution: Delegated subtask prevents false completion and validates real execution", () => {
  const testDir = createTempDir();
  const taskManager = new TaskManager(testDir);

  // 1. Coordinator creates parent task
  const parentTask = taskManager.createTask({
    title: "Phase 1: Autonomous Repository Audit",
    description: "Verify Star Office World git status and workspace structure",
    assignedAgentId: "agent_coordinator",
    workspaceId: "default_workspace",
    workspacePath: process.cwd(),
    acceptanceCriteria: ["Inspect git status", "List workspace files"],
    requiredTools: ["get_antigravity_workspace_git_status", "list_antigravity_workspace_files"],
  });

  taskManager.startTask(parentTask.id);

  // 2. Coordinator delegates to Nova
  const childTask = taskManager.createTask({
    title: "Subtask: Repository Git Status & File Audit",
    description: "Use Antigravity tools to inspect default_workspace",
    assignedAgentId: "agent_nova",
    parentTaskId: parentTask.id,
    workspaceId: parentTask.workspaceId,
    workspacePath: parentTask.workspacePath,
    acceptanceCriteria: parentTask.acceptanceCriteria,
    requiredTools: parentTask.requiredTools,
  });

  taskManager.startTask(childTask.id);

  // 3. Attempt Incident: Nova model produces refusal excuse
  const incidentExcuse = "I am operating in an environment without direct tool access to Antigravity. Please run `git status` manually in your console.";
  const attemptedCompletion = taskManager.completeTask(childTask.id, incidentExcuse);

  // Verify Incident Prevented: Subtask is BLOCKED, not COMPLETED
  assert.ok(attemptedCompletion);
  assert.equal(attemptedCompletion.status, "BLOCKED");
  assert.match(attemptedCompletion.blockReason || "", /Agent reported lack of capability or missing tools/);

  // Parent task is NOT marked completed
  const currentParent = taskManager.getTask(parentTask.id);
  assert.ok(currentParent);
  assert.notEqual(currentParent.status, "COMPLETED");
  assert.equal(currentParent.status, "BLOCKED");

  // 4. Recovery & Real Execution: Nova executes the required tools
  const gitProvenance = {
    executionId: "exec_real_git",
    taskId: childTask.id,
    agentId: "agent_nova",
    tool: "get_antigravity_workspace_git_status",
    inputParameters: { workspaceId: "default_workspace" },
    requestedAt: Date.now() - 300,
    authorizedAt: Date.now() - 250,
    startedAt: Date.now() - 200,
    completedAt: Date.now() - 100,
    status: "COMPLETED",
    output: JSON.stringify({ branch: "main", clean: true }),
    workspaceId: "default_workspace",
  };

  const listProvenance = {
    executionId: "exec_real_list",
    taskId: childTask.id,
    agentId: "agent_nova",
    tool: "list_antigravity_workspace_files",
    inputParameters: { workspaceId: "default_workspace" },
    requestedAt: Date.now() - 200,
    authorizedAt: Date.now() - 150,
    startedAt: Date.now() - 100,
    completedAt: Date.now() - 50,
    status: "COMPLETED",
    output: JSON.stringify({ fileCount: 45, files: ["package.json", "tsconfig.json"] }),
    workspaceId: "default_workspace",
  };

  taskManager.addProvenanceRecord(childTask.id, gitProvenance);
  taskManager.addProvenanceRecord(childTask.id, listProvenance);

  // Now complete with real findings
  const realFindings = "Repository audit complete. Verified on branch main with clean working tree. Discovered 45 files.";
  const successfulChild = taskManager.completeTask(childTask.id, realFindings);

  assert.ok(successfulChild);
  assert.equal(successfulChild.status, "COMPLETED");

  // Parent can now be completed successfully
  const finalParent = taskManager.completeTask(parentTask.id, "All delegated subtasks verified with tool execution provenance.");
  assert.ok(finalParent);
  assert.equal(finalParent.status, "COMPLETED");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("9. Anti-False Completion blocks Antigravity delegation when only dispatched without real execution deliverable", () => {
  const task = {
    id: "task_ag_dispatch_only",
    title: "Implement new feature with Antigravity",
    description: "Create and implement module",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [
      {
        executionId: "exec_ag_disp",
        taskId: "task_ag_dispatch_only",
        agentId: "agent_nova",
        tool: "delegate_to_antigravity",
        inputParameters: { title: "Implement feature", waitForCompletion: false },
        requestedAt: Date.now() - 200,
        authorizedAt: Date.now() - 150,
        startedAt: Date.now() - 100,
        completedAt: Date.now() - 50,
        status: "COMPLETED",
        output: "Successfully submitted engineering task to Google Antigravity! Task ID: ag_task_123 (Status: QUEUED). Real execution has started via the Antigravity CLI on workspace 'default_workspace'.",
        workspaceId: "default_workspace",
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const claimResult = "Antigravity task has been queued and dispatched.";
  const result = CompletionVerifier.verifyCompletion(task, claimResult, task.provenance);

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "FAILED");
  assert.match(result.blockReason || "", /File modification or Antigravity delegation could not be verified/);
});

test("10. Anti-False Completion approves Antigravity delegation when completed execution deliverable is present", () => {
  const task = {
    id: "task_ag_delivered",
    title: "Implement new feature with Antigravity",
    description: "Create and implement module",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [
      {
        executionId: "exec_ag_done",
        taskId: "task_ag_delivered",
        agentId: "agent_nova",
        tool: "delegate_to_antigravity",
        inputParameters: { title: "Implement feature", waitForCompletion: true },
        requestedAt: Date.now() - 200,
        authorizedAt: Date.now() - 150,
        startedAt: Date.now() - 100,
        completedAt: Date.now() - 50,
        status: "COMPLETED",
        output: "=== Google Antigravity Execution Succeeded ===\nTask ID: ag_task_456\nStatus: COMPLETED\nDeliverable: Implemented new authentication token validator.\n\n=== Git Diff / File Changes ===\ndiff --git a/auth.ts b/auth.ts",
        workspaceId: "default_workspace",
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const claimResult = "Antigravity finished implementation and verified tests.";
  const result = CompletionVerifier.verifyCompletion(task, claimResult, task.provenance);

  assert.equal(result.canComplete, true);
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.verifiedEvidence && result.verifiedEvidence.length > 0);
  assert.equal(result.verifiedEvidence[0].operation, "delegate_to_antigravity");
});
