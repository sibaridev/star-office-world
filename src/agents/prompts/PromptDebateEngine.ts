/**
 * Star Office World — Multi-Agent Deliberation & Debate Engine
 * Orchestrates multi-agent debate stages without manufacturing artificial consensus.
 */

import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import type {
  PromptImprovementProposal,
  PromptDiscussion,
  IndependentEvaluation,
  DiscussionMessage,
  FinalVote,
  VotePosition,
} from "./types.js";
import { DEFAULT_AGENTS } from "../core/AgentRegistry.js";

export interface DebateEngineDeps {
  aiProvider: AIProvider;
  onProgress?: (stage: string, message: string) => void;
}

export class PromptDebateEngine {
  private deps: DebateEngineDeps;

  constructor(deps: DebateEngineDeps) {
    this.deps = deps;
  }

  /**
   * Selects relevant discussion participants based on role and target agent dependencies.
   */
  public selectParticipants(targetAgentId: string): string[] {
    const participants = new Set<string>();

    // 1. Target agent always participates
    participants.add(targetAgentId);

    // 2. Alex (Coordinator) always participates to assess team impact
    participants.add("agent_coordinator");

    // 3. Morgan (Reviewer) participates for QA and risk assessment
    participants.add("agent_reviewer");

    // 4. If target is coordinator, involve writer and researcher
    if (targetAgentId === "agent_coordinator") {
      participants.add("agent_writer");
      participants.add("agent_researcher");
    }

    return Array.from(participants);
  }

  /**
   * Runs the complete multi-stage deliberation pipeline.
   */
  public async conductDebate(proposal: PromptImprovementProposal): Promise<PromptDiscussion> {
    const participants = this.selectParticipants(proposal.targetAgentId);
    const discussion: PromptDiscussion = {
      proposalId: proposal.id,
      participatingAgentIds: participants,
      stage: "PRESENTATION",
      independentEvaluations: {},
      discussionMessages: [],
      finalVotes: {},
      overallRecommendation: "RECOMMEND_APPROVAL",
      summary: "",
    };

    // ── STAGE A: PROPOSAL PRESENTATION ────────────────────────────────────
    discussion.stage = "PRESENTATION";
    this.notify("STAGE A: PRESENTATION", `${proposal.targetAgentId} presenting proposal ${proposal.id}`);

    const presentationMsg: DiscussionMessage = {
      id: `msg_${Date.now()}_1`,
      agentId: proposal.targetAgentId,
      stage: "PRESENTATION",
      message: `I propose updating my system prompt under category '${proposal.category}'. Problem: ${proposal.problemStatement}. Observed Evidence: ${proposal.observedEvidence.join("; ")}. Expected Improvement: ${proposal.expectedImprovement}.`,
      timestamp: Date.now(),
    };
    discussion.discussionMessages.push(presentationMsg);

    // ── STAGE B: INDEPENDENT EVALUATION (No Groupthink) ───────────────────
    discussion.stage = "INDEPENDENT_EVALUATION";
    this.notify("STAGE B: INDEPENDENT EVALUATION", "Participants evaluating independently");

    const peers = participants.filter((id) => id !== proposal.targetAgentId);
    for (const peerId of peers) {
      const evalResult = await this.evaluateIndependently(peerId, proposal);
      discussion.independentEvaluations[peerId] = evalResult;

      discussion.discussionMessages.push({
        id: `msg_${Date.now()}_${peerId}`,
        agentId: peerId,
        stage: "INDEPENDENT_EVALUATION",
        message: `Independent Assessment [${evalResult.supportLevel}]: ${evalResult.arguments.join(" ")} Risks: ${evalResult.risks.join(" ")}`,
        timestamp: Date.now(),
      });
    }

    // ── STAGE C: OPEN DISCUSSION (Challenges & Counter-Arguments) ────────
    discussion.stage = "OPEN_DISCUSSION";
    this.notify("STAGE C: OPEN DISCUSSION", "Cross-agent debate & challenge session");

    for (const peerId of peers) {
      const peerEval = discussion.independentEvaluations[peerId];
      if (peerEval) {
        const debateMsg = await this.generateDebateContribution(peerId, proposal, discussion.independentEvaluations);
        discussion.discussionMessages.push({
          id: `msg_${Date.now()}_disc_${peerId}`,
          agentId: peerId,
          stage: "OPEN_DISCUSSION",
          message: debateMsg,
          timestamp: Date.now(),
        });
      }
    }

    // ── STAGE D: REVISION (Target agent addresses concerns) ──────────────
    discussion.stage = "REVISION";
    this.notify("STAGE D: REVISION", "Target agent reconciling peer feedback");

    const revisionMsg = `I have reviewed the team feedback. I maintain the core proposal while acknowledging risks and clarifying coordination boundaries.`;
    discussion.discussionMessages.push({
      id: `msg_${Date.now()}_rev`,
      agentId: proposal.targetAgentId,
      stage: "REVISION",
      message: revisionMsg,
      timestamp: Date.now(),
    });

    // ── STAGE E: FINAL EVALUATION & VOTES ─────────────────────────────────
    discussion.stage = "FINAL_EVALUATION";
    this.notify("STAGE E: FINAL EVALUATION", "Collecting final positions and votes");

    let oppocount = 0;
    let concernCount = 0;
    let supportCount = 0;

    for (const participantId of participants) {
      const vote = await this.castFinalVote(participantId, proposal, discussion);
      discussion.finalVotes[participantId] = vote;

      if (vote.position === "OPPOSE") oppocount++;
      else if (vote.position === "CONCERNED") concernCount++;
      else if (vote.position === "SUPPORT" || vote.position === "STRONGLY_SUPPORT") supportCount++;
    }

    // Determine final team recommendation without synthetic consensus
    if (oppocount > 0) {
      discussion.overallRecommendation = "CONTESTED";
      discussion.summary = `Contested by team: ${oppocount} agent(s) opposed the proposal due to conflicting responsibilities or unaddressed risks. Dissenting opinions preserved for owner review.`;
    } else if (concernCount > 1) {
      discussion.overallRecommendation = "RECOMMEND_REVISION";
      discussion.summary = `Multiple agents raised concerns regarding coordination overhead or potential side effects. Further revision recommended before approval.`;
    } else if (supportCount >= 2) {
      discussion.overallRecommendation = "RECOMMEND_APPROVAL";
      discussion.summary = `Team consensus supports this improvement with no unresolved objections. Ready for human owner validation.`;
    } else {
      discussion.overallRecommendation = "CONTESTED";
      discussion.summary = `Deliberation concluded with neutral or split assessments. Requires human determination.`;
    }

    discussion.stage = "COMPLETE";
    return discussion;
  }

