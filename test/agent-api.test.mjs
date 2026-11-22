import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createStarOfficeWorld } from "../dist/index.js";

test("API Routes — Task and Runtime endpoints work end-to-end", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-api-test-"));
  const port = 19567;

  const server = await createStarOfficeWorld({
    port,
    publicPort: port,
    dataDir: tempDir,
    memoryDir: path.join(tempDir, "memos"),
    worldId: "test-api-world",
    isPublic: false,
    enableAgentRuntime: true,
  });

  try {
    const baseUrl = `http://localhost:${port}`;

    // 1. Check Gemini health endpoint
    const healthRes = await fetch(`${baseUrl}/api/gemini/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.provider, "gemini-session");
    assert.ok(healthData.session);

    // 2. Check Runtime Agents list (4 specialized agents pre-configured)
    const agentsRes = await fetch(`${baseUrl}/api/agents/runtime`);
    assert.equal(agentsRes.status, 200);
    const agentsData = await agentsRes.json();
    assert.equal(agentsData.ok, true);
    assert.ok(agentsData.agents.length >= 4);

    const coordinator = agentsData.agents.find((a) => a.agentId === "agent_coordinator");
    assert.ok(coordinator, "Coordinator agent must exist");
    assert.equal(coordinator.name, "Alex");

    // 3. Create a task via POST /api/tasks
    const taskPayload = {
      title: "Synthesize AI Research",
      description: "Research recent developments and draft a summary",
      priority: "high",
    };

    const postTaskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskPayload),
    });
    assert.equal(postTaskRes.status, 200);
    const postTaskData = await postTaskRes.json();
    assert.equal(postTaskData.ok, true);
    assert.ok(postTaskData.task.id);
    assert.equal(postTaskData.task.title, taskPayload.title);

    // 4. Fetch tasks via GET /api/tasks
    const listTasksRes = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(listTasksRes.status, 200);
    const listTasksData = await listTasksRes.json();
    assert.equal(listTasksData.ok, true);
    assert.ok(listTasksData.tasks.length >= 1);
    assert.equal(listTasksData.tasks[0].id, postTaskData.task.id);

    // 5. Fetch single task details
    const singleTaskRes = await fetch(`${baseUrl}/api/tasks/${postTaskData.task.id}`);
    assert.equal(singleTaskRes.status, 200);
    const singleTaskData = await singleTaskRes.json();
    assert.equal(singleTaskData.ok, true);
    assert.equal(singleTaskData.task.title, taskPayload.title);
  } finally {
    await server.stop();
  }
});
