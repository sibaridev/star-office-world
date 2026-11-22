/**
 * Star Office World — Task Types & Schemas
 */

export type TaskStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING_DEPENDENCY"
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
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskFilter {
  status?: TaskStatus;
  assignedAgentId?: string;
  parentTaskId?: string;
}