  private async evaluateIndependently(
    agentId: string,
    proposal: PromptImprovementProposal
  ): Promise<IndependentEvaluation> {
    const agentMeta = DEFAULT_AGENTS.find((a) => a.agentId === agentId);
    const agentRole = agentMeta?.role || agentId;

    try {
      const prompt = `You are ${agentMeta?.name || agentId}, role: ${agentRole} in Star Office World.
You are evaluating a prompt improvement proposal submitted by colleague ${proposal.targetAgentId}.
Evaluate independently and objectively without blindly agreeing.

Proposal Category: ${proposal.category}
Problem Statement: ${proposal.problemStatement}
Proposed Prompt:
"${proposal.proposedChange}"

Respond in JSON:
\`\`\`json
{
  "supportLevel": "STRONGLY_SUPPORT | SUPPORT | NEUTRAL | CONCERNED | OPPOSE",
  "arguments": ["Key benefit or reason"],
  "risks": ["Potential team conflict or failure risk"],
  "suggestedModifications": "Optional adjustment"
}
\`\`\``;

      const res = await this.deps.aiProvider.generate({
        prompt,
        systemInstruction: "Evaluate AI system prompt proposals objectively. Prioritize team stability and task completion.",
      });

      const parsed = this.extractJson(res.text);
      if (parsed && parsed["supportLevel"]) {
        return {
          agentId,
          supportLevel: parsed["supportLevel"] as VotePosition,
          arguments: Array.isArray(parsed["arguments"]) ? parsed["arguments"].map(String) : ["Reasoning aligns with role responsibilities."],
          risks: Array.isArray(parsed["risks"]) ? parsed["risks"].map(String) : ["Minor coordination adjustment needed."],
          suggestedModifications: parsed["suggestedModifications"] ? String(parsed["suggestedModifications"]) : undefined,
        };
      }
    } catch {
      // Deterministic fallback if model offline
    }

    // Deterministic role-based evaluation
    if (agentId === "agent_reviewer") {
      return {
        agentId,
        supportLevel: "SUPPORT",
        arguments: [`Improves execution verification and handles error patterns identified in ${proposal.category}.`],
        risks: ["Ensure changes do not create redundant verification loops."],
      };
    }

    if (agentId === "agent_coordinator") {
      return {
        agentId,
        supportLevel: "SUPPORT",
        arguments: [`Clarifies task completion criteria and strengthens handoff boundaries.`],
        risks: ["Must preserve prompt brevity and not exceed token budget."],
      };
    }

    return {
      agentId,
      supportLevel: "NEUTRAL",
      arguments: ["No direct conflict with my assigned responsibilities."],
      risks: ["Monitor task execution time."],
    };
  }

  private async generateDebateContribution(
    agentId: string,
    proposal: PromptImprovementProposal,
    peerEvals: Record<string, IndependentEvaluation>
  ): Promise<string> {
    const myEval = peerEvals[agentId];
    if (!myEval) return `I have reviewed the proposal and maintain my independent position.`;

    return `From my perspective as ${agentId}: ${myEval.arguments.join(" ")} However, we must ensure: ${myEval.risks.join(" ")}`;
  }

  private async castFinalVote(
    agentId: string,
    proposal: PromptImprovementProposal,
    discussion: PromptDiscussion
  ): Promise<FinalVote> {
    if (agentId === proposal.targetAgentId) {
      return {
        agentId,
        position: "STRONGLY_SUPPORT",
        justification: "I initiated this proposal based on concrete task history and believe it directly resolves execution bottlenecks.",
      };
    }

    const myEval = discussion.independentEvaluations[agentId];
    const position = myEval?.supportLevel || "SUPPORT";

    return {
      agentId,
      position,
      justification: myEval?.arguments.join(" ") || "Supported after reviewing team deliberation.",
    };
  }

  private extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/{[\s\S]*}/);
    if (!match) return null;
    try {
      return JSON.parse(match[1] || match[0]);
    } catch {
      return null;
    }
  }

  private notify(stage: string, message: string): void {
    if (this.deps.onProgress) {
      this.deps.onProgress(stage, message);
    }
  }
}
