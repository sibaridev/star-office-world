/**
 * Star Office World — Agent Execution Context
 * Centralized, permission-aware execution context propagated across turns and delegations.
 */

import type { AgentPermission } from "../management/types.js";
import type { ToolDefinition } from "../tools/ToolTypes.js";
import type { OfficeTask } from "../tasks/TaskTypes.js";
import type { IAntigravityBridge } from "../../integrations/antigravity/types.js";

export interface AgentExecutionLimits {
  temperature: number;
  maxIterations: number;
  timeoutMs: number;
}

export interface AgentExecutionContextOptions {
  contextId?: string;
  agentId: string;
  agentName: string;
  taskId: string;
  parentTaskId?: string;
  workspaceId?: string;
  workspacePath?: string;
  allowedTools: string[];
  permissions: AgentPermission;
  acceptanceCriteria?: string[];
  requiredEvidence?: string[];
  requiredTools?: string[];
  executionLimits?: Partial<AgentExecutionLimits>;
  dataDir: string;
  scratchWorkspaceDir: string;
  antigravityBridge?: IAntigravityBridge;
}

export class AgentExecutionContext {
  public readonly contextId: string;
  public readonly agentId: string;
  public readonly agentName: string;
  public readonly taskId: string;
  public readonly parentTaskId?: string;
  public readonly workspaceId?: string;
  public readonly workspacePath?: string;
  public readonly allowedTools: string[];
  public readonly permissions: AgentPermission;
  public readonly acceptanceCriteria: string[];
  public readonly requiredEvidence: string[];
  public readonly requiredTools: string[];
  public readonly executionLimits: AgentExecutionLimits;
  public readonly dataDir: string;
  public readonly scratchWorkspaceDir: string;
  public readonly antigravityBridge?: IAntigravityBridge;
  public isCancelled = false;

  constructor(opts: AgentExecutionContextOptions) {
    this.contextId = opts.contextId || `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.agentId = opts.agentId;
    this.agentName = opts.agentName;
    this.taskId = opts.taskId;
    this.parentTaskId = opts.parentTaskId;
    this.workspaceId = opts.workspaceId;
    this.workspacePath = opts.workspacePath;
    this.allowedTools = [...opts.allowedTools];
    this.permissions = { ...opts.permissions };
    this.acceptanceCriteria = opts.acceptanceCriteria ? [...opts.acceptanceCriteria] : [];
    this.requiredEvidence = opts.requiredEvidence ? [...opts.requiredEvidence] : [];
    this.requiredTools = opts.requiredTools ? [...opts.requiredTools] : [];
    this.executionLimits = {
      temperature: opts.executionLimits?.temperature ?? 0.7,
      maxIterations: opts.executionLimits?.maxIterations ?? 8,
      timeoutMs: opts.executionLimits?.timeoutMs ?? 60000,
    };
    this.dataDir = opts.dataDir;
    this.scratchWorkspaceDir = opts.scratchWorkspaceDir;
    this.antigravityBridge = opts.antigravityBridge;
  }

  /**
   * Derive a scoped child context for subtask delegation.
   * Permission-aware capability propagation: child only receives tools authorized for BOTH the task and the child agent.
   */
  public deriveChildContext(opts: {
    childAgentId: string;
    childAgentName: string;
    childTaskId: string;
    childAllowedTools: string[];
    childPermissions: AgentPermission;
    subtaskAcceptanceCriteria?: string[];
    subtaskRequiredEvidence?: string[];
    subtaskRequiredTools?: string[];
    targetWorkspaceId?: string;
    targetWorkspacePath?: string;
  }): AgentExecutionContext {
    const targetTools = [...opts.childAllowedTools];

    return new AgentExecutionContext({
      contextId: `ctx_${Date.now()}_child_${opts.childAgentId}`,
      agentId: opts.childAgentId,
      agentName: opts.childAgentName,
      taskId: opts.childTaskId,
      parentTaskId: this.taskId,
      workspaceId: opts.targetWorkspaceId || this.workspaceId,
      workspacePath: opts.targetWorkspacePath || this.workspacePath,
      allowedTools: targetTools,
      permissions: opts.childPermissions,
      acceptanceCriteria: opts.subtaskAcceptanceCriteria || this.acceptanceCriteria,
      requiredEvidence: opts.subtaskRequiredEvidence || this.requiredEvidence,
      requiredTools: opts.subtaskRequiredTools || this.requiredTools,
      executionLimits: this.executionLimits,
      dataDir: this.dataDir,
      scratchWorkspaceDir: this.scratchWorkspaceDir,
      antigravityBridge: this.antigravityBridge,
    });
  }

  public cancel(): void {
    this.isCancelled = true;
  }
}

