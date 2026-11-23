/**
 * Star Office World — Agent Test Playground
 * Runs sample instructions in a sandbox to evaluate agent responses,
 * verify prompt behavior, and inspect tool decisions without side-effects.
 */

import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { AgentConfigManager } from "./AgentConfigManager.js";
import type {
  AgentTestPlaygroundRequest,
  AgentTestPlaygroundResult,
  FullAgentConfig,
} from "./types.js";

export class AgentTestPlayground {
  private aiProvider: AIProvider;
  private toolRegistry?: ToolRegistry;
  private configManager: AgentConfigManager;

  constructor(opts: {
    aiProvider: AIProvider;
    toolRegistry?: ToolRegistry;
    configManager: AgentConfigManager;
  }) {
    this.aiProvider = opts.aiProvider;
    this.toolRegistry = opts.toolRegistry;
    this.configManager = opts.configManager;
  }

  public async runTest(
    request: AgentTestPlaygroundRequest
  ): Promise<AgentTestPlaygroundResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const agentId = request.agentId || "test_agent";

    // 1. Resolve configuration
    let baseConfig: FullAgentConfig | undefined;
    if (request.agentId) {
      baseConfig = this.configManager.getAgent(request.agentId);
    }

    const effectiveConfig: Partial<FullAgentConfig> = {
      name: request.tempConfig?.name || baseConfig?.name || "Test Agent",
      role: request.tempConfig?.role || baseConfig?.role || "Quality Evaluator",
      systemPrompt:
        request.tempConfig?.systemPrompt ||
        baseConfig?.systemPrompt ||
        "You are an AI assistant in Star Office World testing sandbox.",
      allowedTools:
        request.tempConfig?.allowedTools ||
        baseConfig?.allowedTools ||
        [],
      execution: request.tempConfig?.execution || baseConfig?.execution,
    };

    const toolsAvailable = request.toolsEnabled !== false ? effectiveConfig.allowedTools || [] : [];
    const toolDeclarations =
      this.toolRegistry && toolsAvailable.length > 0
        ? this.toolRegistry.getToolDeclarations(toolsAvailable)
        : "No tools available.";

    const systemInstruction = `[TEST PLAYGROUND SANDBOX ENVIRONMENT]
${effectiveConfig.systemPrompt}

You are ${effectiveConfig.name}, role: ${effectiveConfig.role} in Star Office World.
You are running in the Agent Test Playground Sandbox.

AVAILABLE TOOLS:
${toolDeclarations}

CRITICAL EXECUTION INTEGRITY RULES:
- You HAVE active authorization and full access to invoke any of the tools listed in AVAILABLE TOOLS.
- When an instruction requests an action (such as creating, writing, modifying, reading, or listing files, running git/antigravity checks, delegating tasks, or searching), you MUST invoke the appropriate tool using the JSON decision format below.
- NEVER claim that you do not have access to the workspace, filesystem, or Antigravity bridge tools.
- NEVER output excuses such as "I don't have access to...", "I lack tools in this environment", or instruct the user to run commands or create files manually.
- When invoking a tool, format your output as a JSON block:
\`\`\`json
{
  "action": "tool",
  "tool": "<tool_name>",
  "args": { ... },
  "thought": "Reasoning for using this tool"
}
\`\`\`
If no tool is required, provide your final response directly.`;

    const prompt = `Test Instruction: ${request.testInstruction}

Analyze and act upon this test instruction. If an action or tool is needed to fulfill this instruction, invoke it now using the JSON decision format:
\`\`\`json
{
  "action": "tool",
  "tool": "<tool_name>",
  "args": { ... },
  "thought": "..."
}
\`\`\`
Do not apologize or refuse.`;

    const toolCallsMade: Array<{ tool: string; args: Record<string, unknown>; result?: string }> = [];
    let responseText = "";
    let success = false;

    try {
      const result = await this.aiProvider.generate({
        prompt,
        systemInstruction,
        temperature: effectiveConfig.execution?.temperature ?? 0.7,
      });

      responseText = result.text || "";
      success = true;

      // Detect simulated tool calls in the output (supporting codeblocks or raw JSON)
      const codeBlockMatches = [...responseText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
      const candidateStrings = codeBlockMatches.length > 0 ? codeBlockMatches.map((m) => m[1]) : [responseText];

      for (const str of candidateStrings) {
        let startIdx = 0;
        while ((startIdx = str.indexOf("{", startIdx)) !== -1) {
          let depth = 0;
          let inString = false;
          let escape = false;
          let endIdx = -1;

          for (let i = startIdx; i < str.length; i++) {
            const char = str[i];
            if (escape) {
              escape = false;
              continue;
            }
            if (char === "\\") {
              escape = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              continue;
            }
            if (!inString) {
              if (char === "{") depth++;
              else if (char === "}") {
                depth--;
                if (depth === 0) {
                  endIdx = i;
                  break;
                }
              }
            }
          }

          if (endIdx !== -1) {
            const jsonSub = str.slice(startIdx, endIdx + 1);
            try {
              const parsed = JSON.parse(jsonSub);
              if (parsed && parsed.action === "tool" && parsed.tool) {
                toolCallsMade.push({
                  tool: parsed.tool,
                  args: parsed.args || {},
                  result: "[Simulated in Playground Sandbox]",
                });
              }
            } catch {
              // Not valid json block
            }
            startIdx = endIdx + 1;
          } else {
            break;
          }
        }
      }

      // Fallback regex detection if balanced brace search didn't catch a flat tool call
      if (toolCallsMade.length === 0) {
        const fallbackMatch = responseText.match(/\{[\s\S]*"action"\s*:\s*"tool"[\s\S]*\}/);
        if (fallbackMatch) {
          try {
            const parsed = JSON.parse(fallbackMatch[0]);
            if (parsed.tool) {
              toolCallsMade.push({
                tool: parsed.tool,
                args: parsed.args || {},
                result: "[Simulated in Playground Sandbox]",
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      responseText = `Playground Error: ${msg}`;
    }

    const duration = Date.now() - startTime;

    return {
      agentId,
      input: request.testInstruction,
      effectivePrompt: systemInstruction,
      modelProvider: "GeminiSessionProvider",
      toolsAvailable,
      toolCallsMade,
      response: responseText,
      executionDurationMs: duration,
      success,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
