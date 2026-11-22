import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { AgentInstance } from "../dist/agents/core/AgentInstance.js";
import { AgentRuntime } from "../dist/agents/core/AgentRuntime.js";
import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../dist/agents/tools/ToolExecutionGateway.js";
import { DEFAULT_AGENTS } from "../dist/agents/core/AgentRegistry.js";
import { SSEManager } from "../dist/sse.js";
import { MemoStore } from "../dist/memo-store.js";
import { createInitialState } from "../dist/state.js";

function setupTestEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-checkpoint-test-"));
  const taskManager = new TaskManager(tempDir);
  const toolRegistry = new ToolRegistry();
  const toolGateway = new ToolExecutionGateway(toolRegistry, tempDir);
  return { tempDir, taskManager, toolRegistry, toolGateway };
}

test("1. Task Checkpoint: Saving and resuming from checkpoint preserves intermediate findings", () => {
  const { tempDir, taskManager } = setupTestEnv();

  const task = taskManager.createTask({
    title: "Long-running Autonomous Repository Migration",
    description: "Multi-turn task that reaches iteration limits",
    assignedAgentId: "agent_nova",
    workspaceId: "default_workspace",
    workspacePath: "C:\\Users\\Sibari\\Desktop\\AI-ROOM",
  });

  taskManager.startTask(task.id);
  taskManager.addStep(task.id, {
    description: "Audited git status on feature branch",
    tool: "get_antigravity_workspace_git_status",
    toolResult: "Branch clean, commit 5ae2b92",
  });
  taskManager.addStep(task.id, {
    description: "Discovered root project files",
    tool: "list_antigravity_workspace_files",
    toolResult: "Discovered 45 files including package.json",
  });

  // Save checkpoint at turn 10
  const checkpoint = taskManager.saveCheckpoint(task.id, {
    turnNumber: 10,
    maxTurns: 10,
    intermediateFindings: "Audited git status and discovered 45 files in repository.",
    completedStepsCount: 2,
    nextRecommendedAction: "Resume execution with test suite verification.",
  });

  assert.ok(checkpoint);
  assert.ok(checkpoint.checkpointId.startsWith("cp_"));
  assert.equal(checkpoint.turnNumber, 10);
  assert.equal(checkpoint.completedStepsCount, 2);

  // Task status should transition to PARTIALLY_COMPLETED
  const savedTask = taskManager.getTask(task.id);
  assert.ok(savedTask);
  assert.equal(savedTask.status, "PARTIALLY_COMPLETED");
  assert.ok(savedTask.checkpoint);
  assert.equal(savedTask.checkpoint.checkpointId, checkpoint.checkpointId);

  // Resume task from checkpoint
  const resumedTask = taskManager.resumeFromCheckpoint(task.id);
  assert.ok(resumedTask);
  assert.equal(resumedTask.status, "PENDING");
  assert.equal(resumedTask.checkpoint?.checkpointId, checkpoint.checkpointId);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("2. Prompt Observability: Parent agent prompt includes checkpoint and child subtask deliverables", () => {
  const { tempDir, taskManager, toolRegistry, toolGateway } = setupTestEnv();

  const mockProvider = {
    async generate() {
      return { text: JSON.stringify({ action: "complete", result: "Done" }) };
    },
  };

  const coordinatorConfig = DEFAULT_AGENTS.find((a) => a.agentId === "agent_coordinator");
  assert.ok(coordinatorConfig);

  const instance = new AgentInstance({
    config: {
      ...coordinatorConfig,
      configVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isMain: true,
      allowedTools: coordinatorConfig.allowedTools,
    },
    aiProvider: mockProvider,
    toolRegistry,
    toolGateway,
    taskManager,
    dataDir: tempDir,
    workspaceDir: path.join(tempDir, "workspace"),
    eventBus: () => {},
  });

  // 1. Create parent task with checkpoint
  const parentTask = taskManager.createTask({
    title: "Master Multi-Agent Audit",
    description: "Audit repository and coordinate team sign-off",
    assignedAgentId: "agent_coordinator",
  });

  taskManager.saveCheckpoint(parentTask.id, {
    turnNumber: 10,
    maxTurns: 10,
    intermediateFindings: "Alex coordinated subtask allocation.",
    completedStepsCount: 1,
  });

  // 2. Create and complete child subtask
  const childTask = taskManager.createTask({
    parentTaskId: parentTask.id,
    title: "Nova Git Inspection Subtask",
    description: "Check git status",
    assignedAgentId: "agent_nova",
    acceptanceCriteria: ["Audit git status"],
  });

  taskManager.addProvenanceRecord(childTask.id, {
    executionId: "exec_test_1",
    taskId: childTask.id,
    agentId: "agent_nova",
    tool: "get_antigravity_workspace_git_status",
    inputParameters: { workspaceId: "default_workspace" },
    requestedAt: Date.now(),
    status: "COMPLETED",
    output: "Branch: feature/phase0-investigation-and-runtime-fix",
  });

  taskManager.completeTask(childTask.id, "Audit git status: Clean branch verified.");

  // Access private buildPrompt
  const prompt = instance.buildPrompt(taskManager.getTask(parentTask.id), 1);

  assert.ok(prompt.includes("PREVIOUS EXECUTION CHECKPOINT"));
  assert.ok(prompt.includes("Alex coordinated subtask allocation"));
  assert.ok(prompt.includes("DELEGATED SUBTASK DELIVERABLES & OUTCOMES"));
  assert.ok(prompt.includes("Nova Git Inspection Subtask"));
  assert.ok(prompt.includes("Audit git status: Clean branch verified"));
  assert.ok(prompt.includes("get_antigravity_workspace_git_status (COMPLETED)"));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("3. Reactive Wakeup: AgentRuntime resumes parent agent when child tasks finish", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-resume-test-"));
  const memoDir = path.join(tempDir, "memos");
  fs.mkdirSync(memoDir, { recursive: true });

  const sse = new SSEManager(60_000);
  const memoStore = new MemoStore(memoDir);
  const officeState = createInitialState({ worldId: "test-resume-world", port: 19997 });

  let callCount = 0;
  const mockAI = {
    async generate(opts) {
      callCount++;
      if (callCount === 1) {
        // First turn: Coordinator delegates to Nova
        return {
          text: JSON.stringify({
            action: "delegate",
            subtaskTitle: "Delegate to Nova",
            subtaskDescription: "Inspect repo",
            delegateToAgentId: "agent_nova",
            thought: "Delegating inspection",
          }),
        };
      } else {
        // Second turn (resumed after Nova completes): Coordinator completes master task
        return {
          text: JSON.stringify({
            action: "complete",
            result: "Master task completed with Nova's verified findings.",
            thought: "Child task verified",
          }),
        };
      }
    },
  };

  const runtime = new AgentRuntime({
    officeState,
    sse,
    memoStore,
    aiProvider: mockAI,
    dataDir: tempDir,
  });

  try {
    const coordinator = runtime.getAgent("agent_coordinator");
    assert.ok(coordinator);

    // 1. Submit task to coordinator
    const masterTask = runtime.submitTask({
      title: "Orchestrate Repo Inspection",
      description: "Delegate to Nova then finalize",
      assignedAgentId: "agent_coordinator",
    });

    // Wait for first turn execution
    await new Promise((r) => setTimeout(r, 200));

    // Alex should have delegated and entered WAITING
    assert.equal(coordinator.status, "WAITING");
    const children = runtime.taskManager.listTasks({ parentTaskId: masterTask.id });
    assert.equal(children.length, 1);
    const novaTask = children[0];
    assert.equal(novaTask.assignedAgentId, "agent_nova");

    // 2. Nova completes the subtask
    runtime.taskManager.completeTask(novaTask.id, "Nova inspected repository: all clear.");

    // 3. Trigger supervisor resumption
    runtime["resumeUnblockedParentTasks"]();

    // Wait for parent agent to resume and complete
    await new Promise((r) => setTimeout(r, 200));

    const finalMaster = runtime.taskManager.getTask(masterTask.id);
    assert.ok(finalMaster);
    assert.equal(finalMaster.status, "COMPLETED");
    assert.ok(finalMaster.result?.includes("Nova inspected repository: all clear"));
  } finally {
    runtime.shutdown();
    sse.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
