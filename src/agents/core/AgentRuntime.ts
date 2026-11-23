/**
 * Star Office World — Autonomous Agent Runtime Supervisor
 * Manages all agent instances, dispatching tasks, configuration lifecycle,
 * and syncing with Star Office World.
 */

import path from "node:path";
import type { OfficeWorldState } from "../../types.js";
import { updateAgentState, addAgent, addMemo } from "../../state.js";
import type { SSEManager } from "../../sse.js";
import type { MemoStore } from "../../memo-store.js";
import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutionGateway } from "../tools/ToolExecutionGateway.js";
import { TaskManager } from "../tasks/TaskManager.js";
import { AgentRegistry, DEFAULT_AGENTS } from "./AgentRegistry.js";
import { AgentInstance } from "./AgentInstance.js";
import type { OfficeTask } from "../tasks/TaskTypes.js";
import { AntigravityBridge } from "../../integrations/antigravity/bridge/AntigravityBridge.js";
import { PromptRegistry } from "../prompts/PromptRegistry.js";
import { PromptProposalManager } from "../prompts/PromptProposalManager.js";
import { AgentConfigManager } from "../management/AgentConfigManager.js";
import { AgentTestPlayground } from "../management/AgentTestPlayground.js";
import type { FullAgentConfig, AgentLifecycleStatus } from "../management/types.js";
import { MeetingEngine } from "../meeting/MeetingEngine.js";
import { ActivityMonitorService } from "../monitor/ActivityMonitorService.js";

export interface AgentRuntimeDeps {
  officeState: OfficeWorldState;
  sse: SSEManager;
  memoStore: MemoStore;
  aiProvider: AIProvider;
  dataDir: string;
}

export class AgentRuntime {
  private deps: AgentRuntimeDeps;
  public readonly toolRegistry: ToolRegistry;
  public readonly toolGateway: ToolExecutionGateway;
  public readonly taskManager: TaskManager;
  public readonly agentRegistry: AgentRegistry;
  public readonly antigravityBridge: AntigravityBridge;
  public readonly promptRegistry: PromptRegistry;
  public readonly proposalManager: PromptProposalManager;
  public readonly configManager: AgentConfigManager;
  public readonly testPlayground: AgentTestPlayground;
  public readonly meetingEngine: MeetingEngine;
  public readonly activityMonitor: ActivityMonitorService;
  private agents = new Map<string, AgentInstance>();
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private workspaceDir: string;

  constructor(deps: AgentRuntimeDeps) {
    this.deps = deps;
    this.workspaceDir = path.join(deps.dataDir, "workspace");
    this.toolRegistry = new ToolRegistry();
    this.toolGateway = new ToolExecutionGateway(this.toolRegistry, deps.dataDir, (provenance) => {
      try {
        deps.sse.broadcast("provenance_event", provenance);
        deps.sse.broadcast("activity_monitor_updated", {
          agentId: provenance.agentId,
          taskId: provenance.taskId,
          status: provenance.status,
          tool: provenance.tool,
          timestamp: provenance.completedAt || provenance.startedAt || Date.now(),
        });
      } catch (err) {
        console.warn("[AgentRuntime] Failed to broadcast provenance SSE event:", err);
      }
    });
    this.agentRegistry = new AgentRegistry(deps.dataDir);

    this.promptRegistry = new PromptRegistry(deps.dataDir);
    this.configManager = new AgentConfigManager(deps.dataDir, this.promptRegistry);

    this.antigravityBridge = new AntigravityBridge({
      officeState: deps.officeState,
      sse: deps.sse,
      memoStore: deps.memoStore,
      dataDir: deps.dataDir,
    });

    this.proposalManager = new PromptProposalManager({
      officeState: deps.officeState,
      sse: deps.sse,
      memoStore: deps.memoStore,
      aiProvider: deps.aiProvider,
      dataDir: deps.dataDir,
      promptRegistry: this.promptRegistry,
    });

    this.testPlayground = new AgentTestPlayground({
      aiProvider: deps.aiProvider,
      toolRegistry: this.toolRegistry,
      configManager: this.configManager,
      dataDir: deps.dataDir,
      workspaceDir: process.cwd(),
      antigravityBridge: this.antigravityBridge,
    });

    this.taskManager = new TaskManager(deps.dataDir, (task) => {
      this.broadcastTaskEvent(task);
    });

    this.meetingEngine = new MeetingEngine({
      officeState: deps.officeState,
      sse: deps.sse,
      memoStore: deps.memoStore,
      taskManager: this.taskManager,
      aiProvider: deps.aiProvider,
      dataDir: deps.dataDir,
      configManager: this.configManager,
    });

    this.activityMonitor = new ActivityMonitorService(this, () => this.deps.officeState);

    this.initializeAgents();
    this.startSupervisor();
  }

