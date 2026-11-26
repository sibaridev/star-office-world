import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { CompletionVerifier } from "../dist/agents/tasks/CompletionVerifier.js";
import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { TaskPersistence } from "../dist/agents/tasks/TaskPersistence.js";

function createTempDir(prefix = "task-audit-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CompletionVerifier: Recovery vs Unresolved Failures
// ─────────────────────────────────────────────────────────────────────────────

test("1. CompletionVerifier: Historical failed tool execution followed by successful recovery MUST NOT fail task", () => {
  const task = {
    id: "task_recovery_1",
    title: "Run test suite and verify clean status",
    description: "Run npm test and inspect workspace",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const provenance = [
    {
      executionId: "exec_cmd_fail",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "npm test" },
      requestedAt: Date.now() - 300,
      status: "FAILED",
      error: "Command exited with code 1 (3 failing tests)",
    },
    {
      executionId: "exec_cmd_success",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "npm test" },
      requestedAt: Date.now() - 100,
      status: "COMPLETED",
      output: "All 125 tests passed successfully.",
    },
  ];

  const result = CompletionVerifier.verifyCompletion(
    task,
    "Tests were retried and all 125 tests passed successfully.",
    provenance
  );

  assert.equal(result.canComplete, true);
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.verifiedEvidence && result.verifiedEvidence.length > 0);
});

test("2. CompletionVerifier: Latest unresolved tool failure MUST NOT be silently ignored", () => {
  const task = {
    id: "task_unresolved_fail",
    title: "Execute migration script and inspect output",
    description: "Run migration command",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Tool 1 failed, but Tool 2 succeeded afterwards. Tool 1 was never recovered!
  const provenance = [
    {
      executionId: "exec_mig_fail",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "node migrate.js" },
      requestedAt: Date.now() - 200,
      status: "FAILED",
      error: "Migration failed: table 'users' already exists",
    },
    {
      executionId: "exec_read_succ",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_read_file",
      inputParameters: { filePath: "package.json" },
      requestedAt: Date.now() - 100,
      status: "COMPLETED",
      output: '{"name": "test"}',
    },
  ];

  const result = CompletionVerifier.verifyCompletion(
    task,
    "Read package.json and migration finished.",
    provenance
  );

  // Must NOT be silently ignored!
  assert.equal(result.canComplete, false);
  assert.equal(result.status, "FAILED");
  assert.match(result.blockReason || "", /Execution Failure: Tool 'workspace_execute_command'/);
  assert.match(result.blockReason || "", /Migration failed: table 'users' already exists/);
});

