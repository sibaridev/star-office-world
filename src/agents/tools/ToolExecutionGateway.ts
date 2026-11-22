/**
 * Star Office World — Centralized Tool Execution Gateway
 * Mediates all tool executions with fine-grained permission enforcement,
 * workspace authorization, safe fallbacks, and structured provenance auditing.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolRegistry } from "./ToolRegistry.js";
import type { ToolExecutionResult, ToolExecutionContext } from "./ToolTypes.js";
import type { ToolExecutionProvenance, ProvenanceStatus } from "../tasks/TaskTypes.js";
import type { AgentExecutionContext } from "../core/AgentExecutionContext.js";

export class ToolExecutionGateway {
  private toolRegistry: ToolRegistry;
  private provenanceLogPath: string;
  private provenanceRecords: ToolExecutionProvenance[] = [];

  constructor(toolRegistry: ToolRegistry, dataDir: string) {
    this.toolRegistry = toolRegistry;
    this.provenanceLogPath = path.join(dataDir, "provenance", "executions.jsonl");
    fs.mkdirSync(path.dirname(this.provenanceLogPath), { recursive: true });
  }

  public async execute(
    toolName: string,
    inputParameters: Record<string, unknown>,
    context: AgentExecutionContext,
    parentExecutionId?: string
  ): Promise<{ result: ToolExecutionResult; provenance: ToolExecutionProvenance }> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const requestedAt = Date.now();

    // 1. Record Tool Requested
    const provenance: ToolExecutionProvenance = {
      executionId,
      taskId: context.taskId,
      parentTaskId: context.parentTaskId,
      agentId: context.agentId,
      tool: toolName,
      inputParameters: { ...inputParameters },
      requestedAt,
      status: "REQUESTED",
      workspaceId: context.workspaceId,
      parentExecutionId,
    };

    // 2. Authorization & Permission Validation
    const authCheck = this.validateAuthorization(toolName, inputParameters, context);
    if (!authCheck.authorized) {
      provenance.status = "BLOCKED";
      provenance.completedAt = Date.now();
      provenance.error = authCheck.error;
      this.recordProvenance(provenance);

      return {
        result: {
          success: false,
          output: "",
          error: `[GATEWAY_BLOCKED]: ${authCheck.error}`,
        },
        provenance,
      };
    }

    provenance.authorizedAt = Date.now();
    provenance.status = "AUTHORIZED";

    // 3. Execution Started
    provenance.startedAt = Date.now();
    provenance.status = "STARTED";

    // 4. Resolve effective workspace path: prefer task's authorized workspace path
    const effectiveWorkspaceDir = context.workspacePath || context.scratchWorkspaceDir;

    const toolCtx: ToolExecutionContext = {
      agentId: context.agentId,
      agentName: context.agentName,
      taskId: context.taskId,
      dataDir: context.dataDir,
      workspaceDir: effectiveWorkspaceDir,
      antigravityBridge: context.antigravityBridge,
      permissions: context.permissions,
      workspaceId: context.workspaceId,
      workspacePath: context.workspacePath,
    };

    try {
      const res = await this.toolRegistry.executeTool(
        toolName,
        inputParameters,
        toolCtx,
        context.allowedTools
      );

      provenance.completedAt = Date.now();
      if (res.success) {
        provenance.status = "COMPLETED";
        provenance.output = res.output;
      } else {
        provenance.status = "FAILED";
        provenance.error = res.error;
      }
      this.recordProvenance(provenance);

      return { result: res, provenance };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      provenance.completedAt = Date.now();
      provenance.status = "FAILED";
      provenance.error = msg;
      this.recordProvenance(provenance);

      return {
        result: {
          success: false,
          output: "",
          error: `Gateway Execution Error: ${msg}`,
        },
        provenance,
      };
    }
  }

  private validateAuthorization(
    toolName: string,
    args: Record<string, unknown>,
    context: AgentExecutionContext
  ): { authorized: boolean; error?: string } {
    // A. Check if tool is authorized for agent
    if (!context.allowedTools.includes(toolName)) {
      return {
        authorized: false,
        error: `Permission Denied: Tool '${toolName}' is not in allowedTools for agent '${context.agentId}'. Authorized tools: ${context.allowedTools.join(", ")}`,
      };
    }

    // B. Check if tool exists
    const def = this.toolRegistry.get(toolName);
    if (!def) {
      return {
        authorized: false,
        error: `Tool '${toolName}' not found in registry.`,
      };
    }

    // C. Fine-grained permission flags
    const p = context.permissions;
    if (toolName === "workspace_write_file" && !p.canModifyFiles) {
      return { authorized: false, error: `Agent ${context.agentName} lacks 'canModifyFiles' permission.` };
    }
    if (
      (toolName.includes("antigravity") || toolName === "delegate_to_antigravity") &&
      !p.canUseAntigravity
    ) {
      return { authorized: false, error: `Agent ${context.agentName} lacks 'canUseAntigravity' permission.` };
    }
    if ((toolName === "web_search" || toolName === "web_fetch") && !p.canAccessNetwork) {
      return { authorized: false, error: `Agent ${context.agentName} lacks 'canAccessNetwork' permission.` };
    }
    if (
      (toolName === "send_agent_message" || toolName === "post_office_memo") &&
      !p.canCommunicateWithPeers
    ) {
      return { authorized: false, error: `Agent ${context.agentName} lacks 'canCommunicateWithPeers' permission.` };
    }

    // D. Workspace boundary verification
    const wsId = String(args["workspaceId"] || context.workspaceId || "");
    if (context.antigravityBridge?.workspaces && wsId) {
      const filePath = args["filePath"] ? String(args["filePath"]) : undefined;
      if (filePath) {
        const isAuth = context.antigravityBridge.workspaces.isAuthorizedPath(wsId, filePath);
        if (!isAuth) {
          return {
            authorized: false,
            error: `Path traversal or unauthorized path: '${filePath}' is outside workspace '${wsId}'.`,
          };
        }
      }
    }

    return { authorized: true };
  }

  private recordProvenance(rec: ToolExecutionProvenance): void {
    this.provenanceRecords.push(rec);
    try {
      fs.appendFileSync(this.provenanceLogPath, JSON.stringify(rec) + "\n", "utf8");
    } catch (err) {
      console.warn("[ToolExecutionGateway] Failed to append provenance record:", err);
    }
  }

  public getProvenance(taskId?: string): ToolExecutionProvenance[] {
    if (taskId) {
      return this.provenanceRecords.filter((r) => r.taskId === taskId || r.parentTaskId === taskId);
    }
    return [...this.provenanceRecords];
  }
}
