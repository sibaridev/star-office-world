/**
 * Star Office World — Phase 14 Agent Management Automated Test Suite
 * Validates agent creation, configuration, cloning, lifecycle, fine-grained permissions,
 * versioning, rollback, templates, test playground, and REST endpoints.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { AgentConfigManager, DEFAULT_PERMISSIONS } from "../dist/agents/management/AgentConfigManager.js";
import { BUILTIN_AGENT_TEMPLATES } from "../dist/agents/management/templates.js";
import { AgentTestPlayground } from "../dist/agents/management/AgentTestPlayground.js";
import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { PromptRegistry } from "../dist/agents/prompts/PromptRegistry.js";
import { createStarOfficeWorld } from "../dist/index.js";

function createTempDir(prefix = "star-office-agent-mgmt-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("1. AgentConfigManager initializes and migrates default agents to full schema", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  const agents = mgr.listAgents();
  assert.ok(agents.length >= 4, "Should initialize at least 4 default agents");

  const alex = mgr.getAgent("agent_coordinator");
  assert.ok(alex, "Alex coordinator should exist");
  assert.equal(alex.agentId, "agent_coordinator");
  assert.equal(alex.lifecycleStatus, "ACTIVE");
  assert.equal(alex.configVersion, 1);
  assert.ok(alex.permissions.canModifyFiles);
  assert.ok(alex.permissions.canUseAntigravity);
  assert.ok(alex.permissions.canCommunicateWithPeers);

  // Check history folder
  const history = mgr.getHistory("agent_coordinator");
  assert.ok(history.length >= 1, "Should record initial configuration version in history");
  assert.equal(history[0].versionId, "cfg_v1");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("2. Agent creation: validates required fields, unique ID, and creates new agent", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  // Validation failure: missing fields
  assert.throws(() => {
    mgr.createAgent({
      agentId: "invalid slug!",
      name: "",
      role: "",
      description: "",
      avatar: "guest_role_1",
      systemPrompt: "",
      allowedTools: [],
      responsibilities: [],
      objectives: [],
      expectedOutputs: [],
      expertise: [],
      skills: [],
      permissions: DEFAULT_PERMISSIONS,
      memory: { memoryType: "persistent", retentionDays: 30, maxEntries: 100 },
      team: { collaboratingAgentIds: [], allowedDelegators: [] },
      execution: { temperature: 0.5, maxIterations: 6, timeoutMs: 30000, retryPolicy: "none" },
      lifecycleStatus: "CONFIGURED",
    });
  }, /Invalid agent configuration/);

  // Valid creation
  const created = mgr.createAgent({
    agentId: "agent_qa_lead",
    name: "Taylor",
    role: "Lead QA Engineer",
    description: "Orchestrates testing pipelines and verification.",
    avatar: "guest_role_5",
    systemPrompt: "You are Taylor, Lead QA Engineer.",
    allowedTools: ["workspace_read_file", "workspace_write_file"],
    responsibilities: ["Write test plans", "Execute smoke tests"],
    objectives: ["Zero defect delivery"],
    expectedOutputs: ["Test reports"],
    expertise: ["Integration testing", "Unit testing"],
    skills: [{ id: "test_authoring", name: "Test Authoring", description: "Creates unit tests" }],
    permissions: {
      ...DEFAULT_PERMISSIONS,
      canUseAntigravity: false,
    },
    memory: { memoryType: "persistent", retentionDays: 14, maxEntries: 500 },
    team: { collaboratingAgentIds: ["agent_coordinator"], allowedDelegators: ["agent_coordinator"] },
    execution: { temperature: 0.2, maxIterations: 5, timeoutMs: 30000, retryPolicy: "none" },
    lifecycleStatus: "READY",
  });

  assert.equal(created.agentId, "agent_qa_lead");
  assert.equal(created.configVersion, 1);
  assert.equal(created.lifecycleStatus, "READY");

  // Duplicate ID prevention
  assert.throws(() => {
    mgr.createAgent({
      ...created,
    });
  }, /already exists/);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("3. Agent update, config versioning, and rollback", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  const initial = mgr.getAgent("agent_researcher");
  assert.ok(initial);
  assert.equal(initial.configVersion, 1);

  // Update role and temperature
  const updated = mgr.updateAgent(
    "agent_researcher",
    {
      role: "Lead Research Specialist & Data Analyst",
      execution: {
        ...initial.execution,
        temperature: 0.3,
      },
    },
    "test_user",
    "Specialized role update"
  );

  assert.equal(updated.configVersion, 2);
  assert.equal(updated.role, "Lead Research Specialist & Data Analyst");
  assert.equal(updated.execution.temperature, 0.3);

  const history = mgr.getHistory("agent_researcher");
  assert.equal(history.length, 2, "Should have 2 versions in history");
  assert.equal(history[0].versionId, "cfg_v2");
  assert.equal(history[1].versionId, "cfg_v1");

  // Rollback to v1
  const rolledBack = mgr.rollback("agent_researcher", "cfg_v1", "Reverting test edit", "test_user");
  assert.equal(rolledBack.configVersion, 3, "Rollback creates new version");
  assert.equal(rolledBack.role, initial.role, "Restored original role");
  assert.equal(rolledBack.execution.temperature, initial.execution.temperature, "Restored temperature");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("4. Safe deletion vs archival", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  // Main agent cannot be deleted without force
  assert.throws(() => {
    mgr.deleteAgent("agent_coordinator", false);
  }, /Cannot delete main agent/);

  // Active agent cannot be deleted without force
  assert.throws(() => {
    mgr.deleteAgent("agent_writer", false);
  }, /Cannot delete active agent/);

  // Archival works safely
  const archived = mgr.archiveAgent("agent_writer");
  assert.equal(archived.lifecycleStatus, "ARCHIVED");

  // Editing archived agent is blocked
  assert.throws(() => {
    mgr.updateAgent("agent_writer", { name: "Sam Modified" });
  }, /is archived and cannot be edited/);

  // Deletion with force succeeds
  const del = mgr.deleteAgent("agent_writer", true);
  assert.ok(del.success);
  assert.equal(mgr.getAgent("agent_writer"), undefined);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("5. Agent cloning", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  const clone = mgr.cloneAgent("agent_coordinator", "agent_coordinator_backup", "Alex Backup Lead");
  assert.equal(clone.agentId, "agent_coordinator_backup");
  assert.equal(clone.name, "Alex Backup Lead");
  assert.equal(clone.isMain, false, "Clones should not inherit main agent status");
  assert.equal(clone.lifecycleStatus, "CONFIGURED");
  assert.equal(clone.configVersion, 1);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("6. Built-in templates and custom template creation", () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);

  const templates = mgr.listTemplates();
  assert.equal(templates.length, 12, "Should have 12 built-in templates");

  const arch = mgr.getTemplate("tpl_software_architect");
  assert.ok(arch);
  assert.equal(arch.baseRole, "Principal Software Architect");
  assert.ok(arch.recommendedTools.includes("delegate_to_antigravity"));

  // Save custom template
  const custom = mgr.saveCustomTemplate({
    name: "DevOps Automation Specialist",
    category: "Operations",
    description: "Manages CI/CD, deployment pipelines, and environment configuration.",
    baseRole: "DevOps Engineer",
    defaultAvatar: "guest_role_5",
    defaultSystemPrompt: "You are a DevOps Automation Specialist in Star Office World.",
    recommendedTools: ["workspace_read_file", "workspace_write_file"],
    recommendedSkills: [{ id: "ci_cd", name: "CI/CD", description: "Pipeline management" }],
    defaultPermissions: DEFAULT_PERMISSIONS,
    defaultExecution: { temperature: 0.2, maxIterations: 6, timeoutMs: 30000, retryPolicy: "none" },
  });

  assert.ok(custom.templateId);
  assert.equal(custom.isBuiltIn, false);

  const reloaded = mgr.listTemplates();
  assert.equal(reloaded.length, 13, "Should include newly saved custom template");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("7. Fine-grained backend permission enforcement", async () => {
  const registry = new ToolRegistry();
  const testDir = createTempDir();
  const workspaceDir = path.join(testDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  // 1. canModifyFiles = false blocks workspace_write_file
  const res1 = await registry.executeTool(
    "workspace_write_file",
    { filePath: "test.txt", content: "hello" },
    {
      agentId: "agent_tester",
      agentName: "Tester",
      dataDir: testDir,
      workspaceDir,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        canModifyFiles: false,
      },
    },
    ["workspace_write_file"]
  );
  assert.equal(res1.success, false);
  assert.match(res1.error || "", /canModifyFiles/);

  // 2. canUseAntigravity = false blocks delegate_to_antigravity
  const res2 = await registry.executeTool(
    "delegate_to_antigravity",
    { workspaceId: "ws_1", title: "Task" },
    {
      agentId: "agent_tester",
      agentName: "Tester",
      dataDir: testDir,
      workspaceDir,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        canUseAntigravity: false,
      },
    },
    ["delegate_to_antigravity"]
  );
  assert.equal(res2.success, false);
  assert.match(res2.error || "", /canUseAntigravity/);

  // 3. canAccessNetwork = false blocks web_search
  const res3 = await registry.executeTool(
    "web_search",
    { query: "node test" },
    {
      agentId: "agent_tester",
      agentName: "Tester",
      dataDir: testDir,
      workspaceDir,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        canAccessNetwork: false,
      },
    },
    ["web_search"]
  );
  assert.equal(res3.success, false);
  assert.match(res3.error || "", /canAccessNetwork/);

  // 4. canCommunicateWithPeers = false blocks send_agent_message
  const res4 = await registry.executeTool(
    "send_agent_message",
    { toAgentId: "agent_writer", message: "Hi" },
    {
      agentId: "agent_tester",
      agentName: "Tester",
      dataDir: testDir,
      workspaceDir,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        canCommunicateWithPeers: false,
      },
    },
    ["send_agent_message"]
  );
  assert.equal(res4.success, false);
  assert.match(res4.error || "", /canCommunicateWithPeers/);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("8. Agent Test Playground executes in sandbox without mutating production", async () => {
  const testDir = createTempDir();
  const mgr = new AgentConfigManager(testDir);
  const toolRegistry = new ToolRegistry();

  const mockAiProvider = {
    async generate(req) {
      return {
        text: `Playground simulation response for instruction: "${req.prompt.slice(0, 30)}..." {"action":"tool","tool":"workspace_read_file","args":{"filePath":"dummy.txt"}}`,
      };
    },
    async testConnection() {
      return { ok: true, latencyMs: 5 };
    },
  };

  const playground = new AgentTestPlayground({
    aiProvider: mockAiProvider,
    toolRegistry,
    configManager: mgr,
  });

  const res = await playground.runTest({
    agentId: "agent_coordinator",
    testInstruction: "Assess system integrity and report status",
    toolsEnabled: true,
  });

  assert.equal(res.success, true);
  assert.equal(res.agentId, "agent_coordinator");
  assert.ok(res.effectivePrompt.includes("[TEST PLAYGROUND SANDBOX ENVIRONMENT]"));
  assert.ok(res.toolCallsMade.length >= 1);
  assert.equal(res.toolCallsMade[0].tool, "workspace_read_file");
  assert.equal(res.toolCallsMade[0].result, "[Simulated in Playground Sandbox]");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("9. UI REST endpoints for Agent Management work end-to-end", async () => {
  const tempDir = createTempDir();
  const port = 19570;
  const server = await createStarOfficeWorld({
    port,
    publicPort: port,
    dataDir: tempDir,
    memoryDir: path.join(tempDir, "memos"),
    worldId: "test-agent-mgmt-world",
    isPublic: false,
    enableAgentRuntime: true,
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/agent-management/agents
    const listRes = await fetch(`${baseUrl}/api/agent-management/agents`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.ok, true);
    assert.ok(listData.agents.length >= 4);

    // 2. GET /api/agent-management/templates
    const tplRes = await fetch(`${baseUrl}/api/agent-management/templates`);
    assert.equal(tplRes.status, 200);
    const tplData = await tplRes.json();
    assert.equal(tplData.ok, true);
    assert.equal(tplData.templates.length, 12);

    // 3. POST /api/agent-management/agents (Create)
    const createRes = await fetch(`${baseUrl}/api/agent-management/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_qa_bot",
        name: "QABot",
        role: "Automated Tester",
        description: "Runs CI test suites",
        avatar: "guest_role_5",
        systemPrompt: "You are QABot.",
        allowedTools: ["workspace_read_file"],
        responsibilities: ["Run tests"],
        objectives: ["Catch bugs"],
        expectedOutputs: ["Reports"],
        expertise: ["Testing"],
        skills: [],
        permissions: DEFAULT_PERMISSIONS,
        memory: { memoryType: "task_only", retentionDays: 7, maxEntries: 100 },
        team: { collaboratingAgentIds: [], allowedDelegators: [] },
        execution: { temperature: 0.1, maxIterations: 4, timeoutMs: 20000, retryPolicy: "none" },
        lifecycleStatus: "ACTIVE",
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.ok, true);
    assert.equal(createData.agent.agentId, "agent_qa_bot");

    // 4. POST /api/agent-management/agents/:agentId/status (Pause)
    const statusRes = await fetch(`${baseUrl}/api/agent-management/agents/agent_qa_bot/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED", reason: "Owner maintenance" }),
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.agent.lifecycleStatus, "PAUSED");

    // 5. POST /api/agent-management/agents/:agentId/clone
    const cloneRes = await fetch(`${baseUrl}/api/agent-management/agents/agent_qa_bot/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAgentId: "agent_qa_bot_cloned", newName: "QABot 2.0" }),
    });
    assert.equal(cloneRes.status, 201);
    const cloneData = await cloneRes.json();
    assert.equal(cloneData.agent.agentId, "agent_qa_bot_cloned");

    // 6. POST /api/agent-management/test (Playground)
    const testPlayRes = await fetch(`${baseUrl}/api/agent-management/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_qa_bot",
        testInstruction: "Verify test status",
        toolsEnabled: true,
      }),
    });
    assert.equal(testPlayRes.status, 200);
    const testPlayData = await testPlayRes.json();
    assert.equal(testPlayData.ok, true);
    assert.equal(testPlayData.result.agentId, "agent_qa_bot");
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
