/**
 * Star Office World — Prompt Proposal Quality Gate
 * Enforces security invariants, immutability of platform layers, and structural validity.
 */

import type { PromptImprovementProposal, AgentPromptVersion } from "./types.js";

export class PromptQualityGate {
  /**
   * Validates a proposal before it can enter the debate stage or review queue.
   */
  public static validate(
    proposal: PromptImprovementProposal,
    activeVersion: AgentPromptVersion | undefined
  ): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    // 1. Target agent & version checks
    if (!activeVersion) {
      violations.push(`Target agent '${proposal.targetAgentId}' does not have an active prompt version.`);
    }

    if (activeVersion && proposal.baseVersionId !== activeVersion.versionId) {
      violations.push(
        `Proposal base version mismatch: proposal references '${proposal.baseVersionId}', but active version is '${activeVersion.versionId}'.`
      );
    }

    if (activeVersion && proposal.baseVersionHash !== activeVersion.hash) {
      violations.push(
        `Proposal base version is STALE: base hash '${proposal.baseVersionHash.slice(0, 8)}' does not match active version hash '${activeVersion.hash.slice(0, 8)}'.`
      );
    }

    // 2. Proposal content structure checks
    if (!proposal.proposedChange || proposal.proposedChange.trim().length < 15) {
      violations.push("Proposed prompt content is empty or too short (minimum 15 characters).");
    }

    if (!proposal.problemStatement || proposal.problemStatement.trim().length < 10) {
      violations.push("Clear problem statement is required explaining why the existing prompt is insufficient.");
    }

    if (!proposal.observedEvidence || proposal.observedEvidence.length === 0) {
      violations.push("Observed evidence from previous task runs or errors must be cited.");
    }

    if (!proposal.expectedImprovement || proposal.expectedImprovement.trim().length < 10) {
      violations.push("Expected improvement outcome must be specified.");
    }

    // 3. Security Invariants (Immutable Layer 1 checks)
    const lowerProposed = proposal.proposedChange.toLowerCase();

    // Check for attempts to bypass decision protocol or permissions
    const forbiddenPatterns = [
      "ignore previous instructions",
      "ignore platform security",
      "bypass sandbox",
      "override decision format",
      "do not use json",
      "unrestricted access",
      "escalate privileges",
      "sudo",
      "disable verification",
      "self-approve",
    ];

    for (const pat of forbiddenPatterns) {
      if (lowerProposed.includes(pat)) {
        violations.push(`Security Violation: Proposed prompt contains forbidden pattern '${pat}'.`);
      }
    }

    // Agent cannot propose changing its own identifier
    if (lowerProposed.includes("you are no longer") || lowerProposed.includes("change your identity")) {
      violations.push("Security Violation: Proposed prompt attempts to modify core agent identity.");
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}