  private initializeAgents(): void {
    const configs = this.configManager.listAgents();

    for (const cfg of configs) {
      this.instantiateAgent(cfg);
    }
  }

  public instantiateAgent(cfg: FullAgentConfig): AgentInstance {
    // 1. Ensure registered in Star Office World state
    if (!this.deps.officeState.agents[cfg.agentId]) {
      const agent = addAgent(
        this.deps.officeState,
        cfg.agentId,
        cfg.name,
        cfg.avatar,
        cfg.lifecycleStatus === "PAUSED" ? "paused" : "idle",
        cfg.role,
        cfg.isMain
      );
      this.deps.sse.broadcast("agent_join", agent);
    }

    // 2. Instantiate runtime agent
    const instance = new AgentInstance({
      config: cfg,
      aiProvider: this.deps.aiProvider,
      toolRegistry: this.toolRegistry,
      toolGateway: this.toolGateway,
      taskManager: this.taskManager,
      dataDir: this.deps.dataDir,
      workspaceDir: this.workspaceDir,
      eventBus: (event, payload) => this.handleAgentEvent(event, payload),
      antigravityBridge: this.antigravityBridge,
      promptRegistry: this.promptRegistry,
      proposalManager: this.proposalManager,
    });

    if (cfg.lifecycleStatus === "PAUSED") {
      instance.lifecycle.transition("PAUSED", "Initial state is PAUSED");
    }

    this.agents.set(cfg.agentId, instance);
    return instance;
  }

  public registerNewAgent(
    config: Omit<FullAgentConfig, "configVersion" | "createdAt" | "updatedAt">,
    author = "human_owner"
  ): FullAgentConfig {
    const full = this.configManager.createAgent(config, author);
    this.instantiateAgent(full);
    return full;
  }

  public updateAgentConfig(
    agentId: string,
    updates: Partial<Omit<FullAgentConfig, "agentId" | "configVersion" | "createdAt" | "updatedAt">>,
    author = "human_owner",
    reason = "Configuration updated"
  ): FullAgentConfig {
    const updated = this.configManager.updateAgent(agentId, updates, author, reason);
    const instance = this.agents.get(agentId);
    if (instance) {
      instance.updateConfig(updated);
    }

    // Sync officeState
    const officeAgent = this.deps.officeState.agents[agentId];
    if (officeAgent) {
      if (updates.name) officeAgent.alias = updates.name;
      if (updates.avatar) officeAgent.avatar = updates.avatar;
      this.deps.sse.broadcast("agent_update", officeAgent);
    }

    return updated;
  }

  public setAgentLifecycleStatus(
    agentId: string,
    status: AgentLifecycleStatus,
    author = "human_owner",
    reason = "Lifecycle status changed"
  ): FullAgentConfig {
    const updated = this.configManager.setStatus(agentId, status, author, reason);
    const instance = this.agents.get(agentId);
    if (instance) {
      instance.updateConfig(updated);
      if (status === "PAUSED") {
        instance.lifecycle.transition("PAUSED", reason);
        this.deps.sse.broadcast("agent_update", { agentId, state: "paused", detail: reason });
      } else if (status === "ACTIVE" && instance.status === "PAUSED") {
        instance.lifecycle.transition("IDLE", "Agent resumed");
        this.deps.sse.broadcast("agent_update", { agentId, state: "idle", detail: "Active at office desk" });
      }
    }
    return updated;
  }

  public removeAgent(agentId: string, force = false): void {
    const instance = this.agents.get(agentId);
    if (instance?.activeTask && !force) {
      throw new Error(`Agent '${agentId}' is actively executing task '${instance.activeTask.id}' and cannot be deleted.`);
    }

    this.configManager.deleteAgent(agentId, force);
    this.agents.delete(agentId);
    delete this.deps.officeState.agents[agentId];
    this.deps.sse.broadcast("state", this.deps.officeState);
  }

