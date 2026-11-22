/**
 * Star Office World — Agent System Prompt Governance & Versioning Types
 */

export type PromptLayer = "platform" | "team" | "role" | "agent" | "runtime";

export interface AgentPromptVersion {
  agentId: string;
  version: number;
  versionId: string; // e.g. "v1", "v2"
  content: string; // Editable Layer 4 agent system prompt
  hash: string; // SHA-256 of content
  createdAt: number;
  author: string; // "system" | "human" | agentId
  changeDescription: string;
  parentVersionId: string | null;
  status: "active" | "archived" | "rolled_back";
  activatedAt: number | null;
}

export interface EffectiveSystemPrompt {
  agentId: string;
  version: number;
  versionId: string;
  platformInstructions: string; // Immutable Layer 1
  teamInstructions: string; // Layer 2
  roleInstructions: string; // Layer 3
  agentPrompt: string; // Editable Layer 4
  assembledPrompt: string; // Complete prompt provided to AI Provider
}

export type ProposalStatus =
  | "DRAFT"
  | "ANALYZING"
  | "DISCUSSING"
  | "REVISING"
  | "READY_FOR_REVIEW"
  | "NEEDS_REVISION"
  | "CONTESTED"
  | "REJECTED_BY_QUALITY_GATE"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "APPLIED"
  | "ROLLED_BACK";

export type VotePosition = "STRONGLY_SUPPORT" | "SUPPORT" | "NEUTRAL" | "CONCERNED" | "OPPOSE";

export interface PromptProposalRevision {
  revisionNumber: number;
  proposedContent: string;
  summaryOfChanges: string;
  createdAt: number;
}

export interface IndependentEvaluation {
  agentId: string;
  supportLevel: VotePosition;
  arguments: string[];
  risks: string[];
  suggestedModifications?: string;
}

export interface DiscussionMessage {
  id: string;
  agentId: string;
  stage: string;
  message: string;
  timestamp: number;
}

export interface FinalVote {
  agentId: string;
  position: VotePosition;
  justification: string;
}

export interface PromptDiscussion {
  proposalId: string;
  participatingAgentIds: string[];
  stage: "PRESENTATION" | "INDEPENDENT_EVALUATION" | "OPEN_DISCUSSION" | "REVISION" | "FINAL_EVALUATION" | "COMPLETE";
  independentEvaluations: Record<string, IndependentEvaluation>;
  discussionMessages: DiscussionMessage[];
  finalVotes: Record<string, FinalVote>;
  overallRecommendation: "RECOMMEND_APPROVAL" | "RECOMMEND_REVISION" | "RECOMMEND_REJECTION" | "CONTESTED";
  summary: string;
}

export interface PromptImprovementProposal {
  id: string; // "prop_..."
  targetAgentId: string;
  baseVersionId: string;
  baseVersionHash: string;
  status: ProposalStatus;
  author: string;
  category: "error_recovery" | "efficiency" | "delegation" | "clarity" | "collaboration";
  priority: "low" | "medium" | "high";
  problemStatement: string;
  observedEvidence: string[];
  proposedChange: string; // Proposed Layer 4 content
  expectedImprovement: string;
  potentialRisks: string;
  rollbackStrategy: string;
  revisions: PromptProposalRevision[];
  discussion: PromptDiscussion;
  qualityGateResult?: {
    passed: boolean;
    violations: string[];
  };
  createdAt: number;
  updatedAt: number;
}

export interface WordDiffChunk {
  type: "added" | "deleted" | "unchanged";
  text: string;
}

export interface LineDiffChunk {
  type: "added" | "deleted" | "unchanged" | "modified";
  oldLine?: string;
  newLine?: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  words?: WordDiffChunk[];
}

export interface PromptDiffResult {
  oldContent: string;
  newContent: string;
  lines: LineDiffChunk[];
  stats: {
    addedLines: number;
    deletedLines: number;
    modifiedLines: number;
    unchangedLines: number;
  };
}

export interface PromptAuditEvent {
  id: string;
  timestamp: number;
  agentId: string;
  action:
    | "proposal_created"
    | "debate_started"
    | "stage_advanced"
    | "revision_created"
    | "quality_gate_passed"
    | "quality_gate_failed"
    | "approved"
    | "rejected"
    | "applied"
    | "rolled_back"
    | "stale_detected";
  actor: string;
  details: Record<string, unknown>;
}
