import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { AgentRuntime } from "../dist/agents/core/AgentRuntime.js";
import { SSEManager } from "../dist/sse.js";
import { MemoStore } from "../dist/memo-store.js";
import { createInitialState, addAgent } from "../dist/state.js";
import { DEFAULT_AGENTS } from "../dist/agents/core/AgentRegistry.js";
import { createStarOfficeWorld } from "../dist/index.js";

function setupTestEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-act-test-"));
  const memoDir = path.join(tempDir, "memos");
  fs.mkdirSync(memoDir, { recursive: true });

  const sse = new SSEManager(60_000);
  const memoStore = new MemoStore(memoDir);
  const officeState = createInitialState({ worldId: "act-test-world", port: 19992 });
  for (const a of DEFAULT_AGENTS) {
    addAgent(officeState, a.agentId, a.name, a.avatar, "idle", a.role, a.isMain);
  }

  const mockAI = {
    async generate() {
      return { text: "Simulated output" };
    },
  };

  const runtime = new AgentRuntime({
    officeState,
    sse,
    memoStore,
    aiProvider: mockAI,
    dataDir: tempDir,
  });

  return { tempDir, sse, memoStore, officeState, runtime };
}

test("1. ActivityMonitor: Overview returns all registered agents with real data", async (t) => {
  const { runtime, sse } = setupTestEnv();
  t.after(() => {
    runtime.shutdown();
    sse.destroy();
  });

  const overview = runtime.activityMonitor.getOverview();
  assert.ok(Array.isArray(overview));
  assert.ok(overview.length >= 5, "Must list all registered default agents");

  const nova = overview.find((a) => a.agentId === "agent_nova");
  assert.ok(nova, "Nova must be present in overview");
  assert.equal(nova.name, "Nova");
  assert.equal(nova.role, "Antigravity Principal Engineer & Master");
  assert.ok(nova.avatar);
  assert.equal(nova.isActive, true);
  assert.ok(typeof nova.durationInStateMs === "number");
  assert.ok(nova.stats);
  assert.equal(typeof nova.stats.totalTasksAssigned, "number");
  assert.equal(nova.currentTask, null, "Initially idle agent has no current task");
  assert.ok(nova.latestActivity, "Must have an initial recorded activity");
});

test("2. ActivityMonitor: Tracks current assigned task, steps, and active execution state", async (t) => {
  const { runtime, sse } = setupTestEnv();
  t.after(() => {
    runtime.shutdown();
    sse.destroy();
  });

  // Create and assign an active task to Nova
  const task = runtime.taskManager.createTask({
    title: "Inspect Repository Workspace Health",
    description: "Perform real inspection of default_workspace and git status",
    assignedAgentId: "agent_nova",
    priority: "high",
  });
  runtime.taskManager.startTask(task.id);

  // Add real execution step
  runtime.taskManager.addStep(task.id, {
    description: "Executed tool 'inspect_antigravity_workspace'",
    tool: "inspect_antigravity_workspace",
    thought: "Verifying workspace health",
    toolResult: "Workspace clean",
  });

  const overview = runtime.activityMonitor.getOverview();
  const nova = overview.find((a) => a.agentId === "agent_nova");
  assert.ok(nova);
  assert.ok(nova.currentTask, "Nova must now have an active current task");
  assert.equal(nova.currentTask.id, task.id);
  assert.equal(nova.currentTask.title, "Inspect Repository Workspace Health");
  assert.equal(nova.currentTask.status, "IN_PROGRESS");
  assert.equal(nova.currentTask.stepsCount, 1);
  assert.ok(nova.currentTask.lastStep);
  assert.equal(nova.currentTask.lastStep.tool, "inspect_antigravity_workspace");
  assert.equal(nova.currentTask.lastStep.stepNumber, 1);

  // Latest activity reflects the executed step
  assert.ok(nova.latestActivity);
  assert.equal(nova.latestActivity.type, "tool_execution");
  assert.equal(nova.latestActivity.tool, "inspect_antigravity_workspace");
});

test("3. ActivityMonitor: Captures completed execution results, deliverables, and tool provenance", async (t) => {
  const { runtime, sse } = setupTestEnv();
  t.after(() => {
    runtime.shutdown();
    sse.destroy();
  });

  const task = runtime.taskManager.createTask({
    title: "Audit Security Policy",
    description: "Review security policies across workspaces",
    assignedAgentId: "agent_reviewer",
    priority: "high",
  });
  runtime.taskManager.startTask(task.id);
  runtime.taskManager.addStep(task.id, {
    description: "Audited security rules",
    tool: "workspace_read_file",
    toolResult: "Rules compliant",
  });

  // Complete task with deliverable
  runtime.taskManager.completeTask(task.id, "Security audit report: All policies pass verification.");

  const overview = runtime.activityMonitor.getOverview();
  const morgan = overview.find((a) => a.agentId === "agent_reviewer");
  assert.ok(morgan);
  assert.ok(morgan.latestExecutionResult);
  assert.equal(morgan.latestExecutionResult.taskId, task.id);
  assert.equal(morgan.latestExecutionResult.status, "COMPLETED");
  assert.equal(morgan.latestExecutionResult.result, "Security audit report: All policies pass verification.");
  assert.ok(morgan.latestExecutionResult.toolsExecuted.includes("workspace_read_file"));
  assert.equal(morgan.stats.completedTasks, 1);
});

