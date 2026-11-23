/**
 * Star Office World — Task Types & Schemas
 * Enhanced with execution provenance, refined lifecycle states, and verifiable criteria.
 */

export type TaskStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "QUEUED"
  | "PENDING"
  | "ASSIGNED"
  | "RUNNING"
  | "IN_PROGRESS"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_DEPENDENCY"
  | "EXECUTED"
  | "VERIFIED"
  | "BLOCKED"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

export interface TaskExecutionEvidence {
  tool: string;
  operation: string;
  targetPath: string;
  result: string;
  verificationStatus: "VERIFIED" | "FAILED" | "PENDING" | "UNVERIFIED";
  verifiedAt?: number;
  readBackContent?: string;
  errorDetails?: string;
}

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
  idempotencyKey?: string;
  sources?: Array<{
    type: "workspace_file" | "git_status" | "task_spec" | "memo" | "meeting";
    ref: string;
    verification: "verified" | "inferred";
  }>;
  confidence?: "verified" | "inferred";
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
  idempotencyKey?: string;
  title: string;
  description: string;
  assignedAgentId?: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  parentTaskId?: string;
  dependencies: string[]; // Task IDs that must complete first
  steps: TaskStep[];
  provenance: ToolExecutionProvenance[];
  evidence?: TaskExecutionEvidence[];
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
  idempotencyKey?: string;
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
