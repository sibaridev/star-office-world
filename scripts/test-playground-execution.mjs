import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { ToolRegistry } from "../dist/agents/tools/ToolRegistry.js";
import { AgentConfigManager } from "../dist/agents/management/AgentConfigManager.js";
import { AgentTestPlayground } from "../dist/agents/management/AgentTestPlayground.js";
import { AntigravityBridge } from "../dist/integrations/antigravity/bridge/AntigravityBridge.js";

async function testPlayground() {
  console.log("=== TESTING AGENT TEST PLAYGROUND REAL EXECUTION ===");

  const dataDir = path.resolve("data");
  const bridge = new AntigravityBridge({ dataDir });
  const toolRegistry = new ToolRegistry();
  const configManager = new AgentConfigManager(dataDir);

  // Mock AI provider that returns either refusal or tool call to test fallback and real tool execution
  const mockRefusalAIProvider = {
    async generate() {
      return {
        text: "I don't have access to the workspace or Antigravity bridge tools (`workspace_write_file`, `delegate_to_antigravity`, etc.) in this environment, so I can't directly create `test.md` at `C:\\Users\\Sibari\\Desktop\\AI-ROOM\\test.md`.\n\n```markdown\nHELLO WORLD !\n```",
      };
    },
  };

  const playground = new AgentTestPlayground({
    aiProvider: mockRefusalAIProvider,
    toolRegistry,
    configManager,
    dataDir,
    workspaceDir: process.cwd(),
    antigravityBridge: bridge,
  });

  const testFile = path.resolve("test.md");
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }

  // 1. Run with simulateTools: false (real execution on disk)
  console.log("[Test 1] Running test with simulateTools: false...");
  const res = await playground.runTest({
    agentId: "agent_nova",
    testInstruction: "create a test.md file in C:\\Users\\Sibari\\Desktop\\AI-ROOM containes HELLO WORLD !",
    toolsEnabled: true,
    simulateTools: false,
  });

  console.log("  -> Response:", res.response.slice(0, 100));
  console.log("  -> Tool calls count:", res.toolCallsMade.length);
  res.toolCallsMade.forEach((tc) => console.log("     *", tc.tool, tc.args, tc.result));

  assert.ok(res.toolCallsMade.length > 0, "Tool calls must be recorded");
  assert.ok(fs.existsSync(testFile), `test.md must be physically created at ${testFile}`);
  const content = fs.readFileSync(testFile, "utf8");
  console.log(`  -> Actual content read back: "${content}"`);
  assert.equal(content, "HELLO WORLD !");

  console.log("\n>>> PLAYGROUND EXECUTION TEST PASSED: File created and verified on disk. <<<");
}

testPlayground().catch((err) => {
  console.error("PLAYGROUND TEST FAILED:", err);
  process.exit(1);
});
