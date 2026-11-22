/**
 * Star Office World — Prompt Proposal Manager
 * Oversees proposal creation, automated reflection triggers, quality gate validation,
 * debate coordination, and persistent proposal storage.
 */

import fs from "node:fs";
import path from "node:path";
import type { OfficeWorldState } from "../../types.js";
import { addMemo, updateAgentState } from "../../state.js";
import type { SSEManager } from "../../sse.js";
import type { MemoStore } from "../../memo-store.js";
import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import { PromptRegistry } from "./PromptRegistry.js";
import { PromptQualityGate } from "./PromptQualityGate.js";
import { PromptDebateEngine } from "./PromptDebateEngine.js";
import type {
  PromptImprovementProposal,
  ProposalStatus,
  PromptProposalRevision,
} from "./types.js";

export interface ProposalManagerDeps {
  officeState: OfficeWorldState;
  sse: SSEManager;
  memoStore: MemoStore;
  aiProvider: AIProvider;
  dataDir: string;
  promptRegistry: PromptRegistry;
}

export class PromptProposalManager {
  private deps: ProposalManagerDeps;
  private proposalsDir: string;
  private proposals = new Map<string, PromptImprovementProposal>();
  public readonly debateEngine: PromptDebateEngine;

  constructor(deps: ProposalManagerDeps) {
    this.deps = deps;
    this.proposalsDir = path.join(deps.dataDir, "prompts", "proposals");
    fs.mkdirSync(this.proposalsDir, { recursive: true });

    this.debateEngine = new PromptDebateEngine({
      aiProvider: deps.aiProvider,
      onProgress: (stage, message) => {
        deps.sse.broadcast("state", {
          ...deps.officeState,
          promptDebateStatus: { stage, message },
        });
      },
    });

    this.loadProposals();
  }

