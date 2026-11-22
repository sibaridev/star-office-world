/**
 * Star Office World — Antigravity Workspace Registry
 * Manages authorized repository workspaces, security boundaries, and git inspections.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { WorkspaceConfig, WorkspacePermission } from "../types.js";

export class WorkspaceRegistry {
  private configPath: string;
  private workspaces = new Map<string, WorkspaceConfig>();

  constructor(dataDir: string) {
    this.configPath = path.join(dataDir, "antigravity", "workspaces.json");
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, "utf8");
        const list = JSON.parse(raw) as WorkspaceConfig[];
        for (const ws of list) {
          this.workspaces.set(ws.workspaceId, ws);
        }
      } catch (err) {
        console.warn("[antigravity-workspaces] Failed to load workspaces.json:", err);
      }
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      const list = Array.from(this.workspaces.values());
      fs.writeFileSync(this.configPath, JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
      console.warn("[antigravity-workspaces] Failed to save workspaces.json:", err);
    }
  }

  public registerWorkspace(opts: {
    name: string;
    path: string;
    workspaceId?: string;
    allowedOperations?: WorkspacePermission[];
    permissionPolicy?: "strict" | "standard" | "permissive";
  }): WorkspaceConfig {
    const rawPath = path.resolve(opts.path);
    if (!fs.existsSync(rawPath)) {
      throw new Error(`Directory does not exist: ${rawPath}`);
    }

    // Resolve realpath to prevent symlink bypass
    const realRoot = fs.realpathSync(rawPath);
    const stat = fs.statSync(realRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${realRoot}`);
    }

    const id = opts.workspaceId || `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    
    // Check git repository info
    let gitInfo: WorkspaceConfig["gitInfo"] = { isRepo: false };
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: realRoot, stdio: "ignore" });
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: realRoot, encoding: "utf8" }).trim();
      let headCommit: string | undefined;
      try {
        headCommit = execSync("git rev-parse HEAD", { cwd: realRoot, encoding: "utf8" }).trim();
      } catch {}
      gitInfo = { isRepo: true, branch, headCommit };
    } catch {
      // not a git repo
    }

    const ws: WorkspaceConfig = {
      workspaceId: id,
      name: opts.name,
      path: realRoot,
      allowedOperations: opts.allowedOperations || ["read", "modify", "test", "git"],
      permissionPolicy: opts.permissionPolicy || "standard",
      gitInfo,
      activeTaskId: null,
      status: "idle",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workspaces.set(id, ws);
    this.save();
    return ws;
  }

  public getWorkspace(workspaceId: string): WorkspaceConfig | undefined {
    return this.workspaces.get(workspaceId);
  }

  public listWorkspaces(): WorkspaceConfig[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Checks whether a path is within the authorized workspace directory without throwing.
   */
  public isAuthorizedPath(workspaceId: string, targetPath: string): boolean {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return false;
    const wsRoot = path.normalize(ws.path).toLowerCase();
    const resolved = path.normalize(path.resolve(ws.path, targetPath)).toLowerCase();

    // Check directory boundary
    if (!resolved.startsWith(wsRoot)) return false;
    if (resolved !== wsRoot && !resolved.startsWith(wsRoot + path.sep)) return false;

    // If file exists, ensure realpath does not escape (symlink check)
    if (fs.existsSync(resolved)) {
      try {
        const real = path.normalize(fs.realpathSync(resolved)).toLowerCase();
        if (!real.startsWith(wsRoot)) return false;
        if (real !== wsRoot && !real.startsWith(wsRoot + path.sep)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Strictly validates that a relative file path does not escape the workspace boundary.
   */
  public resolveSafePath(workspaceId: string, relativePath: string): string {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    if (!this.isAuthorizedPath(workspaceId, relativePath)) {
      throw new Error(`Security Violation: Path traversal outside authorized workspace '${ws.name}' (${relativePath})`);
    }

    return path.resolve(ws.path, relativePath);
  }

  public getGitDiff(workspaceId: string): string {
    const ws = this.getWorkspace(workspaceId);
    if (!ws || !ws.gitInfo?.isRepo) return "";

    try {
      return execSync("git diff", { cwd: ws.path, encoding: "utf8" });
    } catch (err) {
      return `Error collecting git diff: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  public getGitStatus(workspaceId: string): string {
    const ws = this.getWorkspace(workspaceId);
    if (!ws || !ws.gitInfo?.isRepo) return "";

    try {
      return execSync("git status --porcelain", { cwd: ws.path, encoding: "utf8" });
    } catch (err) {
      return `Error collecting git status: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  public setActiveTask(workspaceId: string, taskId: string | null): void {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      ws.activeTaskId = taskId;
      ws.status = taskId ? "busy" : "idle";
      ws.updatedAt = Date.now();
      this.save();
    }
  }

  public inspectWorkspace(workspaceId: string): {
    exists: boolean;
    isEmpty: boolean;
    fileCount: number;
    path: string;
    gitInfo?: WorkspaceConfig["gitInfo"];
  } {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    if (!fs.existsSync(ws.path)) {
      return { exists: false, isEmpty: true, fileCount: 0, path: ws.path };
    }
    try {
      const files = fs.readdirSync(ws.path);
      return {
        exists: true,
        isEmpty: files.length === 0,
        fileCount: files.length,
        path: ws.path,
        gitInfo: ws.gitInfo,
      };
    } catch {
      return { exists: true, isEmpty: true, fileCount: 0, path: ws.path, gitInfo: ws.gitInfo };
    }
  }
}
