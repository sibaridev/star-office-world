/**
 * Star Office World — Task Types & Schemas
 * Enhanced with execution provenance, refined lifecycle states, and verifiable criteria.
 */

export type TaskStatus =
  | "QUEUED"
  | "PENDING"
  | "ASSIGNED"
  | "RUNNING"
  | "IN_PROGRESS"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_DEPENDENCY"
  | "BLOCKED"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

export interface TaskStep {
  stepNumber: number;
  description: string;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  thought?: string;
  timestamp: number;
  executionId?: string;
}

export type ProvenanceStatus =
  | "REQUESTED"
  | "AUTHORIZED"
  | "STARTED"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export interface ToolExecutionProvenance {
  executionId: string;
  taskId: string;
  parentTaskId?: string;
  agentId: string;
  tool: string;
  inputParameters: Record<string, unknown>;
  requestedAt: number;
  authorizedAt?: number;
  startedAt?: number;
  completedAt?: number;
  status: ProvenanceStatus;
  output?: string;
  error?: string;
  workspaceId?: string;
  parentExecutionId?: string;
}

export interface TaskCheckpoint {
  checkpointId: string;
  savedAt: number;
  turnNumber: number;
  maxTurns: number;
  intermediateFindings: string;
  completedStepsCount: number;
  nextRecommendedAction?: string;
}

export interface OfficeTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId?: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  parentTaskId?: string;
  dependencies: string[]; // Task IDs that must complete first
  steps: TaskStep[];
  provenance: ToolExecutionProvenance[];
  workspaceId?: string;
  workspacePath?: string;
  acceptanceCriteria?: string[];
  requiredEvidence?: string[];
  requiredTools?: string[];
  blockReason?: string;
  incompleteRequirements?: string[];
  result?: string;
  error?: string;
  checkpoint?: TaskCheckpoint;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface CreateTaskOptions {
  title: string;
  description: string;
  assignedAgentId?: string;
  parentTaskId?: string;
  dependencies?: string[];
  priority?: "low" | "medium" | "high";
  workspaceId?: string;
  workspacePath?: string;
  acceptanceCriteria?: string[];
  requiredEvidence?: string[];
  requiredTools?: string[];
}

export interface TaskFilter {
  status?: TaskStatus;
  assignedAgentId?: string;
  parentTaskId?: string;
  workspaceId?: string;
}