test("3. CompletionVerifier: Multiple retries ending in failure is detected as unresolved", () => {
  const task = {
    id: "task_retry_fail",
    title: "Flaky network tool run",
    description: "Fetch API data",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const provenance = [
    {
      executionId: "exec_1",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "curl https://api.example.com" },
      requestedAt: Date.now() - 300,
      status: "FAILED",
      error: "Timeout 504",
    },
    {
      executionId: "exec_2",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "curl https://api.example.com" },
      requestedAt: Date.now() - 200,
      status: "COMPLETED",
      output: "OK 200",
    },
    {
      executionId: "exec_3",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_execute_command",
      inputParameters: { command: "curl https://api.example.com" },
      requestedAt: Date.now() - 100,
      status: "FAILED",
      error: "Connection reset by peer",
    },
  ];

  const result = CompletionVerifier.verifyCompletion(task, "Fetched API data.", provenance);

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "FAILED");
  assert.match(result.blockReason || "", /Connection reset by peer/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Failed Critical Verification Prevents Completion
// ─────────────────────────────────────────────────────────────────────────────

test("4. CompletionVerifier: Modification task fails if target file does not exist on disk", () => {
  const tempDir = createTempDir("task-mod-missing-");
  const missingFilePath = path.join(tempDir, "non_existent.txt");

  const task = {
    id: "task_mod_1",
    title: "Create and update configuration file",
    description: "Create non_existent.txt in workspace",
    workspacePath: tempDir,
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const provenance = [
    {
      executionId: "exec_write_missing",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_write_file",
      inputParameters: { filePath: missingFilePath, content: "config=true" },
      requestedAt: Date.now() - 100,
      status: "COMPLETED",
      output: "File written",
    },
  ];

  // We deliberately do NOT create missingFilePath on disk
  const result = CompletionVerifier.verifyCompletion(
    task,
    "Configuration file created successfully.",
    provenance
  );

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "FAILED");
  assert.match(result.blockReason || "", /Target file .* does not exist on disk/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("5. CompletionVerifier: Modification task fails if read-back content does not match expected", () => {
  const tempDir = createTempDir("task-mod-mismatch-");
  const targetFile = path.join(tempDir, "config.json");
  // Write mismatched content on disk
  fs.writeFileSync(targetFile, '{"mode": "development"}', "utf8");

  const task = {
    id: "task_mod_2",
    title: "Update config to production mode",
    description: "Modify config.json to production",
    workspacePath: tempDir,
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const provenance = [
    {
      executionId: "exec_write_mismatch",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "workspace_write_file",
      inputParameters: { filePath: targetFile, content: '{"mode": "production"}' },
      requestedAt: Date.now() - 100,
      status: "COMPLETED",
      output: "File written",
    },
  ];

  const result = CompletionVerifier.verifyCompletion(
    task,
    "Config updated to production mode.",
    provenance
  );

  assert.equal(result.canComplete, false);
  assert.equal(result.status, "FAILED");
  assert.match(result.blockReason || "", /Read-back content does not match expected modification/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("6. CompletionVerifier: Natural-language refusal or excuse prevents completion", () => {
  const task = {
    id: "task_refusal_1",
    title: "Inspect repository and fix bug",
    description: "Examine repository files and patch bug",
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const refusalOutputs = [
    "I do not have access to tools to modify this repository.",
    "Unable to directly write to the filesystem in this environment.",
    "Operating in an environment without direct tool access.",
    "Please run the following commands manually: git checkout main",
  ];

  for (const text of refusalOutputs) {
    const res = CompletionVerifier.verifyCompletion(task, text, []);
    assert.equal(res.canComplete, false, `Expected refusal to block for: "${text}"`);
    assert.equal(res.status, "BLOCKED");
    assert.match(res.blockReason || "", /Agent reported lack of capability or missing tools/);
  }
});

test("7. CompletionVerifier: Required tools and required evidence missing prevent completion", () => {
  const task = {
    id: "task_req_evidence",
    title: "Audit workspace and verify git status",
    description: "Run audit tools",
    requiredTools: ["get_antigravity_workspace_git_status"],
    requiredEvidence: ["git_status"],
    status: "IN_PROGRESS",
    steps: [],
    provenance: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 1. Missing required tool
  const res1 = CompletionVerifier.verifyCompletion(task, "All clear.", []);
  assert.equal(res1.canComplete, false);
  assert.equal(res1.status, "BLOCKED");
  assert.match(res1.blockReason || "", /Mandatory tool execution missing/);

  // 2. Missing required evidence
  const dummyProvenance = [
    {
      executionId: "exec_dummy",
      taskId: task.id,
      agentId: "agent_nova",
      tool: "get_antigravity_workspace_git_status",
      inputParameters: {},
      requestedAt: Date.now(),
      status: "COMPLETED",
      output: "nothing to see",
    },
  ];
  // requiredEvidence is ["special_checksum_evidence"]
  const taskWithSpecialEvidence = {
    ...task,
    requiredEvidence: ["special_checksum_evidence"],
  };
  const res2 = CompletionVerifier.verifyCompletion(taskWithSpecialEvidence, "Done.", dummyProvenance);
  assert.equal(res2.canComplete, false);
  assert.equal(res2.status, "BLOCKED");
  assert.match(res2.blockReason || "", /Required evidence missing/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Execution Provenance Preservation & Subtask Aggregation
// ─────────────────────────────────────────────────────────────────────────────

test("8. TaskManager: Preserves execution provenance and prevents duplicate provenance on repeated complete checks", () => {
  const tempDir = createTempDir("task-provenance-test-");
  const taskManager = new TaskManager(tempDir);

  const parent = taskManager.createTask({
    title: "Master Task with Delegated Subtask",
    description: "Coordinate subtasks",
    assignedAgentId: "agent_coordinator",
  });

  const child = taskManager.createTask({
    parentTaskId: parent.id,
    title: "Nova Subtask",
    description: "Nova inspects workspace",
    assignedAgentId: "agent_nova",
  });

  taskManager.addProvenanceRecord(child.id, {
    executionId: "exec_child_1",
    taskId: child.id,
    agentId: "agent_nova",
    tool: "get_antigravity_workspace_git_status",
    inputParameters: { workspaceId: "ws_default" },
    requestedAt: Date.now() - 200,
    status: "COMPLETED",
    output: "Branch: main",
  });

  taskManager.completeTask(child.id, "Branch main verified.");

  // Complete parent multiple times (e.g. initial rejection or repeated checks)
  taskManager.completeTask(parent.id, "Parent finished.");
  taskManager.completeTask(parent.id, "Parent finished second attempt.");

  const loadedParent = taskManager.getTask(parent.id);
  assert.ok(loadedParent);
  assert.equal(loadedParent.status, "COMPLETED");

  // Child provenance should only be present ONCE, not duplicated
  const childExecIds = loadedParent.provenance.filter((p) => p.executionId === "exec_child_1");
  assert.equal(childExecIds.length, 1);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Persistence & Server Restart Integrity
// ─────────────────────────────────────────────────────────────────────────────

test("9. TaskPersistence & TaskManager: Task updates survive simulated server restart", () => {
  const tempDir = createTempDir("task-restart-test-");

  // Server Instance 1
  let tm = new TaskManager(tempDir);

  const task1 = tm.createTask({
    title: "Completed Task Before Restart",
    description: "Should remain completed after restart",
    assignedAgentId: "agent_nova",
    priority: "high",
  });
  tm.completeTask(task1.id, "Completed deliverable.");

  const task2 = tm.createTask({
    title: "Pending Task",
    description: "Should remain pending",
    assignedAgentId: "agent_coordinator",
  });

  const task3 = tm.createTask({
    title: "In-Progress Task When Server Dies",
    description: "Should be recovered as INTERRUPTED",
    assignedAgentId: "agent_echo",
  });
  tm.startTask(task3.id);
  tm.addStep(task3.id, { description: "Mid-flight step before sudden crash" });

  const task4 = tm.createTask({
    title: "Assigned Task When Server Dies",
    description: "Should be recovered as INTERRUPTED",
    assignedAgentId: "agent_nova",
  });
  tm.assignTask(task4.id, "agent_nova");

  // Server crashes and restarts: Server Instance 2 instantiated on same directory
  const restartedTm = new TaskManager(tempDir);

  // 1. Task 1 remains COMPLETED
  const recovered1 = restartedTm.getTask(task1.id);
  assert.ok(recovered1);
  assert.equal(recovered1.status, "COMPLETED");
  assert.equal(recovered1.result, "Completed deliverable.");
  assert.equal(recovered1.priority, "high");

  // 2. Task 2 remains PENDING
  const recovered2 = restartedTm.getTask(task2.id);
  assert.ok(recovered2);
  assert.equal(recovered2.status, "PENDING");

  // 3. Task 3 was IN_PROGRESS -> recovered as INTERRUPTED
  const recovered3 = restartedTm.getTask(task3.id);
  assert.ok(recovered3);
  assert.equal(recovered3.status, "INTERRUPTED");
  assert.match(recovered3.error || "", /Application restarted while task was in progress/);
  assert.equal(recovered3.steps.length, 1);
  assert.equal(recovered3.steps[0].description, "Mid-flight step before sudden crash");

  // 4. Task 4 was ASSIGNED -> recovered as INTERRUPTED
  const recovered4 = restartedTm.getTask(task4.id);
  assert.ok(recovered4);
  assert.equal(recovered4.status, "INTERRUPTED");

  // 5. Confirm TaskPersistence.listTasks() matches restarted TaskManager in-memory tasks
  const persistence = new TaskPersistence(tempDir);
  const diskTasks = persistence.listTasks();
  assert.equal(diskTasks.length, 4);

  const diskTask3 = persistence.getTask(task3.id);
  assert.ok(diskTask3);
  assert.equal(diskTask3.status, "INTERRUPTED");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. False Completion Prevention & Cancellation Integrity
// ─────────────────────────────────────────────────────────────────────────────

test("10. TaskManager: Cancelled tasks cannot be falsely marked completed", () => {
  const tempDir = createTempDir("task-cancel-test-");
  const taskManager = new TaskManager(tempDir);

  const task = taskManager.createTask({
    title: "User Cancelled Task",
    description: "Task to be aborted",
    assignedAgentId: "agent_nova",
  });

  // Cancel task
  const cancelled = taskManager.cancelTask(task.id, "Aborted by operator");
  assert.ok(cancelled);
  assert.equal(cancelled.status, "CANCELLED");

  // Attempt to mark completed falsely
  const attempt = taskManager.completeTask(task.id, "Attempted completion after cancellation");
  assert.ok(attempt);
  assert.equal(attempt.status, "CANCELLED");

  // Parent task delegation check also honors child cancellation
  const parent = taskManager.createTask({
    title: "Parent with Cancelled Child",
    description: "Parent coordinator",
  });

  const child = taskManager.createTask({
    parentTaskId: parent.id,
    title: "Child that was cancelled",
    description: "Child subtask",
  });

  taskManager.cancelTask(child.id, "Subtask cancelled");

  // Child validation fails
  const childCheck = CompletionVerifier.validateChildDelegationResult(taskManager.getTask(child.id));
  assert.equal(childCheck.valid, false);
  assert.equal(childCheck.propagatedStatus, "CANCELLED");

  fs.rmSync(tempDir, { recursive: true, force: true });
});
