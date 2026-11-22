/**
 * Star Office World — Agent Runtime Type Definitions
 */

export type AgentRuntimeState =
  | "CREATED"
  | "INITIALIZING"
  | "IDLE"
  | "RECEIVING_TASK"
  | "THINKING"
  | "EXECUTING"
  | "COMMUNICATING"
  | "WAITING"
  | "COMPLETED"
  | "ERROR"
  | "PAUSED"
  | "OFFLINE";

export interface AgentConfig {
  agentId: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  systemPrompt: string;
  allowedTools: string[];
  isMain?: boolean;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  timestamp: number;
  taskId?: string;
}

export interface AgentMemoryEntry {
  timestamp: number;
  type: "observation" | "plan" | "action" | "result" | "communication";
  content: string;
  taskId?: string;
}
