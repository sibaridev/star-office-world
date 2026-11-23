import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { AgentInstance } from "../dist/agents/core/AgentInstance.js";
import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../dist/agents/tools/ToolExecutionGateway.js";
import { DEFAULT_AGENTS } from "../dist/agents/core/AgentRegistry.js";

function setupTestEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-unlimited-turns-test-"));
  const taskManager = new TaskManager(tempDir);
  const toolRegistry = new ToolRegistry();
  const toolGateway = new ToolExecutionGateway(toolRegistry, tempDir);
  return { tempDir, taskManager, toolRegistry, toolGateway };
}

test("Unlimited Turns: Agent executes beyond 8 and 10 turns without pausing or hitting turn limits", async () => {
  const { tempDir, taskManager, toolRegistry, toolGateway } = setupTestEnv();

  let turnCount = 0;
  const mockProvider = {
    async generate() {
      turnCount++;
      // Run for 12 turns (exceeding both previous 8-turn and 10-turn limits)
      if (turnCount < 12) {
        return {
          text: JSON.stringify({
            action: "tool",
            tool: "send_agent_message",
            args: { targetAgentId: "agent_nova", message: `Turn ${turnCount} progress update` },
            thought: `Iterating step ${turnCount} towards objective`,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: "complete",
          result: `Successfully completed at turn ${turnCount} with full verified output.`,
          thought: "Task completed after multi-step reasoning",
        }),
      };
    },
  };

  const novaConfig = DEFAULT_AGENTS.find((a) => a.agentId === "agent_nova");
  assert.ok(novaConfig);

  const emittedStates = [];
  const instance = new AgentInstance({
    config: {
      ...novaConfig,
      configVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isMain: false,
      allowedTools: ["send_agent_message"],
      execution: {
        temperature: 0.2,
        maxIterations: 0, // Explicitly 0 = unlimited
        timeoutMs: 60000,
        retryPolicy: "none",
      },
    },
    aiProvider: mockProvider,
    toolRegistry,
    toolGateway,
    taskManager,
    dataDir: tempDir,
    workspaceDir: path.join(tempDir, "workspace"),
    eventBus: (event, payload) => {
      if (event === "agent_state_changed") {
        emittedStates.push(payload);
      }
    },
  });

  const task = taskManager.createTask({
    title: "Continuous Multi-Turn Engineering Task",
    description: "Must execute continuously beyond 8 and 10 turns without pausing",
    assignedAgentId: "agent_nova",
  });

  await instance.assignTask(task);
  await instance.executeCurrentTask(); // Default unlimited execution

  // 1. Verify it executed all 12 turns
  assert.equal(turnCount, 12, "Should have executed 12 turns without stopping at 8 or 10 turns");

  // 2. Verify state transitions never paused due to turn limit
  const pausedDueToTurnLimit = emittedStates.some(
    (s) => s.detail && s.detail.toLowerCase().includes("turn limit reached")
  );
  assert.equal(pausedDueToTurnLimit, false, "Should never emit a 'turn limit reached' state");

  // 3. Verify final lifecycle state is COMPLETED, not PAUSED
  assert.equal(instance.status, "COMPLETED");

  // 4. Verify task status is COMPLETED, not PARTIALLY_COMPLETED
  const finalTask = taskManager.getTask(task.id);
  assert.ok(finalTask);
  assert.equal(finalTask.status, "COMPLETED");
  assert.equal(finalTask.checkpoint, undefined, "No checkpoint should be saved for turn limit");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("Default Configuration: Agent without maxIterations setting defaults to unlimited turns", async () => {
  const { tempDir, taskManager, toolRegistry, toolGateway } = setupTestEnv();

  let turnCount = 0;
  const mockProvider = {
    async generate() {
      turnCount++;
      if (turnCount < 11) {
        return {
          text: JSON.stringify({
            action: "tool",
            tool: "send_agent_message",
            args: { targetAgentId: "agent_coordinator", message: `Turn ${turnCount}` },
            thought: `Turn ${turnCount}`,
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: "complete",
          result: `Done at turn ${turnCount}`,
          thought: "Completed",
        }),
      };
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
      allowedTools: ["send_agent_message"],
      // execution not provided at all
    },
    aiProvider: mockProvider,
    toolRegistry,
    toolGateway,
    taskManager,
    dataDir: tempDir,
    workspaceDir: path.join(tempDir, "workspace"),
    eventBus: () => {},
  });

  const task = taskManager.createTask({
    title: "Default Config Multi-Turn Task",
    description: "Verify default execution runs beyond 8 and 10 turns",
    assignedAgentId: "agent_coordinator",
  });

  await instance.assignTask(task);
  await instance.executeCurrentTask();

  assert.equal(turnCount, 11, "Default configuration should run 11 turns without pausing at 8 or 10");
  assert.equal(instance.status, "COMPLETED");

  const finalTask = taskManager.getTask(task.id);
  assert.ok(finalTask);
  assert.equal(finalTask.status, "COMPLETED");

  fs.rmSync(tempDir, { recursive: true, force: true });
});
