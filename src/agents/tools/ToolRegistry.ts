/**
 * Star Office World — Tool Registry
 */

import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./ToolTypes.js";
import {
  workspaceWriteFileTool,
  workspaceReadFileTool,
  workspaceListFilesTool,
} from "./builtins/WorkspaceTools.js";
import {
  webSearchTool,
  webFetchTool,
} from "./builtins/WebResearchTools.js";
import {
  sendAgentMessageTool,
  postOfficeMemoTool,
} from "./builtins/CommunicationTools.js";
import {
  delegateToAntigravityTool,
  checkAntigravityBridgeTool,
} from "./builtins/AntigravityTools.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register(workspaceWriteFileTool);
    this.register(workspaceReadFileTool);
    this.register(workspaceListFilesTool);
    this.register(webSearchTool);
    this.register(webFetchTool);
    this.register(sendAgentMessageTool);
    this.register(postOfficeMemoTool);
    this.register(delegateToAntigravityTool);
    this.register(checkAntigravityBridgeTool);
  }

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getToolDeclarations(allowedToolNames?: string[]): string {
    const list = this.listTools().filter((t) =>
      !allowedToolNames || allowedToolNames.includes(t.name)
    );

    return list
      .map((t) => {
        const params = Object.entries(t.parameters)
          .map(
            ([k, v]) =>
              `    - ${k} (${v.type}${v.required ? ", required" : ""}): ${v.description}`
          )
          .join("\n");
        return `* Tool: \`${t.name}\`\n  Description: ${t.description}\n  Parameters:\n${params}`;
      })
      .join("\n\n");
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    allowedTools?: string[]
  ): Promise<ToolExecutionResult> {
    if (allowedTools && !allowedTools.includes(name)) {
      return {
        success: false,
        output: "",
        error: `Permission Denied: Agent ${context.agentName} is not permitted to use tool '${name}'.`,
      };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Tool not found: '${name}'. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
      };
    }

    // Validate required parameters
    for (const [paramName, schema] of Object.entries(tool.parameters)) {
      if (schema.required && (args[paramName] === undefined || args[paramName] === null || args[paramName] === "")) {
        return {
          success: false,
          output: "",
          error: `Missing required parameter '${paramName}' for tool '${name}'.`,
        };
      }
    }

    // Execute with timeout
    const timeoutMs = tool.timeoutMs ?? 30000;
    try {
      const timeoutPromise = new Promise<ToolExecutionResult>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      return await Promise.race([
        tool.execute(args, context),
        timeoutPromise,
      ]);
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
