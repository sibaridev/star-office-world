/**
 * Star Office World — Native File-based Task Persistence
 * Stores tasks and execution history cleanly under data/tasks/
 */

import fs from "node:fs";
import path from "node:path";
import type { OfficeTask } from "./TaskTypes.js";

export class TaskPersistence {
  private tasksDir: string;
  private runsDir: string;

  constructor(dataDir: string) {
    this.tasksDir = path.join(dataDir, "tasks");
    this.runsDir = path.join(dataDir, "runs");
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  private taskFilePath(taskId: string): string {
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.tasksDir, `${cleanId}.json`);
  }

  public saveTask(task: OfficeTask): void {
    const filePath = this.taskFilePath(task.id);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), "utf8");
  }

  public getTask(taskId: string): OfficeTask | null {
    const filePath = this.taskFilePath(taskId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw) as OfficeTask;
    } catch {
      return null;
    }
  }

  public listTasks(): OfficeTask[] {
    if (!fs.existsSync(this.tasksDir)) return [];
    try {
      const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"));
      const tasks: OfficeTask[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.tasksDir, file), "utf8");
          const parsed = JSON.parse(raw) as OfficeTask;
          parsed.steps = parsed.steps || [];
          parsed.provenance = parsed.provenance || [];
          tasks.push(parsed);
        } catch {
          // ignore corrupted single files
        }
      }
      return tasks.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  public recordRunLog(taskId: string, logEntry: string): void {
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const runFile = path.join(this.runsDir, `${cleanId}.log`);
    const line = `[${new Date().toISOString()}] ${logEntry}\n`;
    fs.appendFileSync(runFile, line, "utf8");
  }

  /**
   * Recovers tasks on server startup: marks unfinished tasks as INTERRUPTED
   */
  public recoverInterruptedTasks(): OfficeTask[] {
    const tasks = this.listTasks();
    const updated: OfficeTask[] = [];

    for (const task of tasks) {
      if (task.status === "IN_PROGRESS" || task.status === "ASSIGNED") {
        task.status = "INTERRUPTED";
        task.error = "Application restarted while task was in progress.";
        task.updatedAt = Date.now();
        this.saveTask(task);
        this.recordRunLog(task.id, "Task marked INTERRUPTED due to server restart.");
        updated.push(task);
      }
    }

    return updated;
  }
}
