/**
 * Star Office World — Prompt Registry & Versioning Manager
 * Manages immutable prompt versions, multi-layer instruction assembly, and rollback governance.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AgentPromptVersion,
  EffectiveSystemPrompt,
  PromptAuditEvent,
  PromptImprovementProposal,
} from "./types.js";
import { DEFAULT_AGENTS } from "../core/AgentRegistry.js";

// Layer 1: Code-defined Immutable Platform Instructions
export const PLATFORM_SECURITY_INSTRUCTIONS = `=== IMMUTABLE PLATFORM SECURITY INSTRUCTIONS (LAYER 1) ===
1. SANDBOX & BOUNDARY ENFORCEMENT:
   - You operate in a strictly sandboxed virtual office environment (Star Office World).
   - Never attempt to escape the designated workspace directory or access restricted host resources.
   - All tool arguments must adhere strictly to declared JSON parameter schemas.

2. STRUCTURED REASONING & DECISION PROTOCOL:
   - Every single reasoning turn MUST conclude with an actionable JSON decision block wrapped in \`\`\`json ... \`\`\`.
   - Never output unstructured final actions or invent simulated tool results.

3. GOVERNANCE & APPROVAL LOCK:
   - You CANNOT directly modify, overwrite, or apply active system prompts.
   - You CANNOT approve your own or your peers' prompt proposals.
   - Only the verified human owner can authorize and apply production prompt updates.`;

// Layer 2: Team Operating Rules
export const TEAM_OPERATING_INSTRUCTIONS = `=== TEAM OPERATING RULES (LAYER 2) ===
1. COLLABORATION & DELEGATION:
   - Coordinate objectives through Alex (agent_coordinator).
   - Research tasks should be routed to Robin (agent_researcher).
   - Drafting and file synthesis tasks belong to Sam (agent_writer).
   - QA, fact-checking, and audits belong to Morgan (agent_reviewer).

2. COMMUNICATION & TRANSPARENCY:
   - Send concise inter-agent messages for task coordination.
   - Post significant office deliverables to the shared bulletin board via post_office_memo.`;

// Layer 3: Role Instructions
export const ROLE_INSTRUCTIONS: Record<string, string> = {
  agent_coordinator: `=== ROLE INSTRUCTIONS: OFFICE COORDINATOR (LAYER 3) ===
- Decompose complex user requests into discrete, modular subtasks.
- Assign subtasks to appropriate specialists based on their roles.
- Monitor execution dependencies and assemble final deliverables.`,

  agent_researcher: `=== ROLE INSTRUCTIONS: SENIOR RESEARCHER (LAYER 3) ===
- Conduct thorough investigation and web search via web_search and web_fetch.
- Extract factual, verified information and cite concrete sources.
- Return structured findings to requesting colleagues.`,

  agent_writer: `=== ROLE INSTRUCTIONS: TECHNICAL WRITER & ANALYST (LAYER 3) ===
- Synthesize technical findings, documentation, and reports clearly.
- Write polished files directly to the designated workspace.
- Avoid redundant fluff and adhere to established style guides.`,

  agent_reviewer: `=== ROLE INSTRUCTIONS: QA & AUDITOR (LAYER 3) ===
- Inspect workspace deliverables for accuracy, completeness, and regressions.
- Verify that acceptance criteria are satisfied before marking tasks complete.
- Report identified defects immediately with remediation steps.`,
};

export class PromptRegistry {
  private baseDir: string;
  private auditLogPath: string;
  private versions = new Map<string, Map<string, AgentPromptVersion>>(); // agentId -> versionId -> version
  private activeVersions = new Map<string, AgentPromptVersion>(); // agentId -> active version

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "prompts");
    this.auditLogPath = path.join(this.baseDir, "audit.jsonl");

    fs.mkdirSync(this.baseDir, { recursive: true });
    this.loadAllVersions();
    this.ensureDefaultVersions();
  }

  public static hashContent(content: string): string {
    return crypto.createHash("sha256").update(content.trim(), "utf8").digest("hex");
  }

  private loadAllVersions(): void {
    if (!fs.existsSync(this.baseDir)) return;

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("agent_")) {
        const agentId = entry.name;
        const agentDir = path.join(this.baseDir, agentId);
        const files = fs.readdirSync(agentDir).filter((f) => f.endsWith(".json"));

        const map = new Map<string, AgentPromptVersion>();
        let highestActive: AgentPromptVersion | null = null;

        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(agentDir, file), "utf8");
            const ver = JSON.parse(raw) as AgentPromptVersion;
            map.set(ver.versionId, ver);

            if (ver.status === "active") {
              if (!highestActive || ver.version > highestActive.version) {
                highestActive = ver;
              }
            }
          } catch (err) {
            console.warn(`[prompt-registry] Failed to read ${file}:`, err);
          }
        }

        this.versions.set(agentId, map);
        if (highestActive) {
          this.activeVersions.set(agentId, highestActive);
        }
      }
    }
  }

  private ensureDefaultVersions(): void {
    for (const agent of DEFAULT_AGENTS) {
      let active = this.activeVersions.get(agent.agentId);
      if (!active) {
        // Seed initial v1 immutable version from code configuration
        const content = agent.systemPrompt.trim();
        const v1: AgentPromptVersion = {
          agentId: agent.agentId,
          version: 1,
          versionId: "v1",
          content,
          hash: PromptRegistry.hashContent(content),
          createdAt: Date.now(),
          author: "system",
          changeDescription: "Initial production baseline prompt",
          parentVersionId: null,
          status: "active",
          activatedAt: Date.now(),
        };

        this.saveVersion(v1);
        if (!this.versions.has(agent.agentId)) {
          this.versions.set(agent.agentId, new Map());
        }
        this.versions.get(agent.agentId)!.set("v1", v1);
        this.activeVersions.set(agent.agentId, v1);

        this.logAudit({
          id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          agentId: agent.agentId,
          action: "applied",
          actor: "system",
          details: { versionId: "v1", note: "Baseline initialized" },
        });
      }
    }
  }

  private saveVersion(ver: AgentPromptVersion): void {
    const agentDir = path.join(this.baseDir, ver.agentId);
    fs.mkdirSync(agentDir, { recursive: true });
    const filePath = path.join(agentDir, `${ver.versionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(ver, null, 2), "utf8");
  }

  public getActiveVersion(agentId: string): AgentPromptVersion | undefined {
    return this.activeVersions.get(agentId);
  }

  public getVersion(agentId: string, versionId: string): AgentPromptVersion | undefined {
    return this.versions.get(agentId)?.get(versionId);
  }

  public listVersions(agentId: string): AgentPromptVersion[] {
    const map = this.versions.get(agentId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => b.version - a.version);
  }

  /**
   * Assembles the complete 5-layer system prompt fed to the model.
   */
  public getEffectivePrompt(agentId: string): EffectiveSystemPrompt {
    const active = this.getActiveVersion(agentId);
    const agentPrompt = active?.content || `You are ${agentId} in Star Office World.`;
    const roleInstructions = ROLE_INSTRUCTIONS[agentId] || "Perform your assigned office tasks.";

    const assembledPrompt = `${PLATFORM_SECURITY_INSTRUCTIONS}

${TEAM_OPERATING_INSTRUCTIONS}

${roleInstructions}

=== AGENT SYSTEM INSTRUCTIONS (LAYER 4) ===
${agentPrompt}`;

    return {
      agentId,
      version: active?.version || 1,
      versionId: active?.versionId || "v1",
      platformInstructions: PLATFORM_SECURITY_INSTRUCTIONS,
      teamInstructions: TEAM_OPERATING_INSTRUCTIONS,
      roleInstructions,
      agentPrompt,
      assembledPrompt,
    };
  }

  /**
   * Applies an approved proposal creating a new immutable version.
   * Performs optimistic concurrency check: rejects if baseVersionHash is STALE.
   */
  public applyApprovedProposal(
    proposal: PromptImprovementProposal,
    actor: string
  ): { success: boolean; version?: AgentPromptVersion; error?: string } {
    const active = this.getActiveVersion(proposal.targetAgentId);
    if (!active) {
      return { success: false, error: `No active version for ${proposal.targetAgentId}` };
    }

    // Optimistic Concurrency Check
    if (active.hash !== proposal.baseVersionHash) {
      proposal.status = "STALE";
      this.logAudit({
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        agentId: proposal.targetAgentId,
        action: "stale_detected",
        actor,
        details: { proposalId: proposal.id, currentHash: active.hash, proposalBaseHash: proposal.baseVersionHash },
      });
      return {
        success: false,
        error: `Proposal is STALE: Active prompt was modified since this proposal was drafted. Reconciliation required.`,
      };
    }

    // Mark previous active version archived
    active.status = "archived";
    this.saveVersion(active);

    const nextVerNum = active.version + 1;
    const nextVerId = `v${nextVerNum}`;
    const newContent = proposal.proposedChange.trim();

    const newVersion: AgentPromptVersion = {
      agentId: proposal.targetAgentId,
      version: nextVerNum,
      versionId: nextVerId,
      content: newContent,
      hash: PromptRegistry.hashContent(newContent),
      createdAt: Date.now(),
      author: proposal.author,
      changeDescription: proposal.expectedImprovement || `Applied proposal ${proposal.id}`,
      parentVersionId: active.versionId,
      status: "active",
      activatedAt: Date.now(),
    };

    this.saveVersion(newVersion);
    this.versions.get(proposal.targetAgentId)!.set(nextVerId, newVersion);
    this.activeVersions.set(proposal.targetAgentId, newVersion);

    proposal.status = "APPLIED";
    proposal.updatedAt = Date.now();

    this.logAudit({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      agentId: proposal.targetAgentId,
      action: "applied",
      actor,
      details: {
        proposalId: proposal.id,
        newVersionId: nextVerId,
        parentVersionId: active.versionId,
      },
    });

    return { success: true, version: newVersion };
  }

  /**
   * Safe Rollback: creates a new version pointing back to target content, preserving full history.
   */
  public rollback(
    agentId: string,
    targetVersionId: string,
    reason: string,
    actor: string
  ): { success: boolean; version?: AgentPromptVersion; error?: string } {
    const active = this.getActiveVersion(agentId);
    const target = this.getVersion(agentId, targetVersionId);

    if (!active || !target) {
      return { success: false, error: `Invalid rollback target or active version missing` };
    }

    if (active.versionId === targetVersionId) {
      return { success: false, error: `Cannot rollback to currently active version` };
    }

    active.status = "rolled_back";
    this.saveVersion(active);

    const nextVerNum = active.version + 1;
    const nextVerId = `v${nextVerNum}`;

    const rollbackVersion: AgentPromptVersion = {
      agentId,
      version: nextVerNum,
      versionId: nextVerId,
      content: target.content,
      hash: target.hash,
      createdAt: Date.now(),
      author: actor,
      changeDescription: `Rollback to ${targetVersionId}: ${reason}`,
      parentVersionId: active.versionId,
      status: "active",
      activatedAt: Date.now(),
    };

    this.saveVersion(rollbackVersion);
    this.versions.get(agentId)!.set(nextVerId, rollbackVersion);
    this.activeVersions.set(agentId, rollbackVersion);

    this.logAudit({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      agentId,
      action: "rolled_back",
      actor,
      details: {
        newVersionId: nextVerId,
        rolledBackFrom: active.versionId,
        restoredContentFrom: targetVersionId,
        reason,
      },
    });

    return { success: true, version: rollbackVersion };
  }

  public registerAgent(agentId: string, name: string, role: string, systemPrompt: string): AgentPromptVersion {
    let active = this.activeVersions.get(agentId);
    if (!active) {
      const content = systemPrompt.trim();
      const v1: AgentPromptVersion = {
        agentId,
        version: 1,
        versionId: "v1",
        content,
        hash: PromptRegistry.hashContent(content),
        createdAt: Date.now(),
        author: "system",
        changeDescription: `Initial baseline prompt for ${name} (${role})`,
        parentVersionId: null,
        status: "active",
        activatedAt: Date.now(),
      };
      this.saveVersion(v1);
      if (!this.versions.has(agentId)) {
        this.versions.set(agentId, new Map());
      }
      this.versions.get(agentId)!.set("v1", v1);
      this.activeVersions.set(agentId, v1);
      return v1;
    }
    return active;
  }

  public setAgentPrompt(
    agentId: string,
    newPrompt: string,
    changeDescription: string,
    author: string
  ): AgentPromptVersion {
    const active = this.getActiveVersion(agentId);
    const content = newPrompt.trim();
    if (!active) {
      return this.registerAgent(agentId, agentId, "Agent", newPrompt);
    }

    if (active.content === content) {
      return active;
    }

    active.status = "archived";
    this.saveVersion(active);

    const nextVerNum = active.version + 1;
    const nextVerId = `v${nextVerNum}`;
    const newVersion: AgentPromptVersion = {
      agentId,
      version: nextVerNum,
      versionId: nextVerId,
      content,
      hash: PromptRegistry.hashContent(content),
      createdAt: Date.now(),
      author,
      changeDescription,
      parentVersionId: active.versionId,
      status: "active",
      activatedAt: Date.now(),
    };

    this.saveVersion(newVersion);
    this.versions.get(agentId)!.set(nextVerId, newVersion);
    this.activeVersions.set(agentId, newVersion);

    this.logAudit({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      agentId,
      action: "applied",
      actor: author,
      details: {
        versionId: nextVerId,
        note: changeDescription,
      },
    });

    return newVersion;
  }

  public logAudit(event: PromptAuditEvent): void {
    try {
      fs.appendFileSync(this.auditLogPath, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
      console.warn("[prompt-registry] Failed to append audit log:", err);
    }
  }

  public getAuditHistory(agentId?: string): PromptAuditEvent[] {
    if (!fs.existsSync(this.auditLogPath)) return [];
    try {
      const lines = fs.readFileSync(this.auditLogPath, "utf8").split(/\r?\n/).filter(Boolean);
      const events: PromptAuditEvent[] = lines.map((l) => JSON.parse(l));
      if (agentId) {
        return events.filter((e) => e.agentId === agentId);
      }
      return events.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }
}
