/**
 * Star Office World — Agent Activity Monitor Service
 * Aggregates real agent statuses, active tasks, activity timelines,
 * execution results, and history with zero mock data.
 */

import type { AgentRuntime } from "../core/AgentRuntime.js";
import type { OfficeWorldState } from "../../types.js";
import type {
  AgentActivitySummary,
  AgentActivityDetail,
  ActivityTimelineItem,
  SystemActivityStats,
} from "./types.js";
import type { OfficeTask } from "../tasks/TaskTypes.js";

export class ActivityMonitorService {
  private runtime: AgentRuntime;
  private getState?: () => OfficeWorldState;

  constructor(runtime: AgentRuntime, getState?: () => OfficeWorldState) {
    this.runtime = runtime;
    this.getState = getState;
  }

  /**
   * Retrieves high-level monitor overview for all registered agents.
   */
  public getOverview(): AgentActivitySummary[] {
    const registeredConfigs = this.runtime.configManager.listAgents();
    const officeState = this.getState ? this.getState() : undefined;

    return registeredConfigs.map((config) => {
      const instance = this.runtime.getAgent(config.agentId);
      const runtimeStatus = instance?.status ?? "OFFLINE";
      const visualStatus = instance?.lifecycle.officeVisualState ?? "idle";
      const statusDetail =
        officeState?.agents[config.agentId]?.detail ??
        instance?.lifecycle.lastTransition?.reason ??
        "Standing by";

      const durationInStateMs = instance?.lifecycle.durationInCurrentStateMs ?? 0;

      // Query tasks assigned to this agent from TaskManager
      const tasks = this.runtime.taskManager.listTasks({
        assignedAgentId: config.agentId,
      });

      // Find active task
      const activeTaskCandidate =
        instance?.activeTask ??
        tasks.find((t) =>
          ["RUNNING", "IN_PROGRESS", "WAITING_FOR_TOOL", "WAITING_DEPENDENCY", "THINKING"].includes(
            t.status
          )
        );

      let currentTask: AgentActivitySummary["currentTask"] = null;
      if (activeTaskCandidate) {
        const lastStep =
          activeTaskCandidate.steps && activeTaskCandidate.steps.length > 0
            ? activeTaskCandidate.steps[activeTaskCandidate.steps.length - 1]
            : undefined;

        currentTask = {
          id: activeTaskCandidate.id,
          title: activeTaskCandidate.title,
          status: activeTaskCandidate.status,
          priority: activeTaskCandidate.priority,
          startedAt: activeTaskCandidate.startedAt ?? activeTaskCandidate.createdAt,
          stepsCount: activeTaskCandidate.steps ? activeTaskCandidate.steps.length : 0,
          lastStep: lastStep
            ? {
                stepNumber: lastStep.stepNumber,
                description: lastStep.description,
                tool: lastStep.tool,
                thought: lastStep.thought,
                timestamp: lastStep.timestamp,
              }
            : undefined,
        };
      }

      // Find latest completed/terminated execution result
      const terminalTasks = tasks.filter((t) =>
        ["COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED", "CANCELLED"].includes(t.status)
      );
      const latestTerminated = terminalTasks[0]; // listTasks sorts newest first

      let latestExecutionResult: AgentActivitySummary["latestExecutionResult"] = null;
      if (latestTerminated) {
        const toolSet = new Set<string>();
        if (latestTerminated.steps) {
          for (const s of latestTerminated.steps) {
            if (s.tool) toolSet.add(s.tool);
          }
        }
        if (latestTerminated.provenance) {
          for (const p of latestTerminated.provenance) {
            if (p.tool) toolSet.add(p.tool);
          }
        }

        latestExecutionResult = {
          taskId: latestTerminated.id,
          taskTitle: latestTerminated.title,
          status: latestTerminated.status,
          result: latestTerminated.result,
          error: latestTerminated.error,
          blockReason: latestTerminated.blockReason,
          completedAt: latestTerminated.completedAt ?? latestTerminated.updatedAt,
          toolsExecuted: Array.from(toolSet),
        };
      }

      // Derive latest recorded activity
      let latestActivity: AgentActivitySummary["latestActivity"] = null;
      const activityCandidates: Array<NonNullable<AgentActivitySummary["latestActivity"]>> = [];

      // 1. Last step from active or recent task
      const taskWithSteps = activeTaskCandidate || tasks.find((t) => t.steps && t.steps.length > 0);
      if (taskWithSteps && taskWithSteps.steps && taskWithSteps.steps.length > 0) {
        const step = taskWithSteps.steps[taskWithSteps.steps.length - 1];
        activityCandidates.push({
          type: step.tool ? "tool_execution" : "task_step",
          description: step.description,
          timestamp: step.timestamp,
          tool: step.tool,
          thought: step.thought,
          detail: `Task: ${taskWithSteps.title}`,
        });
      }

      // 2. Lifecycle transitions
      const lastTransition = instance?.lifecycle.lastTransition;
      if (lastTransition) {
        activityCandidates.push({
          type: "status_change",
          description: `State changed to ${lastTransition.state}${lastTransition.reason ? `: ${lastTransition.reason}` : ""}`,
          timestamp: lastTransition.timestamp,
          detail: lastTransition.reason,
        });
      }

      // 3. Memory actions
      const memories = instance?.getMemory?.() || [];
      if (memories.length > 0) {
        const lastMem = memories[memories.length - 1];
        activityCandidates.push({
          type: "action",
          description: lastMem.content,
          timestamp: lastMem.timestamp,
          detail: lastMem.taskId ? `Task #${lastMem.taskId}` : undefined,
        });
      }

      // 4. Completed task marker
      if (latestTerminated && latestTerminated.completedAt) {
        activityCandidates.push({
          type: "task_completed",
          description: `Finished "${latestTerminated.title}" with status ${latestTerminated.status}`,
          timestamp: latestTerminated.completedAt,
          detail: latestTerminated.result ? `${latestTerminated.result.slice(0, 100)}...` : undefined,
        });
      }

      if (activityCandidates.length > 0) {
        activityCandidates.sort((a, b) => b.timestamp - a.timestamp);
        latestActivity = activityCandidates[0];
      } else {
        latestActivity = {
          type: "status_change",
          description: "Agent initialized and idle",
          timestamp: config.createdAt || Date.now(),
        };
      }

      // Calculate task statistics
      const stats = {
        totalTasksAssigned: tasks.length,
        completedTasks: tasks.filter((t) => t.status === "COMPLETED").length,
        failedTasks: tasks.filter((t) => t.status === "FAILED").length,
        inProgressTasks: tasks.filter((t) =>
          ["RUNNING", "IN_PROGRESS", "WAITING_FOR_TOOL", "THINKING"].includes(t.status)
        ).length,
        blockedTasks: tasks.filter((t) => t.status === "BLOCKED").length,
        interruptedTasks: tasks.filter((t) => t.status === "INTERRUPTED").length,
      };

      return {
        agentId: config.agentId,
        name: config.name,
        role: config.role,
        avatar: config.avatar,
        team: config.team?.teamId || "Core Team",
        isActive: config.lifecycleStatus === "ACTIVE",
        promptVersion: config.configVersion,
        runtimeStatus,
        visualStatus,
        statusDetail,
        durationInStateMs,
        currentTask,
        latestActivity,
        latestExecutionResult,
        stats,
      };
    });
  }

