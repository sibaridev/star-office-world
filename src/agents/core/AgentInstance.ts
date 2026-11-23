/**
 * Star Office World — Autonomous Agent Instance
 * Executes the OBSERVE -> UNDERSTAND -> PLAN -> EXECUTE -> VERIFY loop.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentMemoryEntry, AgentRuntimeState } from "./AgentTypes.js";
import { AgentLifecycle } from "./AgentLifecycle.js";
import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { OfficeTask } from "../tasks/TaskTypes.js";
import type { TaskManager } from "../tasks/TaskManager.js";
import type { PromptRegistry } from "../prompts/PromptRegistry.js";
import type { PromptProposalManager } from "../prompts/PromptProposalManager.js";
import type { EffectiveSystemPrompt } from "../prompts/types.js";
import { ToolExecutionGateway } from "../tools/ToolExecutionGateway.js";
import { AgentExecutionContext } from "./AgentExecutionContext.js";

export interface AgentActionDecision {
  action: "tool" | "delegate" | "complete" | "fail" | "wait";
  tool?: string;
  args?: Record<string, unknown>;
  thought?: string;
  subtaskTitle?: string;
  subtaskDescription?: string;
  delegateToAgentId?: string;
  result?: string;
  error?: string;
}

export class AgentInstance {
  public readonly config: AgentConfig;
  public readonly lifecycle: AgentLifecycle;
  private aiProvider: AIProvider;
  private toolRegistry: ToolRegistry;
  private toolGateway: ToolExecutionGateway;
  private taskManager: TaskManager;
  private dataDir: string;
  private workspaceDir: string;
  private memory: AgentMemoryEntry[] = [];
  private currentTask: OfficeTask | null = null;
  private eventBus?: (event: string, payload: unknown) => void;
  private antigravityBridge?: any;
  private promptRegistry?: PromptRegistry;
  private proposalManager?: PromptProposalManager;
  private activeTaskPromptSnapshot: EffectiveSystemPrompt | null = null;
  private isRunning = false;

  constructor(opts: {
    config: AgentConfig;
    aiProvider: AIProvider;
    toolRegistry: ToolRegistry;
    toolGateway?: ToolExecutionGateway;
    taskManager: TaskManager;
    dataDir: string;
    workspaceDir: string;
    eventBus?: (event: string, payload: unknown) => void;
    antigravityBridge?: any;
    promptRegistry?: PromptRegistry;
    proposalManager?: PromptProposalManager;
  }) {
    this.config = opts.config;
    this.aiProvider = opts.aiProvider;
    this.toolRegistry = opts.toolRegistry;
    this.toolGateway = opts.toolGateway || new ToolExecutionGateway(opts.toolRegistry, opts.dataDir);
    this.taskManager = opts.taskManager;
    this.dataDir = opts.dataDir;
    this.workspaceDir = opts.workspaceDir;
    this.eventBus = opts.eventBus;
    this.antigravityBridge = opts.antigravityBridge;
    this.promptRegistry = opts.promptRegistry;
    this.proposalManager = opts.proposalManager;
    this.lifecycle = new AgentLifecycle("IDLE");
  }

  public updateConfig(newConfig: AgentConfig): void {
    (this as any).config = newConfig;
  }

  public get agentId(): string {
    return this.config.agentId;
  }

  public get name(): string {
    return this.config.name;
  }

  public get role(): string {
    return this.config.role;
  }

  public get status(): AgentRuntimeState {
    return this.lifecycle.state;
  }

  public get activeTask(): OfficeTask | null {
    return this.currentTask;
  }

  public getMemory(): AgentMemoryEntry[] {
    return [...this.memory];
  }

  public setEventBus(bus: (event: string, payload: unknown) => void): void {
    this.eventBus = bus;
  }

  private emitStateChange(detail: string): void {
    if (this.eventBus) {
      this.eventBus("agent_state_changed", {
        agentId: this.agentId,
        name: this.name,
        role: this.role,
        runtimeState: this.lifecycle.state,
        visualState: this.lifecycle.officeVisualState,
        detail,
        taskId: this.currentTask?.id,
      });
    }
  }

  public async assignTask(task: OfficeTask): Promise<void> {
    this.currentTask = task;
    // Bind task immutably to the effective prompt active at the moment of assignment
    this.activeTaskPromptSnapshot = this.promptRegistry?.getEffectivePrompt(this.agentId) || null;
    this.lifecycle.transition("RECEIVING_TASK", `Assigned task ${task.id}`);
    this.emitStateChange(`Assigned: ${task.title}`);
  }

  /**
   * Main controlled reasoning loop
   */
  public async executeCurrentTask(maxIterations?: number): Promise<void> {
    if (!this.currentTask || this.isRunning) return;
    this.isRunning = true;
    const task = this.currentTask;
    // Turn limit governance:
    // User requirement: "never make turns limit"
    // By default, turn limits are completely disabled across Star Office World.
    // Tasks run continuously until verified completion or terminal failure.
    // A turn limit is only enforced if explicitly passed as a positive number (> 0),
    // or if STAR_OFFICE_ENFORCE_TURN_LIMIT === "true" and configured > 0.
    const explicitLimit = typeof maxIterations === "number" && maxIterations > 0 ? maxIterations : undefined;
    const enforceLimits = process.env.STAR_OFFICE_ENFORCE_TURN_LIMIT === "true";
    const configLimit =
      typeof this.config.execution?.maxIterations === "number" && this.config.execution.maxIterations > 0
        ? this.config.execution.maxIterations
        : undefined;

    const hasTurnLimit = explicitLimit !== undefined || (enforceLimits && configLimit !== undefined);
    const effectiveMaxIterations = explicitLimit ?? (enforceLimits && configLimit ? configLimit : Infinity);
    this.taskManager.startTask(task.id);

    // Resolve target workspace
    let effectiveWorkspaceId = task.workspaceId || "default_workspace";
    let effectiveWorkspacePath = task.workspacePath;

    // Auto-detect target workspace path from task title or description if not explicitly set
    if (!effectiveWorkspacePath) {
      const combined = `${task.title} ${task.description}`;
      const pathMatch = combined.match(/([a-zA-Z]:\\[^\s"';\n]+)/);
      if (pathMatch) {
        let extracted = pathMatch[1].trim();
        try {
          if (fs.existsSync(extracted)) {
            const stat = fs.statSync(extracted);
            if (!stat.isDirectory()) {
              extracted = path.dirname(extracted);
            }
          } else if (path.extname(extracted)) {
            extracted = path.dirname(extracted);
          }
        } catch {}

        if (fs.existsSync(extracted)) {
          effectiveWorkspacePath = path.resolve(extracted);
          if (this.antigravityBridge?.workspaces?.authorizeWorkspace) {
            const ws = this.antigravityBridge.workspaces.authorizeWorkspace({
              path: effectiveWorkspacePath,
              name: path.basename(effectiveWorkspacePath),
            });
            effectiveWorkspaceId = ws.workspaceId;
          }
        }
      }
    }

    if (!effectiveWorkspacePath && this.antigravityBridge?.workspaces) {
      const ws =
        typeof this.antigravityBridge.workspaces.getWorkspace === "function"
          ? this.antigravityBridge.workspaces.getWorkspace(effectiveWorkspaceId)
          : typeof this.antigravityBridge.workspaces.get === "function"
          ? this.antigravityBridge.workspaces.get(effectiveWorkspaceId)
          : undefined;
      if (ws) {
        effectiveWorkspacePath = ws.path || (ws as any).rootPath;
      }
    }
    if (!effectiveWorkspacePath) {
      effectiveWorkspacePath = process.cwd();
    }

    const executionContext = new AgentExecutionContext({
      agentId: this.agentId,
      agentName: this.name,
      taskId: task.id,
      parentTaskId: task.parentTaskId,
      workspaceId: effectiveWorkspaceId,
      workspacePath: effectiveWorkspacePath,
      allowedTools: this.config.allowedTools,
      permissions: this.config.permissions || {
        canModifyFiles: true,
        canDelegateTasks: true,
        canCommunicateWithPeers: true,
        canUseAntigravity: true,
        canExecuteTests: true,
        canAccessNetwork: true,
        requiresApprovalForSensitiveOps: false,
      },
      acceptanceCriteria: task.acceptanceCriteria,
      requiredEvidence: task.requiredEvidence,
      requiredTools: task.requiredTools,
      executionLimits: this.config.execution,
      dataDir: this.dataDir,
      scratchWorkspaceDir: this.workspaceDir,
      antigravityBridge: this.antigravityBridge,
    });

    try {
      let iteration = 0;
      let completed = false;

      while ((!hasTurnLimit || iteration < effectiveMaxIterations) && !completed) {
        iteration++;

        // 1. OBSERVE & THINK (Actual Model Call)
        this.lifecycle.transition("THINKING", `Turn #${iteration}`);
        this.emitStateChange(
          hasTurnLimit
            ? `Thinking (Turn ${iteration}/${effectiveMaxIterations})...`
            : `Thinking (Turn ${iteration})...`
        );

        const prompt = this.buildPrompt(task, iteration);
        const aiResponse = await this.aiProvider.generate({
          prompt,
          systemInstruction: this.buildSystemPrompt(),
          temperature: this.config.execution?.temperature ?? 0.7,
          model: undefined,
        });

        // 2. UNDERSTAND & PLAN
        const decision = this.parseDecision(aiResponse.text);

        // 3. EXECUTE DECISION
        if (decision.action === "tool" && decision.tool) {
          this.lifecycle.transition("EXECUTING", `Tool ${decision.tool}`);
          this.emitStateChange(`Using ${decision.tool}...`);

          const { result: toolResult, provenance } = await this.toolGateway.execute(
            decision.tool,
            decision.args ?? {},
            executionContext
          );

          this.taskManager.addProvenanceRecord(task.id, provenance);

          this.taskManager.addStep(task.id, {
            description: `Executed tool '${decision.tool}'`,
            tool: decision.tool,
            toolArgs: decision.args,
            toolResult: toolResult.success ? toolResult.output : `Error: ${toolResult.error}`,
            thought: decision.thought,
          });

          this.memory.push({
            timestamp: Date.now(),
            type: "action",
            content: `Executed tool '${decision.tool}' with result: ${toolResult.output || toolResult.error}`,
            taskId: task.id,
          });
        } else if (decision.action === "delegate" && decision.subtaskTitle && decision.delegateToAgentId) {
          this.lifecycle.transition("COMMUNICATING", `Delegating to ${decision.delegateToAgentId}`);
          this.emitStateChange(`Delegating subtask to ${decision.delegateToAgentId}...`);

          const child = this.taskManager.createTask({
            title: decision.subtaskTitle,
            description: decision.subtaskDescription || decision.subtaskTitle,
            assignedAgentId: decision.delegateToAgentId,
            parentTaskId: task.id,
            workspaceId: effectiveWorkspaceId,
            workspacePath: effectiveWorkspacePath,
            acceptanceCriteria: task.acceptanceCriteria,
            requiredEvidence: task.requiredEvidence,
            requiredTools: task.requiredTools,
          });

          this.taskManager.addStep(task.id, {
            description: `Delegated subtask '${decision.subtaskTitle}' to agent ${decision.delegateToAgentId}`,
            thought: decision.thought,
          });

          this.lifecycle.transition("WAITING", `Waiting on child task ${child.id}`);
          this.emitStateChange(`Waiting for ${decision.delegateToAgentId}...`);
          completed = true; // Wait for dependency resolution
        } else if (decision.action === "complete") {
          const finalResult = decision.result || aiResponse.text;
          const compRes = this.taskManager.completeTask(task.id, finalResult);
          if (compRes && compRes.status !== "COMPLETED") {
            const reason = compRes.blockReason || "Completion rejected by verification engine";
            this.taskManager.addStep(task.id, {
              description: `Completion rejected by verification engine: ${reason}`,
              tool: "verifier",
              toolResult: `Blocker: ${reason}. You must execute the required action tools before completing.`,
              thought: "Must execute required action tools before completing",
            });
            if (hasTurnLimit && iteration >= effectiveMaxIterations) {
              this.lifecycle.transition("ERROR", `Blocked: ${reason.slice(0, 80)}`);
              this.emitStateChange(`Blocked: ${reason.slice(0, 80)}`);
              completed = true;
            } else {
              this.lifecycle.transition("EXECUTING", `Retrying: executing action tools...`);
              this.emitStateChange(`Action tool required to fulfill task...`);
            }
          } else {
            this.lifecycle.transition("COMPLETED", "Task completed");
            this.emitStateChange(`Completed task: ${task.title}`);
            completed = true;
          }
        } else if (decision.action === "fail") {
          const errMsg = decision.error || "Agent reported failure";
          this.lifecycle.transition("ERROR", errMsg);
          this.emitStateChange(`Failed: ${errMsg}`);
          this.taskManager.failTask(task.id, errMsg);
          completed = true;
        } else {
          // If no structured command is found, verify if raw text constitutes valid completion
          const compRes = this.taskManager.completeTask(task.id, aiResponse.text);
          if (compRes && compRes.status !== "COMPLETED") {
            const reason = compRes.blockReason || "Completion rejected by verification engine";
            this.taskManager.addStep(task.id, {
              description: `Completion rejected by verification engine: ${reason}`,
              tool: "verifier",
              toolResult: `Blocker: ${reason}. Text response alone is not sufficient; invoke the appropriate action tool.`,
              thought: "Must execute required action tools before completing",
            });
            if (hasTurnLimit && iteration >= effectiveMaxIterations) {
              this.lifecycle.transition("ERROR", `Blocked: ${reason.slice(0, 80)}`);
              this.emitStateChange(`Blocked: ${reason.slice(0, 80)}`);
              completed = true;
            } else {
              this.lifecycle.transition("EXECUTING", `Retrying: executing action tools...`);
              this.emitStateChange(`Action tool required to fulfill task...`);
            }
          } else {
            this.lifecycle.transition("COMPLETED", "Completed output");
            this.emitStateChange(`Finished: ${task.title}`);
            completed = true;
          }
        }
      }

      if (!completed && hasTurnLimit && iteration >= effectiveMaxIterations) {
        const lastStep = task.steps[task.steps.length - 1];
        const findingsSummary = task.steps
          .map((s) => `[${s.tool || "decision"}]: ${s.description} -> ${s.toolResult || ""}`)
          .slice(-6)
          .join("\n");

        this.taskManager.saveCheckpoint(task.id, {
          turnNumber: iteration,
          maxTurns: effectiveMaxIterations,
          intermediateFindings:
            findingsSummary ||
            `Task reached iteration limit (${effectiveMaxIterations} turns). Intermediate findings preserved.`,
          completedStepsCount: task.steps.length,
          nextRecommendedAction: lastStep
            ? `Resume execution after step #${lastStep.stepNumber}: ${lastStep.description}`
            : "Resume execution from preserved intermediate findings",
        });

        this.lifecycle.transition(
          "PAUSED",
          `Turn limit reached (${effectiveMaxIterations} turns). Execution checkpoint preserved.`
        );
        this.emitStateChange(`Paused (turn limit reached, checkpoint saved)`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lifecycle.transition("ERROR", msg);
      this.emitStateChange(`Error: ${msg.slice(0, 80)}`);
      this.taskManager.failTask(task.id, msg);
      this.triggerSelfImprovementReflection(task, msg);
    } finally {
      this.isRunning = false;
      this.currentTask = null;
      setTimeout(() => {
        if (this.lifecycle.state !== "ERROR" && this.lifecycle.state !== "PAUSED") {
          this.lifecycle.transition("IDLE", "Ready for next task");
          this.emitStateChange("Ready at office desk");
        }
      }, 3000);
    }
  }

  private buildSystemPrompt(): string {
    const effectiveBase = this.activeTaskPromptSnapshot?.assembledPrompt || this.config.systemPrompt;
    const toolDeclarations = this.toolRegistry.getToolDeclarations(this.config.allowedTools);

    return `${effectiveBase}

You are ${this.config.name}, role: ${this.config.role} in Star Office World.

AVAILABLE TOOLS:
${toolDeclarations || "(No tools assigned)"}

DECISION FORMAT:
You MUST respond with a JSON block wrapped in \`\`\`json ... \`\`\` specifying your decision:

To execute a tool:
\`\`\`json
{
  "action": "tool",
  "tool": "tool_name",
  "args": { "param1": "value" },
  "thought": "Reasoning for using this tool"
}
\`\`\`

To delegate a subtask (if you are the Coordinator):
\`\`\`json
{
  "action": "delegate",
  "subtaskTitle": "...",
  "subtaskDescription": "...",
  "delegateToAgentId": "agent_nova | agent_researcher | agent_writer | agent_reviewer",
  "thought": "Why delegating"
}
\`\`\`

CRITICAL EXECUTION INTEGRITY RULES:
- You MUST ALWAYS respond with a JSON decision block. Do NOT reply with conversational chat, apologies, or plain prose.
- When asked to create, write, edit, or modify files in the project workspace, you MUST invoke 'workspace_write_file' with 'filePath' (relative to workspace root, e.g. 'test.md', 'src/types.ts') and 'content'. It directly writes and updates files on disk.
- When asked about Antigravity access, connection status, repository analysis, or software engineering tasks: DO NOT guess, DO NOT assume tools are absent, and DO NOT instruct the user to run manual shell commands!
- You have direct tools to inspect authorized workspaces:
  * 'get_antigravity_workspace_git_status' to inspect real git status, active branch, and modified files.
  * 'list_antigravity_workspace_files' to inspect files in the authorized repository.
  * 'read_antigravity_workspace_file' to read file contents from the repository.
  * 'workspace_write_file' to create or edit files in the authorized workspace.
  * 'check_antigravity_bridge' to verify bridge status.
- Never output excuses such as "I do not have access to..." or "Run these commands manually...". If a task requires evidence from a repository or workspace, invoke the appropriate tools to collect real data.

To complete the task:
\`\`\`json
{
  "action": "complete",
  "result": "Comprehensive final answer or deliverable",
  "thought": "Task completion justification"
}
\`\`\`
`;
  }

  private buildPrompt(task: OfficeTask, iteration: number): string {
    const previousSteps = task.steps
      .map((s) => `Step #${s.stepNumber} [${s.tool || "decision"}]: ${s.description}\nResult: ${s.toolResult || "(none)"}`)
      .join("\n\n");

    const wsInfo = `Target Workspace: ${task.workspaceId || "default_workspace"}${task.workspacePath ? ` (Path: ${task.workspacePath})` : ""}`;
    const criteriaInfo = task.acceptanceCriteria && task.acceptanceCriteria.length > 0
      ? `\nACCEPTANCE CRITERIA:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
      : "";
    const reqToolsInfo = task.requiredTools && task.requiredTools.length > 0
      ? `\nREQUIRED TOOLS FOR COMPLETION:\n${task.requiredTools.map((t) => `- ${t}`).join("\n")}`
      : "";

    // Checkpoint resumption guidance
    const checkpointInfo = task.checkpoint
      ? `\nPREVIOUS EXECUTION CHECKPOINT (Turn ${task.checkpoint.turnNumber}/${task.checkpoint.maxTurns}):
Saved At: ${new Date(task.checkpoint.savedAt).toISOString()}
Intermediate Findings:
${task.checkpoint.intermediateFindings}
Completed Steps Count: ${task.checkpoint.completedStepsCount}
Next Recommended Action: ${task.checkpoint.nextRecommendedAction || "Continue from preserved intermediate findings"}\n`
      : "";

    // Delegated subtask outcomes visibility
    const childTasks = this.taskManager.listTasks({ parentTaskId: task.id });
    const childDeliverablesInfo =
      childTasks.length > 0
        ? `\nDELEGATED SUBTASK DELIVERABLES & OUTCOMES:
${childTasks
  .map(
    (c) =>
      `* Subtask "${c.title}" (Assigned: ${c.assignedAgentId || "unassigned"}) -> Status: [${c.status}]
  Deliverable: ${c.result || "(in progress / no deliverable yet)"}
  Executed Tools Provenance: ${
    c.provenance && c.provenance.length > 0
      ? c.provenance.map((p) => `${p.tool} (${p.status})`).join(", ")
      : "(none)"
  }`
  )
  .join("\n")}\n`
        : "";

    return `TASK TO EXECUTE:
ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
${wsInfo}${criteriaInfo}${reqToolsInfo}${checkpointInfo}${childDeliverablesInfo}

EXECUTION PROGRESS (Turn ${iteration}):
${previousSteps || "(No previous steps executed yet)"}

Analyze the task requirements, target workspace, delegated subtask deliverables, and previous step results. Formulate your next action and return your JSON decision.`;
  }

  private parseDecision(text: string): AgentActionDecision {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const rawJson = jsonMatch ? jsonMatch[1] : text;

    try {
      const parsed = JSON.parse(rawJson!) as AgentActionDecision;
      if (parsed && typeof parsed.action === "string") {
        return parsed;
      }
    } catch {
      // Fallback: look for direct JSON object
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end > start) {
          const parsed = JSON.parse(text.slice(start, end + 1)) as AgentActionDecision;
          if (parsed && typeof parsed.action === "string") {
            return parsed;
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      action: "complete",
      result: text,
      thought: "Direct response",
    };
  }

  private triggerSelfImprovementReflection(task: OfficeTask, failureReason: string): void {
    if (!this.proposalManager) return;
    const activeVer = this.promptRegistry?.getActiveVersion(this.agentId);
    if (!activeVer) return;

    // Avoid duplicate draft proposals if one is already in discussion
    const existing = this.proposalManager.listProposals({ targetAgentId: this.agentId, status: "DISCUSSING" });
    if (existing.length > 0) return;

    this.proposalManager
      .createProposal({
        targetAgentId: this.agentId,
        author: this.agentId,
        category: "error_recovery",
        priority: "high",
        problemStatement: `Execution failed on task '${task.title}': ${failureReason.slice(0, 100)}`,
        observedEvidence: [
          `Task ID: ${task.id}`,
          `Failure Reason: ${failureReason}`,
          `Turn Limit or Tool Execution Failure Encountered`,
        ],
        proposedChange: `${activeVer.content}\n\nSPECIALIZED ERROR HEURISTIC:\n- When executing similar tasks, verify parameters before invoking tools to prevent '${failureReason.slice(0, 50)}'.`,
        expectedImprovement: `Prevents recurring errors and establishes pre-execution validation for ${task.title}.`,
        potentialRisks: `Slightly longer prompt length (+35 words).`,
      })
      .catch((err) => {
        console.warn(`[agent-instance] Autonomous reflection proposal failed:`, err);
      });
  }
}
