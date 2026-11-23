/**
 * Star Office World — Task Manager
 * Coordinates task queues, dependencies, step execution, verifiable completion,
 * and parent delegation result validation.
 */

import { TaskPersistence } from "./TaskPersistence.js";
import type {
  OfficeTask,
  TaskStatus,
  TaskStep,
  CreateTaskOptions,
  TaskFilter,
  ToolExecutionProvenance,
  TaskCheckpoint,
} from "./TaskTypes.js";
import { CompletionVerifier } from "./CompletionVerifier.js";

export class TaskManager {
  private persistence: TaskPersistence;
  private tasks = new Map<string, OfficeTask>();
  private onTaskUpdateCallback?: (task: OfficeTask) => void;

  constructor(dataDir: string, onUpdate?: (task: OfficeTask) => void) {
    this.persistence = new TaskPersistence(dataDir);
    this.onTaskUpdateCallback = onUpdate;
    this.loadPersistedTasks();
  }

  private loadPersistedTasks(): void {
    const list = this.persistence.listTasks();
    for (const task of list) {
      task.steps = task.steps || [];
      task.provenance = task.provenance || [];
      // If a task was left IN_PROGRESS or RUNNING when the server died, mark it INTERRUPTED
      if (task.status === "IN_PROGRESS" || task.status === "RUNNING") {
        task.status = "INTERRUPTED";
        task.error = "Application restarted while task was in progress";
        task.updatedAt = Date.now();
        this.persistence.saveTask(task);
      }
      this.tasks.set(task.id, task);
    }
  }

