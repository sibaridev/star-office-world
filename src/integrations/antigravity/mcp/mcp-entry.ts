/**
 * Star Office World — Standalone Antigravity MCP Stdio Server Entrypoint
 * Can be run via: node dist/integrations/antigravity/mcp/mcp-entry.js
 */

import readline from "node:readline";
import path from "node:path";
import { createInitialState } from "../../../state.js";
import { SSEManager } from "../../../sse.js";
import { MemoStore } from "../../../memo-store.js";
import { AntigravityBridge } from "../bridge/AntigravityBridge.js";
import { AntigravityMCPServer } from "./AntigravityMCPServer.js";

async function main() {
  const dataDir = process.env["DATA_DIR"] || path.resolve("./data");
  const state = createInitialState({});
  const sse = new SSEManager();
  const memoStore = new MemoStore(path.join(dataDir, "memos"));

  const bridge = new AntigravityBridge({
    officeState: state,
    sse,
    memoStore,
    dataDir,
  });

  const mcpServer = new AntigravityMCPServer(bridge);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const response = await mcpServer.handleJsonRpc(parsed);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (err) {
      const errRes = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(JSON.stringify(errRes) + "\n");
    }
  });

  process.on("SIGINT", () => {
    sse.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`Antigravity MCP Server error: ${err.message}\n`);
  process.exit(1);
});
