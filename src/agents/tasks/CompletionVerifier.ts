/**
 * Star Office World — Completion Verifier
 * Prevents false completion, detects natural-language refusals/blockers,
 * and validates acceptance criteria against structured tool execution provenance.
 */

import type { OfficeTask, TaskStatus, ToolExecutionProvenance } from "./TaskTypes.js";

export interface VerificationResult {
  canComplete: boolean;
  status: TaskStatus;
  blockReason?: string;
  incompleteRequirements?: string[];
  evidenceFound?: string[];
}

export class CompletionVerifier {
  private static REFUSAL_PATTERNS = [
    /without\s+(?:access\s+to|direct\s+filesystem\s+access)/i,
    /do\s+not\s+have\s+(?:access\s+to|filesystem\s+access|tools)/i,
    /lacks?\s+(?:access\s+to|tools|filesystem)/i,
    /operating\s+in\s+an\s+environment\s+without/i,
    /cannot\s+access/i,
    /run\s+(?:these|the\s+following)\s+commands\s+manually/i,
    /please\s+(?:run|execute)\s+(?:git|manual)/i,
    /paste\s+relevant\s+directory\s+trees/i,
    /unable\s+to\s+inspect/i,
  ];

  /**
   * Evaluates proposed completion output and execution provenance against task requirements.
   */
  public static verifyCompletion(
    task: OfficeTask,
    proposedResult: string,
    provenance: ToolExecutionProvenance[] = []
  ): VerificationResult {
    // 1. Refusal & Missing Capability Detection
    for (const pattern of this.REFUSAL_PATTERNS) {
      if (pattern.test(proposedResult)) {
        return {
          canComplete: false,
          status: "BLOCKED",
          blockReason: `Agent reported lack of capability or missing tools in output response: "${proposedResult.slice(0, 160)}..."`,
        };
      }
    }

    const completedToolExecutions = provenance.filter((p) => p.status === "COMPLETED");

    // 2. Required Tools Enforcement
    if (task.requiredTools && task.requiredTools.length > 0) {
      const executedTools = new Set(completedToolExecutions.map((p) => p.tool));
      const missing = task.requiredTools.filter((t) => !executedTools.has(t));
      if (missing.length > 0) {
        return {
          canComplete: false,
          status: "BLOCKED",
          blockReason: `Mandatory tool execution missing. Expected tools [${task.requiredTools.join(", ")}] but [${missing.join(", ")}] were never executed.`,
          incompleteRequirements: missing.map((t) => `Execute tool '${t}'`),
        };
      }
    }

    // 3. Inspection / Audit Task Integrity Enforcement
    const combinedText = `${task.title} ${task.description}`;
    const isInspectionTask =
      /\b(?:audit|inspect|inspection|verify|verification|check|status)\b/i.test(combinedText) &&
      /\b(?:workspace|repository|git|branch|files|codebase)\b/i.test(combinedText);

    if (isInspectionTask && completedToolExecutions.length === 0) {
      return {
        canComplete: false,
        status: "BLOCKED",
        blockReason:
          "Execution Integrity Failure: Task requires real workspace or git inspection evidence, but 0 tools were successfully executed.",
      };
    }

    // 3b. File Creation / Modification Task Integrity Enforcement
    const isModificationTask =
      /\b(?:create|write|edit|modify|update|add|append|delete|refactor|build)\b/i.test(task.title) &&
      /\b(?:file|document|script|code|project|test\.md|readme|component)\b/i.test(combinedText);

    if (isModificationTask && completedToolExecutions.length === 0) {
      return {
        canComplete: false,
        status: "BLOCKED",
        blockReason:
          "Execution Integrity Failure: Task requires creating or modifying project files, but 0 modification tools (e.g. workspace_write_file, delegate_to_antigravity) were successfully executed.",
      };
    }

    // 4. Acceptance Criteria Verification
    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      const incomplete: string[] = [];
      const evidence: string[] = [];

      for (const criterion of task.acceptanceCriteria) {
        const criterionLower = criterion.toLowerCase();
        const keywords = criterionLower
          .split(/[^a-z0-9_-]+/)
          .filter((w) => w.length >= 3 && !["inspect", "verify", "check", "perform", "with", "from", "that"].includes(w));

        // Check if evidence exists in completed tool executions (tool name + output) or proposed result
        const hasEvidence =
          completedToolExecutions.some((p) => {
            const toolAndOutput = `${p.tool} ${p.output || ""}`.toLowerCase();
            return (
              toolAndOutput.includes(criterionLower) ||
              (keywords.length > 0 && keywords.every((kw) => toolAndOutput.includes(kw)))
            );
          }) ||
          proposedResult.toLowerCase().includes(criterionLower) ||
          (keywords.length > 0 && keywords.every((kw) => proposedResult.toLowerCase().includes(kw)));

        if (hasEvidence) {
          evidence.push(criterion);
        } else {
          incomplete.push(criterion);
        }
      }

      if (incomplete.length > 0 && evidence.length === 0) {
        return {
          canComplete: false,
          status: "BLOCKED",
          blockReason: `None of the mandatory acceptance criteria were verified. Missing: ${incomplete.join("; ")}`,
          incompleteRequirements: incomplete,
        };
      }

      if (incomplete.length > 0 && evidence.length > 0) {
        return {
          canComplete: false,
          status: "PARTIALLY_COMPLETED",
          blockReason: `Partial progress: ${evidence.length} criteria verified, but ${incomplete.length} remain unmet.`,
          incompleteRequirements: incomplete,
          evidenceFound: evidence,
        };
      }
    }

    return {
      canComplete: true,
      status: "COMPLETED",
    };
  }

  /**
   * Parent validates child results before accepting delegation outcome.
   */
  public static validateChildDelegationResult(
    childTask: OfficeTask,
    provenance: ToolExecutionProvenance[] = []
  ): { valid: boolean; propagatedStatus: TaskStatus; explanation: string } {
    if (childTask.status === "BLOCKED" || childTask.status === "FAILED") {
      return {
        valid: false,
        propagatedStatus: childTask.status,
        explanation: childTask.blockReason || childTask.error || "Child task reported failure/blocker",
      };
    }

    if (childTask.status === "PARTIALLY_COMPLETED") {
      return {
        valid: false,
        propagatedStatus: "PARTIALLY_COMPLETED",
        explanation: `Child task partially completed: ${childTask.incompleteRequirements?.join(", ") || "Unmet criteria"}`,
      };
    }

    // Verify child didn't claim completion falsely
    const verify = this.verifyCompletion(childTask, childTask.result || "", provenance);
    if (!verify.canComplete) {
      return {
        valid: false,
        propagatedStatus: verify.status,
        explanation: verify.blockReason || "Child task completion claim lacked verified evidence.",
      };
    }

    return {
      valid: true,
      propagatedStatus: "COMPLETED",
      explanation: "Child task verified with real execution evidence.",
    };
  }
}

