/**
 * Star Office World — Agent Management Type Definitions
 */

export type AgentLifecycleStatus =
  | "DRAFT"
  | "CONFIGURED"
  | "VALIDATING"
  | "READY"
  | "ACTIVE"
  | "PAUSED"
  | "ERROR"
  | "ARCHIVED";

export interface AgentPermission {
  canModifyFiles: boolean;
  canDelegateTasks: boolean;
  canCommunicateWithPeers: boolean;
  canUseAntigravity: boolean;
  canExecuteTests: boolean;
  canAccessNetwork: boolean;
  requiresApprovalForSensitiveOps: boolean;
  allowedWorkspacePaths?: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  config?: Record<string, unknown>;
}

export interface AgentMemoryConfig {
  memoryType: "persistent" | "task_only" | "shared";
  retentionDays: number;
  maxEntries: number;
}

export interface AgentTeamConfig {
  teamId?: string;
  reportsToAgentId?: string;
  collaboratingAgentIds: string[];
  allowedDelegators: string[]; // which agents can assign tasks to it (empty = all)
}

export interface AgentExecutionConfig {
  temperature: number;
  maxIterations: number;
  timeoutMs: number;
  retryPolicy: "none" | "exponential";
}

export interface FullAgentConfig {
  agentId: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  displayColor?: string;
  systemPrompt: string;
  allowedTools: string[];
  isMain?: boolean;
  responsibilities: string[];
  objectives: string[];
  expectedOutputs: string[];
  expertise: string[];
  skills: AgentSkill[];
  permissions: AgentPermission;
  memory: AgentMemoryConfig;
  team: AgentTeamConfig;
  execution: AgentExecutionConfig;
  lifecycleStatus: AgentLifecycleStatus;
  configVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentConfigVersion {
  agentId: string;
  configVersion: number;
  versionId: string; // e.g. "cfg_v1"
  configuration: FullAgentConfig;
  changedFields: string[];
  author: string;
  timestamp: number;
  changeReason: string;
  hash: string;
}

export interface AgentTemplate {
  templateId: string;
  name: string;
  category: string;
  description: string;
  baseRole: string;
  defaultAvatar: string;
  defaultSystemPrompt: string;
  recommendedTools: string[];
  recommendedSkills: AgentSkill[];
  defaultPermissions: AgentPermission;
  defaultExecution: AgentExecutionConfig;
  isBuiltIn: boolean;
}

export interface AgentTestPlaygroundRequest {
  agentId?: string;
  tempConfig?: Partial<FullAgentConfig>;
  testInstruction: string;
  toolsEnabled?: boolean;
}

export interface AgentTestPlaygroundResult {
  agentId: string;
  input: string;
  effectivePrompt: string;
  modelProvider: string;
  toolsAvailable: string[];
  toolCallsMade: Array<{ tool: string; args: Record<string, unknown>; result?: string }>;
  response: string;
  executionDurationMs: number;
  success: boolean;
  errors?: string[];
}