  private loadProposals(): void {
    if (!fs.existsSync(this.proposalsDir)) return;
    try {
      const files = fs.readdirSync(this.proposalsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.proposalsDir, file), "utf8");
          const prop = JSON.parse(raw) as PromptImprovementProposal;
          this.proposals.set(prop.id, prop);
        } catch {}
      }
    } catch (err) {
      console.warn("[prompt-proposals] Failed to load proposals:", err);
    }
  }

  private saveProposal(prop: PromptImprovementProposal): void {
    try {
      fs.writeFileSync(
        path.join(this.proposalsDir, `${prop.id}.json`),
        JSON.stringify(prop, null, 2),
        "utf8"
      );
    } catch (err) {
      console.warn(`[prompt-proposals] Failed to save proposal ${prop.id}:`, err);
    }
  }

  public getProposal(id: string): PromptImprovementProposal | undefined {
    return this.proposals.get(id);
  }

  public listProposals(filter?: { targetAgentId?: string; status?: ProposalStatus }): PromptImprovementProposal[] {
    let list = Array.from(this.proposals.values());
    if (filter?.targetAgentId) {
      list = list.filter((p) => p.targetAgentId === filter.targetAgentId);
    }
    if (filter?.status) {
      list = list.filter((p) => p.status === filter.status);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Creates an improvement proposal and runs the automated Quality Gate.
   */
  public async createProposal(opts: {
    targetAgentId: string;
    author: string;
    category: PromptImprovementProposal["category"];
    problemStatement: string;
    observedEvidence: string[];
    proposedChange: string;
    expectedImprovement: string;
    potentialRisks?: string;
    priority?: "low" | "medium" | "high";
  }): Promise<PromptImprovementProposal> {
    const activeVersion = this.deps.promptRegistry.getActiveVersion(opts.targetAgentId);
    if (!activeVersion) {
      throw new Error(`Target agent '${opts.targetAgentId}' has no active prompt version`);
    }

    const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const proposal: PromptImprovementProposal = {
      id,
      targetAgentId: opts.targetAgentId,
      baseVersionId: activeVersion.versionId,
      baseVersionHash: activeVersion.hash,
      status: "DRAFT",
      author: opts.author,
      category: opts.category,
      priority: opts.priority || "medium",
      problemStatement: opts.problemStatement,
      observedEvidence: opts.observedEvidence,
      proposedChange: opts.proposedChange.trim(),
      expectedImprovement: opts.expectedImprovement,
      potentialRisks: opts.potentialRisks || "None reported by author",
      rollbackStrategy: `Restore ${activeVersion.versionId} using PromptRegistry.rollback`,
      revisions: [
        {
          revisionNumber: 1,
          proposedContent: opts.proposedChange.trim(),
          summaryOfChanges: "Initial proposal draft",
          createdAt: now,
        },
      ],
      discussion: {
        proposalId: id,
        participatingAgentIds: [],
        stage: "PRESENTATION",
        independentEvaluations: {},
        discussionMessages: [],
        finalVotes: {},
        overallRecommendation: "RECOMMEND_APPROVAL",
        summary: "Deliberation pending",
      },
      createdAt: now,
      updatedAt: now,
    };

    // 1. Run Quality Gate Validation
    const gateResult = PromptQualityGate.validate(proposal, activeVersion);
    proposal.qualityGateResult = gateResult;

    if (!gateResult.passed) {
      proposal.status = "REJECTED_BY_QUALITY_GATE";
      this.proposals.set(id, proposal);
      this.saveProposal(proposal);
      this.deps.promptRegistry.logAudit({
        id: `aud_${Date.now()}`,
        timestamp: Date.now(),
        agentId: opts.targetAgentId,
        action: "quality_gate_failed",
        actor: opts.author,
        details: { proposalId: id, violations: gateResult.violations },
      });
      return proposal;
    }

    this.deps.promptRegistry.logAudit({
      id: `aud_${Date.now()}`,
      timestamp: Date.now(),
      agentId: opts.targetAgentId,
      action: "quality_gate_passed",
      actor: opts.author,
      details: { proposalId: id },
    });

    proposal.status = "DISCUSSING";
    this.proposals.set(id, proposal);
    this.saveProposal(proposal);

    // Announce in Star Office
    const memo = addMemo(
      this.deps.officeState,
      opts.targetAgentId,
      opts.targetAgentId,
      `Drafted system prompt self-improvement proposal: "${opts.problemStatement.slice(0, 80)}..." (Initiating Team Deliberation)`
    );
    try {
      this.deps.memoStore.append(memo);
    } catch {}
    this.deps.sse.broadcast("memo", memo);

    // 2. Launch Team Debate asynchronously
    this.runDebateAsync(proposal);

    return proposal;
  }

  private async runDebateAsync(proposal: PromptImprovementProposal): Promise<void> {
    try {
      updateAgentState(this.deps.officeState, proposal.targetAgentId, "syncing", "Deliberating prompt proposal with team");
      this.deps.sse.broadcast("state", this.deps.officeState);

      const discussion = await this.debateEngine.conductDebate(proposal);
      proposal.discussion = discussion;

      if (discussion.overallRecommendation === "CONTESTED") {
        proposal.status = "CONTESTED";
      } else if (discussion.overallRecommendation === "RECOMMEND_REVISION") {
        proposal.status = "NEEDS_REVISION";
      } else {
        proposal.status = "READY_FOR_REVIEW";
      }

      proposal.updatedAt = Date.now();
      this.saveProposal(proposal);

      const memo = addMemo(
        this.deps.officeState,
        "agent_coordinator",
        "Alex Coordinator",
        `Team debate concluded for proposal ${proposal.id} [${proposal.status}]: ${discussion.summary}`
      );
      try {
        this.deps.memoStore.append(memo);
      } catch {}
      this.deps.sse.broadcast("memo", memo);
      this.deps.sse.broadcast("prompt_proposal_updated", proposal);
    } catch (err) {
      console.error(`[prompt-proposal] Debate error on ${proposal.id}:`, err);
      proposal.status = "CONTESTED";
      this.saveProposal(proposal);
    } finally {
      updateAgentState(this.deps.officeState, proposal.targetAgentId, "idle", "Standing by at workstation");
      this.deps.sse.broadcast("state", this.deps.officeState);
    }
  }

  /**
   * Submits a revised version of the proposed prompt.
   */
  public submitRevision(id: string, newContent: string, changeSummary: string): PromptImprovementProposal | null {
    const prop = this.proposals.get(id);
    if (!prop) return null;

    if (["APPLIED", "REJECTED", "ROLLED_BACK"].includes(prop.status)) {
      throw new Error(`Cannot revise proposal in terminal status '${prop.status}'`);
    }

    const revisionNumber = prop.revisions.length + 1;
    const rev: PromptProposalRevision = {
      revisionNumber,
      proposedContent: newContent.trim(),
      summaryOfChanges: changeSummary,
      createdAt: Date.now(),
    };

    prop.proposedChange = newContent.trim();
    prop.revisions.push(rev);
    prop.status = "READY_FOR_REVIEW";
    prop.updatedAt = Date.now();

    this.saveProposal(prop);
    this.deps.promptRegistry.logAudit({
      id: `aud_${Date.now()}`,
      timestamp: Date.now(),
      agentId: prop.targetAgentId,
      action: "revision_created",
      actor: prop.author,
      details: { proposalId: id, revisionNumber, changeSummary },
    });
    this.deps.sse.broadcast("prompt_proposal_updated", prop);
    return prop;
  }

  /**
   * Human Owner: Approves and applies the proposal.
   */
  public approveAndApply(id: string, actor = "human_owner"): { success: boolean; versionId?: string; error?: string } {
    const prop = this.proposals.get(id);
    if (!prop) {
      return { success: false, error: "Proposal not found" };
    }

    // Security check: Agents cannot approve proposals
    if (actor.startsWith("agent_")) {
      return { success: false, error: "Security Violation: Agents cannot approve prompt proposals. Owner approval required." };
    }

    if (prop.status === "APPLIED") {
      return { success: false, error: "Proposal has already been applied." };
    }

    const result = this.deps.promptRegistry.applyApprovedProposal(prop, actor);
    if (!result.success) {
      this.saveProposal(prop);
      return result;
    }

    this.saveProposal(prop);

    const memo = addMemo(
      this.deps.officeState,
      "agent_coordinator",
      "Owner Governance",
      `Owner approved & applied prompt version ${result.version?.versionId} for agent '${prop.targetAgentId}'.`
    );
    try {
      this.deps.memoStore.append(memo);
    } catch {}
    this.deps.sse.broadcast("memo", memo);
    this.deps.sse.broadcast("prompt_proposal_updated", prop);

    return { success: true, versionId: result.version?.versionId };
  }

  /**
   * Human Owner: Rejects a proposal.
   */
  public rejectProposal(id: string, reason: string, actor = "human_owner"): boolean {
    const prop = this.proposals.get(id);
    if (!prop) return false;

    if (actor.startsWith("agent_")) {
      throw new Error("Security Violation: Agents cannot reject proposals on behalf of the owner.");
    }

    prop.status = "REJECTED";
    prop.updatedAt = Date.now();
    this.saveProposal(prop);

    this.deps.promptRegistry.logAudit({
      id: `aud_${Date.now()}`,
      timestamp: Date.now(),
      agentId: prop.targetAgentId,
      action: "rejected",
      actor,
      details: { proposalId: id, reason },
    });

    this.deps.sse.broadcast("prompt_proposal_updated", prop);
    return true;
  }
}
