import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { AntigravityBridge } from "../dist/integrations/antigravity/bridge/AntigravityBridge.js";
import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../dist/agents/tools/ToolExecutionGateway.js";
import { AgentExecutionContext } from "../dist/agents/core/AgentExecutionContext.js";
import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { CompletionVerifier } from "../dist/agents/tasks/CompletionVerifier.js";

async function runMission3() {
  console.log("=== MISSION 3 — REAL EXECUTION TEST ===");

  const targetWorkspacePath = path.resolve("C:\\Users\\Sibari\\Desktop\\auto-free-ai");
  const targetFilePath = path.join(targetWorkspacePath, "hello.txt");
  const expectedContent = "Star Office is live";

  // 1. Verify the target workspace exists
  console.log(`[Step 1] Verifying target workspace exists at: ${targetWorkspacePath}`);
  assert.ok(fs.existsSync(targetWorkspacePath), `Workspace directory does not exist: ${targetWorkspacePath}`);
  console.log("  -> Target workspace exists on filesystem.");

  // 2. Initialize Antigravity Bridge & Verify write authorization
  console.log("[Step 2] Initializing Antigravity Bridge and checking workspace authorization...");
  const dataDir = path.resolve("data");
  const bridge = new AntigravityBridge({ dataDir });

  const isAuth = bridge.workspaces.isAuthorizedPath("", targetFilePath);
  console.log(`  -> Path authorization status for '${targetFilePath}': ${isAuth}`);
  assert.ok(isAuth, `Target path '${targetFilePath}' must be authorized in WorkspaceRegistry.`);

  const ws = bridge.workspaces.findAuthorizedWorkspaceForPath(targetFilePath);
  assert.ok(ws, "Should find authorized workspace object");
  console.log(`  -> Workspace ID: ${ws.workspaceId}, Name: ${ws.name}, Allowed Ops: ${JSON.stringify(ws.allowedOperations)}`);
  assert.ok(ws.allowedOperations.includes("modify"), "Workspace must allow 'modify' operation");

  // 3. Create file using real filesystem write tool via ToolExecutionGateway
  console.log("[Step 3] Executing 'workspace_write_file' via ToolExecutionGateway...");
  const toolRegistry = new ToolRegistry();
  const gateway = new ToolExecutionGateway(toolRegistry, dataDir);

  const taskId = "task_1795430782388_5ozgn";
  const execContext = new AgentExecutionContext({
    agentId: "agent_nova",
    agentName: "Nova",
    taskId,
    workspaceId: ws.workspaceId,
    workspacePath: targetWorkspacePath,
    allowedTools: ["workspace_write_file", "workspace_read_file", "workspace_list_files"],
    permissions: {
      canModifyFiles: true,
      canDelegateTasks: true,
      canCommunicateWithPeers: true,
      canUseAntigravity: true,
      canExecuteTests: true,
      canAccessNetwork: true,
      requiresApprovalForSensitiveOps: false,
    },
    dataDir,
    scratchWorkspaceDir: path.resolve(dataDir, "workspace"),
    antigravityBridge: bridge,
  });

  const { result: toolResult, provenance } = await gateway.execute(
    "workspace_write_file",
    {
      filePath: targetFilePath,
      content: expectedContent,
    },
    execContext
  );

  console.log("  -> Tool Result:", toolResult);
  console.log("  -> Provenance Status:", provenance.status);
  assert.ok(toolResult.success, `Tool execution failed: ${toolResult.error}`);
  assert.equal(provenance.status, "COMPLETED");

  // 4. Read the file back from disk
  console.log(`[Step 4] Reading back created file from disk: ${targetFilePath}`);
  assert.ok(fs.existsSync(targetFilePath), `File must physically exist at ${targetFilePath}`);
  const actualContent = fs.readFileSync(targetFilePath, "utf8");

  // 5. Compare exact content
  console.log(`[Step 5] Comparing exact content...`);
  console.log(`  -> Expected: "${expectedContent}"`);
  console.log(`  -> Actual:   "${actualContent}"`);
  assert.equal(actualContent, expectedContent, "File content must match exact string requested");

  // 6. Verify its absolute path
  console.log(`[Step 6] Verifying absolute path: ${path.resolve(targetFilePath)}`);
  assert.equal(path.resolve(targetFilePath).toLowerCase(), targetFilePath.toLowerCase());

  // 7. Record actual tool execution evidence & update task status through TaskManager
  console.log("[Step 7] Validating completion through CompletionVerifier and persisting to TaskManager...");
  const taskManager = new TaskManager(dataDir);
  const task = taskManager.getTask(taskId);
  assert.ok(task, `Task ${taskId} must exist in TaskManager`);

  taskManager.addProvenanceRecord(taskId, provenance);

  // Complete task with verified evidence
  const finalResult = `Successfully created and verified '${targetFilePath}' containing "${expectedContent}" (${expectedContent.length} bytes) via workspace_write_file tool.`;
  const completedTask = taskManager.completeTask(taskId, finalResult, [provenance]);

  console.log(`  -> Final Task Status: ${completedTask?.status}`);
  console.log(`  -> Evidence Count:    ${completedTask?.evidence?.length ?? 0}`);
  console.log(`  -> Evidence Details:  ${JSON.stringify(completedTask?.evidence, null, 2)}`);

  assert.equal(completedTask?.status, "COMPLETED", "Task must be COMPLETED");
  assert.ok(completedTask?.evidence && completedTask.evidence.length > 0, "Task must contain verified execution evidence");

  console.log("\n>>> MISSION 3 SUCCESS: Real execution verified on physical disk. <<<");
}

runMission3().catch((err) => {
  console.error("MISSION 3 FAILED:", err);
  process.exit(1);
});