  public createTask(opts: CreateTaskOptions): OfficeTask {
    // Check-before-apply idempotent deduplication
    if (opts.idempotencyKey) {
      const existing = Array.from(this.tasks.values()).find(
        (t) => t.idempotencyKey === opts.idempotencyKey && (t.status === "COMPLETED" || t.status === "IN_PROGRESS")
      );
      if (existing) {
        this.persistence.recordRunLog(existing.id, `Idempotent duplicate avoided for key: ${opts.idempotencyKey}`);
        return existing;
      }
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task: OfficeTask = {
      id,
      idempotencyKey: opts.idempotencyKey,
      title: opts.title,
      description: opts.description,
      assignedAgentId: opts.assignedAgentId,
      status: opts.dependencies && opts.dependencies.length > 0 ? "WAITING_DEPENDENCY" : "PENDING",
      priority: opts.priority ?? "medium",
      parentTaskId: opts.parentTaskId,
      dependencies: opts.dependencies ?? [],
      steps: [],
      provenance: [],
      workspaceId: opts.workspaceId,
      workspacePath: opts.workspacePath,
      acceptanceCriteria: opts.acceptanceCriteria,
      requiredEvidence: opts.requiredEvidence,
      requiredTools: opts.requiredTools,
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

  public listTasks(filter?: TaskFilter): OfficeTask[] {
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
    if (filter?.workspaceId) {
      list = list.filter((t) => t.workspaceId === filter.workspaceId);
    }

    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

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

  public addProvenanceRecord(taskId: string, record: ToolExecutionProvenance): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.provenance = task.provenance || [];
    task.provenance.push(record);
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.notifyUpdate(task);
  }

  public completeTask(taskId: string, result: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // Aggregate provenance from task and any subtasks
    const childTasks = this.listTasks({ parentTaskId: taskId });
    const effectiveProvenance = [
      ...(task.provenance || []),
      ...childTasks.flatMap((c: OfficeTask) => c.provenance || []),
    ];

    // Verify completion against evidence and check for natural language refusals/excuses
    const verify = CompletionVerifier.verifyCompletion(task, result, effectiveProvenance);

    if (!verify.canComplete) {
      task.status = verify.status; // BLOCKED, FAILED, or PARTIALLY_COMPLETED
      task.result = result;
      task.provenance = effectiveProvenance;
      task.blockReason = verify.blockReason;
      task.incompleteRequirements = verify.incompleteRequirements;
      task.updatedAt = Date.now();
      this.persistence.saveTask(task);
      this.persistence.recordRunLog(taskId, `Cannot complete: ${verify.blockReason}`);
      this.notifyUpdate(task);

      // Propagate blocker to parent if applicable
      if (task.parentTaskId) {
        this.checkParentCompletion(task.parentTaskId);
      }
      return task;
    }

    // Explicitly transition through VERIFIED before COMPLETED
    if (verify.verifiedEvidence && verify.verifiedEvidence.length > 0) {
      task.evidence = verify.verifiedEvidence;
      task.status = "VERIFIED";
      task.updatedAt = Date.now();
      this.persistence.saveTask(task);
      this.persistence.recordRunLog(
        taskId,
        `Execution verified: ${verify.verifiedEvidence.length} verified operations on disk.`
      );
      this.notifyUpdate(task);
    }

    task.status = "COMPLETED";
    task.result = result;
    task.provenance = effectiveProvenance;
    task.blockReason = undefined;
    task.incompleteRequirements = undefined;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Completed successfully with verified evidence.`);
    this.notifyUpdate(task);

    // After completing, unlock any downstream dependencies
    this.resolveDependencies();
    this.checkParentCompletion(task.parentTaskId);

    return task;
  }

  public saveCheckpoint(
    taskId: string,
    checkpoint: Omit<TaskCheckpoint, "checkpointId" | "savedAt">
  ): TaskCheckpoint | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const cp: TaskCheckpoint = {
      ...checkpoint,
      checkpointId: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
    };

    task.checkpoint = cp;
    task.status = "PARTIALLY_COMPLETED";
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(
      taskId,
      `Checkpoint ${cp.checkpointId} saved at turn ${cp.turnNumber}/${cp.maxTurns}: ${cp.intermediateFindings.slice(0, 100)}`
    );
    this.notifyUpdate(task);
    return cp;
  }

  public resumeFromCheckpoint(taskId: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = "PENDING";
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(
      taskId,
      `Resumed from checkpoint ${task.checkpoint?.checkpointId || "latest"}. Transitioned to PENDING.`
    );
    this.notifyUpdate(task);
    return task;
  }

  public blockTask(taskId: string, reason: string): OfficeTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = "BLOCKED";
    task.blockReason = reason;
    task.updatedAt = Date.now();
    this.persistence.saveTask(task);
    this.persistence.recordRunLog(taskId, `Blocked: ${reason}`);
    this.notifyUpdate(task);

    if (task.parentTaskId) {
      this.checkParentCompletion(task.parentTaskId);
    }
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

  /**
   * Parent validates child delegation results independently rather than blindly trusting natural language.
   */
  private checkParentCompletion(parentTaskId?: string): void {
    if (!parentTaskId) return;
    const parent = this.tasks.get(parentTaskId);
    if (!parent || parent.status === "COMPLETED" || parent.status === "FAILED") return;

    const children = this.listTasks({ parentTaskId });
    if (children.length === 0) return;

    // 1. Check if any child is BLOCKED
    const blockedChild = children.find((c) => c.status === "BLOCKED");
    if (blockedChild) {
      parent.status = "BLOCKED";
      parent.blockReason = `Delegated subtask '${blockedChild.title}' is BLOCKED: ${blockedChild.blockReason || "Missing capability"}`;
      parent.updatedAt = Date.now();
      this.persistence.saveTask(parent);
      this.persistence.recordRunLog(parent.id, parent.blockReason);
      this.notifyUpdate(parent);
      return;
    }

    // Clear previous blocker on parent if all children are unblocked
    if (parent.status === "BLOCKED") {
      parent.status = "IN_PROGRESS";
      parent.blockReason = undefined;
    }

    // 2. Check if any child is PARTIALLY_COMPLETED
    const partialChild = children.find((c) => c.status === "PARTIALLY_COMPLETED");
    if (partialChild) {
      parent.status = "PARTIALLY_COMPLETED";
      parent.incompleteRequirements = partialChild.incompleteRequirements;
      parent.blockReason = `Subtask '${partialChild.title}' only partially completed.`;
      parent.updatedAt = Date.now();
      this.persistence.saveTask(parent);
      this.notifyUpdate(parent);
      return;
    }

    // 3. Verify all children are truly COMPLETED with valid execution results
    const allCompleted = children.every((c) => {
      if (c.status !== "COMPLETED") return false;
      const val = CompletionVerifier.validateChildDelegationResult(c, c.provenance);
      return val.valid;
    });

    if (allCompleted) {
      const summary = children.map((c) => `[${c.title}]: ${c.result || "(done)"}`).join("\n\n");
      this.completeTask(parentTaskId, `All ${children.length} subtasks completed with verified evidence:\n\n${summary}`);
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