  /**
   * Retrieves full activity details, full execution history, and unified chronological timeline for one agent.
   */
  public getAgentDetail(agentId: string): AgentActivityDetail | null {
    const overviewList = this.getOverview();
    const overview = overviewList.find((a) => a.agentId === agentId);
    if (!overview) return null;

    const instance = this.runtime.getAgent(agentId);
    const tasks = this.runtime.taskManager.listTasks({ assignedAgentId: agentId });
    const currentTaskDetail =
      (overview.currentTask ? this.runtime.taskManager.getTask(overview.currentTask.id) : null) ??
      instance?.activeTask ??
      null;

    // Build unified chronological timeline
    const timeline: ActivityTimelineItem[] = [];

    // Add task steps from all tasks
    for (const task of tasks) {
      if (task.steps) {
        for (const step of task.steps) {
          timeline.push({
            id: `step_${task.id}_${step.stepNumber}`,
            timestamp: step.timestamp,
            source: "step",
            title: step.description,
            detail: step.thought,
            tool: step.tool,
            status: step.toolResult ? "COMPLETED" : undefined,
          });
        }
      }

      // Add task completion/status marker
      if (task.completedAt) {
        timeline.push({
          id: `task_end_${task.id}`,
          timestamp: task.completedAt,
          source: "task",
          title: `Task completed: ${task.title}`,
          detail: task.result ? task.result.slice(0, 160) : task.error || task.blockReason,
          status: task.status,
        });
      } else if (task.createdAt) {
        timeline.push({
          id: `task_start_${task.id}`,
          timestamp: task.createdAt,
          source: "task",
          title: `Task assigned: ${task.title}`,
          status: task.status,
        });
      }
    }

    // Add lifecycle transitions
    if (instance) {
      const transitions = instance.lifecycle.getHistory();
      for (let i = 0; i < transitions.length; i++) {
        const tr = transitions[i];
        timeline.push({
          id: `lc_${agentId}_${tr.timestamp}_${i}`,
          timestamp: tr.timestamp,
          source: "lifecycle",
          title: `State changed to ${tr.state}`,
          detail: tr.reason,
          status: tr.state,
        });
      }

      // Add memory actions
      const memories = instance.getMemory();
      for (let i = 0; i < memories.length; i++) {
        const m = memories[i];
        timeline.push({
          id: `mem_${agentId}_${m.timestamp}_${i}`,
          timestamp: m.timestamp,
          source: "action",
          title: m.content,
          status: m.taskId ? `Task #${m.taskId}` : undefined,
        });
      }
    }

    // Sort timeline newest first
    timeline.sort((a, b) => b.timestamp - a.timestamp);

    // Compute tools usage
    const toolsUsage: Record<string, number> = {};
    for (const task of tasks) {
      if (task.steps) {
        for (const s of task.steps) {
          if (s.tool) {
            toolsUsage[s.tool] = (toolsUsage[s.tool] || 0) + 1;
          }
        }
      }
      if (task.provenance) {
        for (const p of task.provenance) {
          if (p.tool && (!task.steps || !task.steps.some((s) => s.tool === p.tool))) {
            toolsUsage[p.tool] = (toolsUsage[p.tool] || 0) + 1;
          }
        }
      }
    }

    return {
      overview,
      currentTaskDetail,
      taskHistory: tasks,
      recentTimeline: timeline.slice(0, 50),
      toolsUsage,
    };
  }

