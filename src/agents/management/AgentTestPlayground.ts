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

You are in a safe test playground. Analyze the instruction and reply clearly.
Available Tools:
${toolDeclarations}`;

    const prompt = `Test Instruction: ${request.testInstruction}

Respond directly to the test prompt. If you need a tool, indicate it clearly using JSON format:
{"action":"tool","tool":"<tool_name>","args":{...}}
Otherwise, provide your final analysis.`;

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

      // Detect simulated tool calls in the output
      const jsonMatch = responseText.match(/\{[\s\S]*"action"\s*:\s*"tool"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.tool) {
            toolCallsMade.push({
              tool: parsed.tool,
              args: parsed.args || {},
              result: "[Simulated in Playground Sandbox]",
            });
          }
        } catch {
          // not valid json tool call
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
