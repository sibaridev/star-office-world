import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { AgentLifecycle, mapRuntimeToOfficeState } from "../dist/agents/core/AgentLifecycle.js";
import { AgentInstance } from "../dist/agents/core/AgentInstance.js";

test("ToolRegistry — enforces sandboxing and prevents path traversal", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-tools-test-"));
  const workspaceDir = path.join(tempDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const registry = new ToolRegistry();
  const context = {
    agentId: "agent_writer",
    agentName: "Sam",
    dataDir: tempDir,
    workspaceDir,
  };

  // 1. Safe write
  const writeRes = await registry.executeTool(
    "workspace_write_file",
    { filePath: "reports/test.txt", content: "Hello World" },
    context
  );
  assert.equal(writeRes.success, true);
  assert.ok(fs.existsSync(path.join(workspaceDir, "reports", "test.txt")));

  // 2. Safe read
  const readRes = await registry.executeTool(
    "workspace_read_file",
    { filePath: "reports/test.txt" },
    context
  );
  assert.equal(readRes.success, true);
  assert.equal(readRes.output, "Hello World");

  // 3. Security Check: Path traversal attempt outside workspace
  const traversalRes = await registry.executeTool(
    "workspace_write_file",
    { filePath: "../../dangerous.txt", content: "malicious" },
    context
  );
  assert.equal(traversalRes.success, false);
  assert.ok(traversalRes.error?.includes("Path traversal outside workspace boundary is forbidden"));

  // 4. Permission Check: Agent without permitted tool
  const permRes = await registry.executeTool(
    "workspace_write_file",
    { filePath: "test.txt", content: "data" },
    context,
    ["web_search"] // Allowed list does not contain workspace_write_file
  );
  assert.equal(permRes.success, false);
  assert.ok(permRes.error?.includes("Permission Denied"));
});

test("TaskManager — manages parent-child tasks and resolves dependencies", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-task-test-"));
  const manager = new TaskManager(tempDir);

  // 1. Create parent task
  const parent = manager.createTask({
    title: "Quarterly AI Report",
    description: "Write full AI review",
  });
  assert.equal(parent.status, "PENDING");

  // 2. Create subtask 1 (Research)
  const sub1 = manager.createTask({
    title: "Gather Sources",
    description: "Search web for news",
    parentTaskId: parent.id,
  });

  // 3. Create subtask 2 (Write) depending on subtask 1
  const sub2 = manager.createTask({
    title: "Draft Summary",
    description: "Draft from gathered sources",
    parentTaskId: parent.id,
    dependencies: [sub1.id],
  });
  assert.equal(sub2.status, "WAITING_DEPENDENCY");

  // Complete subtask 1
  manager.startTask(sub1.id);
  manager.completeTask(sub1.id, "Found 10 relevant AI sources.");

  // sub2 should now automatically transition to PENDING
  const refreshedSub2 = manager.getTask(sub2.id);
  assert.equal(refreshedSub2?.status, "PENDING");

  // Complete subtask 2
  manager.startTask(sub2.id);
  manager.completeTask(sub2.id, "Report drafted into workspace/reports/ai.md.");

  // Parent task should now be automatically COMPLETED
  const refreshedParent = manager.getTask(parent.id);
  assert.equal(refreshedParent?.status, "COMPLETED");
  assert.ok(refreshedParent?.result?.includes("All 2 subtasks completed"));
});

test("TaskManager — recovers interrupted tasks on restart", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-recovery-test-"));
  const manager1 = new TaskManager(tempDir);

  const t1 = manager1.createTask({ title: "Task 1", description: "Completed" });
  manager1.completeTask(t1.id, "Done");

  const t2 = manager1.createTask({ title: "Task 2", description: "Interrupted" });
  manager1.startTask(t2.id); // In progress

  // Simulate server restart by creating new TaskManager instance with same dataDir
  const manager2 = new TaskManager(tempDir);
  const recoveredT1 = manager2.getTask(t1.id);
  const recoveredT2 = manager2.getTask(t2.id);

  assert.equal(recoveredT1?.status, "COMPLETED");
  assert.equal(recoveredT2?.status, "INTERRUPTED");
  assert.ok(recoveredT2?.error?.includes("Application restarted"));
});

test("AgentLifecycle — maps runtime states accurately to office visual states", () => {
  const lifecycle = new AgentLifecycle("IDLE");
  assert.equal(lifecycle.state, "IDLE");
  assert.equal(lifecycle.officeVisualState, "idle");

  lifecycle.transition("THINKING");
  assert.equal(lifecycle.state, "THINKING");
  assert.equal(lifecycle.officeVisualState, "researching");

  lifecycle.transition("EXECUTING");
  assert.equal(lifecycle.state, "EXECUTING");
  assert.equal(lifecycle.officeVisualState, "executing");

  lifecycle.transition("COMMUNICATING");
  assert.equal(lifecycle.state, "COMMUNICATING");
  assert.equal(lifecycle.officeVisualState, "syncing");

  lifecycle.transition("ERROR");
  assert.equal(lifecycle.state, "ERROR");
  assert.equal(lifecycle.officeVisualState, "error");
});
