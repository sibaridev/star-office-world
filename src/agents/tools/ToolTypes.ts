/**
 * Star Office World — Agent Tool Interfaces
 */

export interface ToolParameterSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameterSchema>;
  riskLevel: "low" | "medium" | "high";
  timeoutMs?: number;
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  agentId: string;
  agentName: string;
  taskId?: string;
  dataDir: string;
  workspaceDir: string;
  eventBus?: (event: string, payload: unknown) => void;
  antigravityBridge?: any;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}
