/**
 * Star Office World — Agent Configuration Manager
 * Manages FullAgentConfig CRUD, lifecycle states, configuration versioning,
 * safe deletion, cloning, template management, and rollback.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  FullAgentConfig,
  AgentConfigVersion,
  AgentLifecycleStatus,
  AgentTemplate,
  AgentPermission,
  AgentMemoryConfig,
  AgentTeamConfig,
  AgentExecutionConfig,
} from "./types.js";
import { BUILTIN_AGENT_TEMPLATES } from "./templates.js";
import { DEFAULT_AGENTS } from "../core/AgentRegistry.js";
import type { PromptRegistry } from "../prompts/PromptRegistry.js";

export const DEFAULT_PERMISSIONS: AgentPermission = {
  canModifyFiles: true,
  canDelegateTasks: true,
  canCommunicateWithPeers: true,
  canUseAntigravity: true,
  canExecuteTests: true,
  canAccessNetwork: true,
  requiresApprovalForSensitiveOps: false,
};

export const DEFAULT_MEMORY_CONFIG: AgentMemoryConfig = {
  memoryType: "persistent",
  retentionDays: 30,
  maxEntries: 1000,
};

export const DEFAULT_TEAM_CONFIG: AgentTeamConfig = {
  collaboratingAgentIds: [],
  allowedDelegators: [],
};

export const DEFAULT_EXECUTION_CONFIG: AgentExecutionConfig = {
  temperature: 0.7,
  maxIterations: 8,
  timeoutMs: 60000,
  retryPolicy: "none",
};

export class AgentConfigManager {
  private dataDir: string;
  private agentsFilePath: string;
  private historyBaseDir: string;
  private customTemplatesPath: string;
  private promptRegistry?: PromptRegistry;
  private configs = new Map<string, FullAgentConfig>();
  private customTemplates: AgentTemplate[] = [];

  constructor(dataDir: string, promptRegistry?: PromptRegistry) {
    this.dataDir = dataDir;
    this.promptRegistry = promptRegistry;
    this.agentsFilePath = path.join(dataDir, "agents", "agents.json");
    this.historyBaseDir = path.join(dataDir, "agents", "history");
    this.customTemplatesPath = path.join(dataDir, "agents", "custom-templates.json");

    this.ensureDirectories();
    this.loadConfigs();
    this.loadCustomTemplates();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(path.join(this.dataDir, "agents"), { recursive: true });
    fs.mkdirSync(this.historyBaseDir, { recursive: true });
  }

  private computeHash(obj: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
  }

  private loadCustomTemplates(): void {
    if (fs.existsSync(this.customTemplatesPath)) {
      try {
        const raw = fs.readFileSync(this.customTemplatesPath, "utf8");
        this.customTemplates = JSON.parse(raw);
      } catch (err) {
        console.warn("[AgentConfigManager] Failed to read custom-templates.json:", err);
      }
    }
  }

  public saveCustomTemplate(template: Omit<AgentTemplate, "templateId" | "isBuiltIn"> & { templateId?: string }): AgentTemplate {
    const templateId = template.templateId || `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullTemplate: AgentTemplate = {
      ...template,
      templateId,
      isBuiltIn: false,
    };

    const existingIdx = this.customTemplates.findIndex((t) => t.templateId === templateId);
    if (existingIdx >= 0) {
      this.customTemplates[existingIdx] = fullTemplate;
    } else {
      this.customTemplates.push(fullTemplate);
    }

    fs.writeFileSync(this.customTemplatesPath, JSON.stringify(this.customTemplates, null, 2), "utf8");
    return fullTemplate;
  }

  public listTemplates(): AgentTemplate[] {
    return [...BUILTIN_AGENT_TEMPLATES, ...this.customTemplates];
  }

  public getTemplate(templateId: string): AgentTemplate | undefined {
    return this.listTemplates().find((t) => t.templateId === templateId);
  }

  /**
   * Migrate legacy DEFAULT_AGENTS or existing data to FullAgentConfig schema
   */
  private loadConfigs(): void {
    // 1. Check if agents/agents.json exists
    if (fs.existsSync(this.agentsFilePath)) {
      try {
        const raw = fs.readFileSync(this.agentsFilePath, "utf8");
        const list = JSON.parse(raw) as FullAgentConfig[];
        if (Array.isArray(list) && list.length > 0) {
          for (const item of list) {
            this.configs.set(item.agentId, item);
          }
          return;
        }
      } catch (err) {
        console.warn("[AgentConfigManager] Failed to parse agents.json:", err);
      }
    }

    // 2. Check legacy root agents.json
    const legacyPath = path.join(this.dataDir, "agents.json");
    let legacyList: any[] = [];
    if (fs.existsSync(legacyPath)) {
      try {
        const raw = fs.readFileSync(legacyPath, "utf8");
        legacyList = JSON.parse(raw);
      } catch (err) {
        console.warn("[AgentConfigManager] Failed to read legacy agents.json:", err);
      }
    }

    const sourceList = legacyList.length > 0 ? legacyList : DEFAULT_AGENTS;

    for (const raw of sourceList) {
      const full: FullAgentConfig = {
        agentId: raw.agentId,
        name: raw.name,
        role: raw.role,
        description: raw.description || `Autonomous agent ${raw.name}`,
        avatar: raw.avatar || "guest_role_1",
        displayColor: raw.displayColor || "#4f46e5",
        systemPrompt: raw.systemPrompt,
        allowedTools: raw.allowedTools || [],
        isMain: !!raw.isMain,
        responsibilities: raw.responsibilities || [raw.description || "General operations"],
        objectives: raw.objectives || ["Fulfill assigned tasks with high quality"],
        expectedOutputs: raw.expectedOutputs || ["Detailed summaries and deliverables"],
        expertise: raw.expertise || [raw.role],
        skills: raw.skills || [],
        permissions: { ...DEFAULT_PERMISSIONS, ...(raw.permissions || {}) },
        memory: { ...DEFAULT_MEMORY_CONFIG, ...(raw.memory || {}) },
        team: { ...DEFAULT_TEAM_CONFIG, ...(raw.team || {}) },
        execution: { ...DEFAULT_EXECUTION_CONFIG, ...(raw.execution || {}) },
        lifecycleStatus: raw.lifecycleStatus || "ACTIVE",
        configVersion: raw.configVersion || 1,
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now(),
      };

      this.configs.set(full.agentId, full);
      this.recordHistoryVersion(full, ["initial_bootstrap"], "Bootstrap initial configuration", "system");
    }

    this.persistAll();
  }

  private persistAll(): void {
    const list = Array.from(this.configs.values());
    fs.writeFileSync(this.agentsFilePath, JSON.stringify(list, null, 2), "utf8");
    // Also mirror to legacy path for backward compatibility
    try {
      fs.writeFileSync(path.join(this.dataDir, "agents.json"), JSON.stringify(list, null, 2), "utf8");
    } catch {
      // ignore
    }
  }

  public listAgents(filters?: {
    status?: AgentLifecycleStatus;
    role?: string;
    teamId?: string;
    activeOnly?: boolean;
    search?: string;
  }): FullAgentConfig[] {
    let list = Array.from(this.configs.values());

    if (filters) {
      if (filters.status) {
        list = list.filter((a) => a.lifecycleStatus === filters.status);
      }
      if (filters.activeOnly) {
        list = list.filter((a) => a.lifecycleStatus === "ACTIVE");
      }
      if (filters.role) {
        const rLower = filters.role.toLowerCase();
        list = list.filter((a) => a.role.toLowerCase().includes(rLower));
      }
      if (filters.teamId) {
        list = list.filter((a) => a.team.teamId === filters.teamId);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.agentId.toLowerCase().includes(q) ||
            a.role.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q)
        );
      }
    }

    return list;
  }

  public getAgent(agentId: string): FullAgentConfig | undefined {
    return this.configs.get(agentId);
  }

  public validateConfig(input: Partial<FullAgentConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!input.agentId || !/^[a-zA-Z0-9_-]+$/.test(input.agentId)) {
      errors.push("agentId must be a valid alphanumeric slug with underscores or hyphens.");
    }
    if (!input.name || input.name.trim().length === 0) {
      errors.push("name is required and cannot be empty.");
    }
    if (!input.role || input.role.trim().length === 0) {
      errors.push("role is required and cannot be empty.");
    }
    if (!input.systemPrompt || input.systemPrompt.trim().length === 0) {
      errors.push("systemPrompt is required and cannot be empty.");
    }
    return { valid: errors.length === 0, errors };
  }

  public createAgent(
    input: Omit<FullAgentConfig, "configVersion" | "createdAt" | "updatedAt">,
    author = "human_owner"
  ): FullAgentConfig {
    const validation = this.validateConfig(input);
    if (!validation.valid) {
      throw new Error(`Invalid agent configuration: ${validation.errors.join(", ")}`);
    }

    if (this.configs.has(input.agentId)) {
      throw new Error(`Agent with ID '${input.agentId}' already exists.`);
    }

    const now = Date.now();
    const full: FullAgentConfig = {
      ...input,
      permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions || {}) },
      memory: { ...DEFAULT_MEMORY_CONFIG, ...(input.memory || {}) },
      team: { ...DEFAULT_TEAM_CONFIG, ...(input.team || {}) },
      execution: { ...DEFAULT_EXECUTION_CONFIG, ...(input.execution || {}) },
      lifecycleStatus: input.lifecycleStatus || "READY",
      configVersion: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.configs.set(full.agentId, full);
    this.persistAll();
    this.recordHistoryVersion(full, ["created"], "Initial agent creation", author);

    // Sync with prompt registry if available
    if (this.promptRegistry) {
      try {
        this.promptRegistry.registerAgent(full.agentId, full.name, full.role, full.systemPrompt);
      } catch {
        // ignore
      }
    }

    return full;
  }

  public updateAgent(
    agentId: string,
    updates: Partial<Omit<FullAgentConfig, "agentId" | "configVersion" | "createdAt" | "updatedAt">>,
    author = "human_owner",
    changeReason = "Configuration updated"
  ): FullAgentConfig {
    const existing = this.configs.get(agentId);
    if (!existing) {
      throw new Error(`Agent '${agentId}' not found.`);
    }

    if (existing.lifecycleStatus === "ARCHIVED") {
      throw new Error(`Agent '${agentId}' is archived and cannot be edited. Reactivate it first.`);
    }

    const changedFields: string[] = [];
    const updated: FullAgentConfig = {
      ...existing,
      ...updates,
      permissions: updates.permissions ? { ...existing.permissions, ...updates.permissions } : existing.permissions,
      memory: updates.memory ? { ...existing.memory, ...updates.memory } : existing.memory,
      team: updates.team ? { ...existing.team, ...updates.team } : existing.team,
      execution: updates.execution ? { ...existing.execution, ...updates.execution } : existing.execution,
      configVersion: existing.configVersion + 1,
      updatedAt: Date.now(),
    };

    for (const key of Object.keys(updates) as Array<keyof FullAgentConfig>) {
      if (JSON.stringify((existing as any)[key]) !== JSON.stringify((updated as any)[key])) {
        changedFields.push(key);
      }
    }

    const validation = this.validateConfig(updated);
    if (!validation.valid) {
      throw new Error(`Validation failed for updated agent: ${validation.errors.join(", ")}`);
    }

    this.configs.set(agentId, updated);
    this.persistAll();
    this.recordHistoryVersion(updated, changedFields, changeReason, author);

    // Sync prompt if systemPrompt changed
    if (updates.systemPrompt && updates.systemPrompt !== existing.systemPrompt && this.promptRegistry) {
      try {
        this.promptRegistry.setAgentPrompt(agentId, updates.systemPrompt, changeReason, author);
      } catch {
        // ignore
      }
    }

    return updated;
  }

  public cloneAgent(
    sourceAgentId: string,
    newAgentId: string,
    newName?: string,
    author = "human_owner"
  ): FullAgentConfig {
    const source = this.configs.get(sourceAgentId);
    if (!source) {
      throw new Error(`Source agent '${sourceAgentId}' not found.`);
    }

    if (this.configs.has(newAgentId)) {
      throw new Error(`Target agent ID '${newAgentId}' already exists.`);
    }

    const cloned: Omit<FullAgentConfig, "configVersion" | "createdAt" | "updatedAt"> = {
      ...JSON.parse(JSON.stringify(source)),
      agentId: newAgentId,
      name: newName || `${source.name} (Clone)`,
      isMain: false,
      lifecycleStatus: "CONFIGURED",
    };

    return this.createAgent(cloned, author);
  }

  public setStatus(
    agentId: string,
    status: AgentLifecycleStatus,
    author = "human_owner",
    reason = "Lifecycle status update"
  ): FullAgentConfig {
    const existing = this.configs.get(agentId);
    if (!existing) {
      throw new Error(`Agent '${agentId}' not found.`);
    }

    return this.updateAgent(agentId, { lifecycleStatus: status }, author, reason);
  }

  public deleteAgent(agentId: string, force = false): { success: boolean; message: string } {
    const existing = this.configs.get(agentId);
    if (!existing) {
      throw new Error(`Agent '${agentId}' not found.`);
    }

    if (existing.isMain && !force) {
      throw new Error(`Cannot delete main agent '${agentId}' without force=true.`);
    }

    if (existing.lifecycleStatus === "ACTIVE" && !force) {
      throw new Error(`Cannot delete active agent '${agentId}'. Pause or archive it first.`);
    }

    this.configs.delete(agentId);
    this.persistAll();
    return { success: true, message: `Agent '${agentId}' permanently deleted.` };
  }

  public archiveAgent(agentId: string, author = "human_owner"): FullAgentConfig {
    return this.setStatus(agentId, "ARCHIVED", author, "Agent archived by owner");
  }

  public getHistory(agentId: string): AgentConfigVersion[] {
    const agentDir = path.join(this.historyBaseDir, agentId);
    if (!fs.existsSync(agentDir)) return [];

    const files = fs.readdirSync(agentDir).filter((f) => f.endsWith(".json"));
    const versions: AgentConfigVersion[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(agentDir, file), "utf8");
        versions.push(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    return versions.sort((a, b) => b.configVersion - a.configVersion);
  }

  public rollback(
    agentId: string,
    targetVersionId: string,
    reason = "Configuration rolled back",
    author = "human_owner"
  ): FullAgentConfig {
    const versions = this.getHistory(agentId);
    const target = versions.find((v) => v.versionId === targetVersionId);
    if (!target) {
      throw new Error(`Version '${targetVersionId}' not found for agent '${agentId}'.`);
    }

    const restored = target.configuration;
    return this.updateAgent(
      agentId,
      {
        name: restored.name,
        role: restored.role,
        description: restored.description,
        avatar: restored.avatar,
        displayColor: restored.displayColor,
        systemPrompt: restored.systemPrompt,
        allowedTools: restored.allowedTools,
        responsibilities: restored.responsibilities,
        objectives: restored.objectives,
        expectedOutputs: restored.expectedOutputs,
        expertise: restored.expertise,
        skills: restored.skills,
        permissions: restored.permissions,
        memory: restored.memory,
        team: restored.team,
        execution: restored.execution,
      },
      author,
      `${reason} (restored from ${targetVersionId})`
    );
  }

  private recordHistoryVersion(
    config: FullAgentConfig,
    changedFields: string[],
    changeReason: string,
    author: string
  ): AgentConfigVersion {
    const agentDir = path.join(this.historyBaseDir, config.agentId);
    fs.mkdirSync(agentDir, { recursive: true });

    const versionId = `cfg_v${config.configVersion}`;
    const versionRecord: AgentConfigVersion = {
      agentId: config.agentId,
      configVersion: config.configVersion,
      versionId,
      configuration: JSON.parse(JSON.stringify(config)),
      changedFields,
      author,
      timestamp: Date.now(),
      changeReason,
      hash: this.computeHash(config),
    };

    const filePath = path.join(agentDir, `${versionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(versionRecord, null, 2), "utf8");
    return versionRecord;
  }
}