  private handleAgentEvent(event: string, payload: unknown): void {
    const data = payload as Record<string, unknown>;

    if (event === "agent_state_changed") {
      const agentId = String(data["agentId"] ?? "");
      const visualState = String(data["visualState"] ?? "idle");
      const detail = String(data["detail"] ?? "");

      const updated = updateAgentState(
        this.deps.officeState,
        agentId,
        visualState,
        detail
      );

      if (updated) {
        this.deps.sse.broadcast("agent_update", updated);
      }
    } else if (event === "office_memo") {
      const agentId = String(data["agentId"] ?? "");
      const alias = String(data["alias"] ?? "");
      const content = String(data["content"] ?? "");

      const entry = addMemo(this.deps.officeState, agentId, alias, content);
      try {
        this.deps.memoStore.append(entry);
      } catch (err) {
        console.warn("[agent-runtime] Failed to persist memo:", err);
      }
      this.deps.sse.broadcast("memo", entry);
    } else if (event === "agent_message") {
      // Broadcast inter-agent message over SSE for UI visibility
      this.deps.sse.broadcast("agent_update", {
        agentId: data["fromAgentId"],
        detail: `Sent memo to ${data["toAgentId"]}`,
      });
    }
  }

  private broadcastTaskEvent(task: OfficeTask): void {
    // Custom SSE broadcast for task updates
    this.deps.sse.broadcast("state", {
      ...this.deps.officeState,
      latestTask: task,
    });
  }

  private startSupervisor(): void {
    // Polls queue every 1500ms to dispatch pending tasks to idle agents and resume unblocked parent tasks
    this.dispatchTimer = setInterval(() => {
      this.dispatchPendingTasks();
      this.resumeUnblockedParentTasks();
    }, 1500);
    if (typeof this.dispatchTimer.unref === "function") {
      this.dispatchTimer.unref();
    }
  }

  private isAgentAvailableForTask(instance: AgentInstance): boolean {
    if (instance.status !== "IDLE") return false;
    const cfg = this.configManager.getAgent(instance.agentId);
    if (!cfg) return true;
    return cfg.lifecycleStatus === "ACTIVE";
  }

  private resumeUnblockedParentTasks(): void {
    const inProgressTasks = this.taskManager.listTasks({ status: "IN_PROGRESS" });
    for (const task of inProgressTasks) {
      const children = this.taskManager.listTasks({ parentTaskId: task.id });
      if (children.length > 0 && children.every((c) => c.status === "COMPLETED")) {
        if (task.assignedAgentId) {
          const agent = this.agents.get(task.assignedAgentId);
          if (agent && (agent.status === "WAITING" || agent.status === "IDLE")) {
            agent.executeCurrentTask().catch((err) => {
              console.error(`[agent-runtime] Failed to resume parent task ${task.id} on ${agent.name}:`, err);
            });
          }
        }
      }
    }
  }

  private dispatchPendingTasks(): void {
    const pendingTasks = this.taskManager.listTasks({ status: "PENDING" });
    if (pendingTasks.length === 0) return;

    for (const task of pendingTasks) {
      let targetAgent: AgentInstance | undefined;

      if (task.assignedAgentId) {
        const designated = this.agents.get(task.assignedAgentId);
        if (designated && this.isAgentAvailableForTask(designated)) {
          targetAgent = designated;
        }
      } else {
        // If engineering, coding, or file creation task, route directly to Nova
        const combined = `${task.title} ${task.description}`.toLowerCase();
        const isEngineering = /\b(?:create|write|edit|modify|fix|refactor|build|antigravity|code|implement|script|hello\.txt)\b/i.test(combined);
        const nova = this.agents.get("agent_nova");
        if (isEngineering && nova && this.isAgentAvailableForTask(nova)) {
          targetAgent = nova;
        } else {
          // Pick coordinator first for unassigned tasks if available
          const coordinator = this.agents.get("agent_coordinator");
          if (coordinator && this.isAgentAvailableForTask(coordinator)) {
            targetAgent = coordinator;
          } else {
            // Find any idle and active agent
            for (const agent of this.agents.values()) {
              if (this.isAgentAvailableForTask(agent)) {
                targetAgent = agent;
                break;
              }
            }
          }
        }
      }

      if (targetAgent) {
        this.taskManager.assignTask(task.id, targetAgent.agentId);
        targetAgent.assignTask(task).then(() => {
          targetAgent!.executeCurrentTask();
        }).catch((err) => {
          console.error(`[agent-runtime] Failed to execute task on ${targetAgent!.name}:`, err);
        });
      }
    }
  }

  public getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  public listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  public submitTask(opts: {
    title: string;
    description: string;
    assignedAgentId?: string;
    priority?: "low" | "medium" | "high";
    workspaceId?: string;
    workspacePath?: string;
    acceptanceCriteria?: string[];
    requiredEvidence?: string[];
    requiredTools?: string[];
  }): OfficeTask {
    const task = this.taskManager.createTask(opts);
    this.dispatchPendingTasks();
    return task;
  }

  public shutdown(): void {
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.meetingEngine.shutdown();
    this.antigravityBridge.destroy();
  }
}