  /**
   * System-wide activity statistics
   */
  public getSystemStats(): SystemActivityStats {
    const overview = this.getOverview();
    const allTasks = this.runtime.taskManager.listTasks();

    const activeAgents = overview.filter((a) => a.isActive).length;
    const workingAgents = overview.filter((a) =>
      ["EXECUTING", "THINKING", "COMMUNICATING", "RECEIVING_TASK"].includes(a.runtimeStatus)
    ).length;

    const activeTasks = allTasks.filter((t) =>
      ["RUNNING", "IN_PROGRESS", "WAITING_FOR_TOOL", "THINKING", "WAITING_DEPENDENCY"].includes(
        t.status
      )
    ).length;
    const completedTasks = allTasks.filter((t) => t.status === "COMPLETED").length;
    const failedTasks = allTasks.filter((t) => t.status === "FAILED").length;
    const blockedTasks = allTasks.filter((t) => t.status === "BLOCKED").length;

    let systemHealth: SystemActivityStats["systemHealth"] = "healthy";
    if (failedTasks > 0 || blockedTasks > 2) {
      systemHealth = "warning";
    }

    return {
      totalAgents: overview.length,
      activeAgents,
      workingAgents,
      totalTasks: allTasks.length,
      activeTasks,
      completedTasks,
      failedTasks,
      blockedTasks,
      systemHealth,
      timestamp: Date.now(),
    };
  }
}