test("4. ActivityMonitor: Agent Detail view provides complete task execution history & chronological timeline", async (t) => {
  const { runtime, sse } = setupTestEnv();
  t.after(() => {
    runtime.shutdown();
    sse.destroy();
  });

  // Create two tasks for Robin
  const t1 = runtime.taskManager.createTask({
    title: "Gather Reference Docs",
    description: "Find conventions",
    assignedAgentId: "agent_researcher",
  });
  runtime.taskManager.startTask(t1.id);
  runtime.taskManager.addStep(t1.id, {
    description: "Read CONTRIBUTING.md",
    tool: "workspace_read_file",
  });
  runtime.taskManager.completeTask(t1.id, "Conventions gathered");

  const t2 = runtime.taskManager.createTask({
    title: "Search AI Standards",
    description: "Analyze standards",
    assignedAgentId: "agent_researcher",
  });
  runtime.taskManager.startTask(t2.id);
  runtime.taskManager.addStep(t2.id, {
    description: "Read docs/standards.md",
    tool: "workspace_read_file",
  });

  const detail = runtime.activityMonitor.getAgentDetail("agent_researcher");
  assert.ok(detail);
  assert.equal(detail.overview.agentId, "agent_researcher");
  assert.equal(detail.taskHistory.length, 2, "Task history must list both tasks");
  assert.ok(detail.recentTimeline.length > 0, "Chronological timeline must be populated");
  assert.ok(detail.toolsUsage["workspace_read_file"] >= 2, "Tool usage must aggregate across tasks");
});

test("5. ActivityMonitor: System-wide activity stats reflect accurate real-time metrics", async (t) => {
  const { runtime, sse } = setupTestEnv();
  t.after(() => {
    runtime.shutdown();
    sse.destroy();
  });

  const stats = runtime.activityMonitor.getSystemStats();
  assert.ok(stats.totalAgents >= 5);
  assert.ok(stats.activeAgents >= 5);
  assert.equal(typeof stats.activeTasks, "number");
  assert.equal(typeof stats.completedTasks, "number");
  assert.equal(stats.systemHealth, "healthy");
});

test("6. ActivityMonitor REST Endpoints: Work end-to-end over HTTP", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-act-http-"));
  const port = 19993;

  const server = await createStarOfficeWorld({
    worldId: "test-activity-api-world",
    port,
    isPublic: false,
    dataDir: tempDir,
    enableAgentRuntime: true,
  });

  t.after(async () => {
    await server.stop();
  });

  const base = `http://localhost:${port}`;

  // 1. GET /api/activity-monitor
  const resOverview = await fetch(`${base}/api/activity-monitor`);
  assert.equal(resOverview.status, 200);
  const dataOverview = await resOverview.json();
  assert.equal(dataOverview.ok, true);
  assert.ok(Array.isArray(dataOverview.agents));
  assert.ok(dataOverview.agents.length >= 5);
  const nova = dataOverview.agents.find((a) => a.agentId === "agent_nova");
  assert.ok(nova);
  assert.equal(nova.name, "Nova");

  // 2. GET /api/activity-monitor/stats
  const resStats = await fetch(`${base}/api/activity-monitor/stats`);
  assert.equal(resStats.status, 200);
  const dataStats = await resStats.json();
  assert.equal(dataStats.ok, true);
  assert.ok(dataStats.stats.totalAgents >= 5);

  // 3. GET /api/activity-monitor/agents/:agentId (Valid)
  const resDetail = await fetch(`${base}/api/activity-monitor/agents/agent_nova`);
  assert.equal(resDetail.status, 200);
  const dataDetail = await resDetail.json();
  assert.equal(dataDetail.ok, true);
  assert.equal(dataDetail.agent.overview.agentId, "agent_nova");
  assert.ok(Array.isArray(dataDetail.agent.taskHistory));
  assert.ok(Array.isArray(dataDetail.agent.recentTimeline));

  // 4. GET /api/activity-monitor/agents/:agentId (Non-existent)
  const resNotFound = await fetch(`${base}/api/activity-monitor/agents/non_existent_agent`);
  assert.equal(resNotFound.status, 404);
  const dataNotFound = await resNotFound.json();
  assert.equal(dataNotFound.ok, false);
});
