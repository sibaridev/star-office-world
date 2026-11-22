/**
 * Star Office World — Task Manager
 * Handles task queues, dependency resolution, execution status, and subtasks.
 */

import { TaskPersistence } from "./TaskPersistence.js";
import type { OfficeTask, TaskStatus, TaskStep } from "./TaskTypes.js";

export class TaskManager {
  private tasks = new Map<string, OfficeTask>();
  private persistence: TaskPersistence;
  private onTaskUpdateCallback?: (task: OfficeTask) => void;

  constructor(dataDir: string, onTaskUpdate?: (task: OfficeTask) => void) {
    this.persistence = new TaskPersistence(dataDir);
    this.onTaskUpdateCallback = onTaskUpdate;
    this.loadAndRecover();
  }

  private loadAndRecover(): void {
    // Recover any tasks interrupted from previous session
    this.persistence.recoverInterruptedTasks();
    const existing = this.persistence.listTasks();
    for (const t of existing) {
      this.tasks.set(t.id, t);
    }
  }

  public createTask(opts: {
    title: string;
    description: string;
    assignedAgentId?: string;
    priority?: "low" | "medium" | "high";
    parentTaskId?: string;
    dependencies?: string[];
  }): OfficeTask {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task: OfficeTask = {
      id,
      title: opts.title,
      description: opts.description,
      assignedAgentId: opts.assignedAgentId,
      status: (opts.dependencies && opts.dependencies.length > 0) ? "WAITING_DEPENDENCY" : "PENDING",
      priority: opts.priority ?? "medium",
      parentTaskId: opts.parentTaskId,
      dependencies: opts.dependencies ?? [],
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(id, `Task created: "${task.title}"`);
    this.notifyUpdate(task);
    return task;
  }

  public getTask(id: string): OfficeTask | undefined {
    return this.tasks.get(id);
  }

  public listTasks(filter?: { status?: TaskStatus; assignedAgentId?: string; parentTaskId?: string }): OfficeTask[] {
    let list = Array.from(this.tasks.values());

    if (filter?.status) {
      list = list.filter((t) => t.status === filter.status);
    }
    if (filter?.assignedAgentId) {
      list = list.filter((t) => t.assignedAgentId === filter.assignedAgentId);
    }
    if (filter?.parentTaskId !== undefined) {
      list = list.filter((t) => t.parentTaskId === filter.parentTaskId);
    }

    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Checks if all dependencies of a task have successfully COMPLETED.
   */
  public areDependenciesMet(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.dependencies.length === 0) return true;

    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== "COMPLETED") {
        return false;
      }
    }
    return true;
  }

  /**
   * Check all waiting tasks to see if their dependencies are now satisfied.
   */
  public resolveDependencies(): void {
    for (const task of this.tasks.values()) {
      if (task.status === "WAITING_DEPENDENCY" && this.areDependenciesMet(task.id)) {
        task.status = "PENDING";
        task.updatedAt = Date.now();
        this.persistence.saveTask(task);
        this.persistence.recordRunLog(task.id, "Dependencies satisfied. Transitioned to PENDING.");
        this.notifyUpdate(task);
      }
    }
  }

  public assignTask(taskId: string, agentId: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.assignedAgentId = agentId;
    task.status = "ASSIGNED";
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Assigned to agent ${agentId}`);
    this.notifyUpdate(task);
    return task;
  }

  public startTask(taskId: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = "IN_PROGRESS";
    task.startedAt = Date.now();
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, "Execution started.");
    this.notifyUpdate(task);
    return task;
  }

  public addStep(taskId: string, step: Omit<TaskStep, "stepNumber" | "timestamp">): TaskStep | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const newStep: TaskStep = {
      ...step,
      stepNumber: task.steps.length + 1,
      timestamp: Date.now(),
    };

    task.steps.push(newStep);
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Step #${newStep.stepNumber}: ${newStep.description}`);
    this.notifyUpdate(task);
    return newStep;
  }

  public completeTask(taskId: string, result: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = "COMPLETED";
    task.result = result;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Completed successfully.`);
    this.notifyUpdate(task);

    // After completing, unlock any downstream dependencies
    this.resolveDependencies();
    this.checkParentCompletion(task.parentTaskId);

    return task;
  }

  public failTask(taskId: string, error: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = "FAILED";
    task.error = error;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Failed with error: ${error}`);
    this.notifyUpdate(task);

    // Fail parent if child fails
    if (task.parentTaskId) {
      this.failTask(task.parentTaskId, `Child task ${task.id} failed: ${error}`);
    }

    return task;
  }

  private checkParentCompletion(parentTaskId?: string): void {
    if (!parentTaskId) return;
    const parent = this.tasks.get(parentTaskId);
    if (!parent || parent.status === "COMPLETED" || parent.status === "FAILED") return;

    // Check all children
    const children = this.listTasks({ parentTaskId });
    const allCompleted = children.length > 0 && children.every((c) => c.status === "COMPLETED");

    if (allCompleted) {
      const summary = children.map((c) => `[${c.title}]: ${c.result || "(done)"}`).join("\n\n");
      this.completeTask(parentTaskId, `All ${children.length} subtasks completed:\n\n${summary}`);
    }
  }

  private notifyUpdate(task: OfficeTask): void {
    if (this.onTaskUpdateCallback) {
      try {
        this.onTaskUpdateCallback(task);
      } catch (err) {
        console.warn("[task-manager] Error in task update callback:", err);
      }
    }
  }
}
