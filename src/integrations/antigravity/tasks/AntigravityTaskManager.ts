/**
 * Star Office World — Antigravity Task Manager & Persistence
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AntigravityTask,
  AntigravityTaskStatus,
  AntigravityTaskEvent,
  TaskClarification,
} from "../types.js";

export class AntigravityTaskManager {
  private tasksDir: string;
  private tasks = new Map<string, AntigravityTask>();
  private onTaskUpdate?: (task: AntigravityTask) => void;

  constructor(dataDir: string, onTaskUpdate?: (task: AntigravityTask) => void) {
    this.tasksDir = path.join(dataDir, "antigravity", "tasks");
    this.onTaskUpdate = onTaskUpdate;
    fs.mkdirSync(this.tasksDir, { recursive: true });
    this.loadAndRecover();
  }

  private taskFilePath(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.tasksDir, `${safe}.json`);
  }

  private loadAndRecover(): void {
    if (!fs.existsSync(this.tasksDir)) return;
    try {
      const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.tasksDir, file), "utf8");
          const task = JSON.parse(raw) as AntigravityTask;
          // Recover interrupted tasks
          if (["ACCEPTED", "RUNNING", "SUBMITTED", "SUBMITTED_TO_ANTIGRAVITY", "ACCEPTED_BY_ANTIGRAVITY", "RUNNING_IN_ANTIGRAVITY", "WAITING_FOR_ANTIGRAVITY"].includes(task.status)) {
            task.status = "INTERRUPTED";
            task.error = "Application restarted while task was in execution.";
            task.updatedAt = Date.now();
            this.saveTask(task);
          }
          this.tasks.set(task.id, task);
        } catch {
          // ignore corrupted file
        }
      }
    } catch (err) {
      console.warn("[antigravity-tasks] Failed to load tasks:", err);
    }
  }

  public saveTask(task: AntigravityTask): void {
    try {
      const filePath = this.taskFilePath(task.id);
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), "utf8");
    } catch (err) {
      console.warn(`[antigravity-tasks] Failed to save task ${task.id}:`, err);
    }
  }

  public createTask(opts: {
    workspaceId: string;
    title: string;
    engineeringPrompt: string;
    assignedOfficeAgentId: string;
  }): AntigravityTask {
    const id = `ag_task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task: AntigravityTask = {
      id,
      workspaceId: opts.workspaceId,
      title: opts.title,
      engineeringPrompt: opts.engineeringPrompt,
      status: "QUEUED",
      progress: 0,
      progressMessage: "Queued for Antigravity pickup",
      assignedOfficeAgentId: opts.assignedOfficeAgentId,
      events: [
        {
          timestamp: Date.now(),
          type: "task_created",
          message: `Engineering task created by office agent ${opts.assignedOfficeAgentId}`,
        },
      ],
      clarifications: [],
      followUpInstructions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.saveTask(task);
    this.notify(task);
    return task;
  }

  public getTask(taskId: string): AntigravityTask | undefined {
    return this.tasks.get(taskId);
  }

  public listTasks(filter?: { status?: AntigravityTaskStatus; workspaceId?: string }): AntigravityTask[] {
    let list = Array.from(this.tasks.values());
    if (filter?.status) {
      list = list.filter((t) => t.status === filter.status);
    }
    if (filter?.workspaceId) {
      list = list.filter((t) => t.workspaceId === filter.workspaceId);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public updateStatus(
    taskId: string,
    status: AntigravityTaskStatus,
    message?: string,
    progress?: number
  ): AntigravityTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // Terminal states cannot be reverted back to active states
    if (
      (task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") &&
      status !== task.status
    ) {
      return task;
    }

    task.status = status;
    if (message !== undefined) task.progressMessage = message;
    if (progress !== undefined) task.progress = progress;
    task.updatedAt = Date.now();

    if (status === "RUNNING" && !task.startedAt) {
      task.startedAt = Date.now();
    }
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(status)) {
      task.completedAt = Date.now();
    }

    this.addEvent(taskId, "status_change", message || `Task transitioned to ${status}`);
    this.saveTask(task);
    this.notify(task);
    return task;
  }

  public addEvent(taskId: string, type: string, message: string, data?: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.events.push({
      timestamp: Date.now(),
      type,
      message,
      data,
    });
    task.updatedAt = Date.now();
    this.saveTask(task);
    this.notify(task);
  }

  public requestClarification(taskId: string, question: string): TaskClarification | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const clarification: TaskClarification = {
      id: `clar_${Date.now()}`,
      question,
      askedAt: Date.now(),
    };

    task.clarifications.push(clarification);
    task.status = "WAITING_FOR_INPUT";
    task.progressMessage = `Waiting for clarification: "${question.slice(0, 60)}..."`;
    task.updatedAt = Date.now();

    this.addEvent(taskId, "clarification_requested", question);
    this.saveTask(task);
    this.notify(task);
    return clarification;
  }

  public answerClarification(taskId: string, clarificationId: string, answer: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const target = task.clarifications.find((c) => c.id === clarificationId);
    if (!target) return false;

    target.answer = answer;
    target.answeredAt = Date.now();
    task.status = "RUNNING";
    task.progressMessage = "Clarification provided, resuming execution";
    task.updatedAt = Date.now();

    this.addEvent(taskId, "clarification_answered", answer);
    this.saveTask(task);
    this.notify(task);
    return true;
  }

  public addFollowUpInstruction(taskId: string, instruction: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.followUpInstructions.push({
      instruction,
      timestamp: Date.now(),
    });
    task.status = "SUBMITTED";
    task.progressMessage = `Follow-up revision submitted: "${instruction.slice(0, 60)}..."`;
    task.updatedAt = Date.now();

    this.addEvent(taskId, "followup_instruction", instruction);
    this.saveTask(task);
    this.notify(task);
    return true;
  }

  public submitFollowUp(taskId: string, instruction: string): AntigravityTask | null {
    const ok = this.addFollowUpInstruction(taskId, instruction);
    if (!ok) return null;
    return this.tasks.get(taskId) ?? null;
  }

  public completeTask(taskId: string, opts: { result: string; diff?: string; testResults?: string }): AntigravityTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // Terminal states cannot be completed again or falsely overwritten
    if (task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") {
      return null;
    }

    // Must have real execution deliverable: result must be a non-empty string
    if (!opts || typeof opts.result !== "string" || !opts.result.trim()) {
      return null;
    }

    task.status = "COMPLETED";
    task.progress = 100;
    task.progressMessage = "Task successfully completed";
    task.result = opts.result.trim();
    if (opts.diff) task.diff = opts.diff;
    if (opts.testResults) task.testResults = opts.testResults;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this.addEvent(taskId, "task_completed", "Antigravity submitted final completed deliverable", {
      hasDiff: !!opts.diff,
      hasTestResults: !!opts.testResults,
    });
    this.saveTask(task);
    this.notify(task);
    return task;
  }

  public failTask(taskId: string, error: string): AntigravityTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") {
      return null;
    }

    task.status = "FAILED";
    task.error = error;
    task.progressMessage = `Failed: ${error}`;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this.addEvent(taskId, "task_failed", error);
    this.saveTask(task);
    this.notify(task);
    return task;
  }

  public cancelTask(taskId: string, reason?: string): AntigravityTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") {
      return null;
    }

    task.status = "CANCELLED";
    task.error = reason || "Task cancelled by user or office agent";
    task.progressMessage = reason || "Task cancelled by user or office agent";
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this.addEvent(taskId, "task_cancelled", reason || "Cancelled");
    this.saveTask(task);
    this.notify(task);
    return task;
  }

  private notify(task: AntigravityTask): void {
    if (this.onTaskUpdate) {
      try {
        this.onTaskUpdate(task);
      } catch (err) {
        console.warn("[antigravity-tasks] Error notifying update:", err);
      }
    }
  }
}
