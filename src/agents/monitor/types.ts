/**
 * Star Office World — Agent Activity Monitor Types
 */

import type { AgentRuntimeState } from "../core/AgentTypes.js";
import type { AgentState } from "../../types.js";
import type { OfficeTask, TaskStatus, TaskStep } from "../tasks/TaskTypes.js";

export interface AgentActivitySummary {
  agentId: string;
  name: string;
  role: string;
  avatar: string;
  team?: string;
  isActive: boolean;
  promptVersion?: number;
  runtimeStatus: AgentRuntimeState | "OFFLINE";
  visualStatus: AgentState;
  statusDetail: string;
  durationInStateMs: number;
  currentTask: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: string;
    startedAt?: number;
    stepsCount: number;
    lastStep?: {
      stepNumber: number;
      description: string;
      tool?: string;
      thought?: string;
      timestamp: number;
    };
  } | null;
  latestActivity: {
    type: "tool_execution" | "task_step" | "status_change" | "task_completed" | "action";
    description: string;
    timestamp: number;
    tool?: string;
    thought?: string;
    detail?: string;
  } | null;
  latestExecutionResult: {
    taskId: string;
    taskTitle: string;
    status: TaskStatus;
    result?: string;
    error?: string;
    blockReason?: string;
    completedAt?: number;
    toolsExecuted: string[];
  } | null;
  stats: {
    totalTasksAssigned: number;
    completedTasks: number;
    failedTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    interruptedTasks: number;
  };
}

export interface ActivityTimelineItem {
  id: string;
  timestamp: number;
  source: "step" | "lifecycle" | "action" | "task";
  title: string;
  detail?: string;
  tool?: string;
  status?: string;
}

export interface AgentActivityDetail {
  overview: AgentActivitySummary;
  currentTaskDetail: OfficeTask | null;
  taskHistory: OfficeTask[];
  recentTimeline: ActivityTimelineItem[];
  toolsUsage: Record<string, number>;
}

export interface SystemActivityStats {
  totalAgents: number;
  activeAgents: number;
  workingAgents: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  systemHealth: "healthy" | "warning" | "error";
  timestamp: number;
}
