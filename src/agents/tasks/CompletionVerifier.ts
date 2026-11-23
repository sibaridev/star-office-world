/**
 * Star Office World — Completion Verifier
 * Prevents false completion, detects natural-language refusals/blockers,
 * and validates acceptance criteria against structured tool execution provenance.
 */

import fs from "node:fs";
import path from "node:path";
import type { OfficeTask, TaskExecutionEvidence, TaskStatus, ToolExecutionProvenance } from "./TaskTypes.js";

export interface VerificationResult {
  canComplete: boolean;
  status: TaskStatus;
  blockReason?: string;
  incompleteRequirements?: string[];
  evidenceFound?: string[];
  verifiedEvidence?: TaskExecutionEvidence[];
}

export class CompletionVerifier {
  private static REFUSAL_PATTERNS = [
    /without\s+(?:access\s+to|direct\s+filesystem\s+access)/i,
    /do\s+not\s+have\s+(?:access\s+to|filesystem\s+access|tools)/i,
    /lacks?\s+(?:access\s+to|tools|filesystem)/i,
    /operating\s+in\s+an\s+environment\s+without/i,
    /cannot\s+access/i,
    /unable\s+to\s+(?:directly\s+)?(?:write|create|modify|edit|access|inspect|run)/i,
    /not\s+available\s+in\s+this\s+environment/i,
    /tools?\s+(?:are\s+)?not\s+available/i,
    /no\s+(?:filesystem|file-writing|write)\s+tools?/i,
    /run\s+(?:these|the\s+following)\s+commands\s+manually/i,
    /please\s+(?:run|execute)\s+(?:git|manual)/i,
    /paste\s+relevant\s+directory\s+trees/i,
    /unable\s+to\s+inspect/i,
    /set-content\s+-path/i,
    /echo\s+.*>/i,
    /run:\s*```(?:powershell|bash|sh|cmd)?/i,
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

    // 2. Failed Tool Executions Gate
    const failedExecutions = provenance.filter((p) => p.status === "FAILED");
    if (failedExecutions.length > 0) {
      const lastFailed = failedExecutions[failedExecutions.length - 1];
      return {
        canComplete: false,
        status: "FAILED",
        blockReason: `Execution Failure: Tool '${lastFailed.tool}' failed with error: ${lastFailed.error || "Unknown failure"}`,
      };
    }

    const completedToolExecutions = provenance.filter((p) => p.status === "COMPLETED");

    // 3. Required Tools Enforcement
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

    // 4. Inspection / Audit Task Integrity Enforcement
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

    // 5. File Creation / Modification Task Integrity Enforcement with Read-Back Verification
    const isModificationTask =
      /\b(?:create|write|edit|modify|update|add|append|delete|refactor|build)\b/i.test(task.title) &&
      /\b(?:file|document|script|code|project|test\.md|hello\.txt|readme|component)\b/i.test(combinedText);

    const verifiedEvidence: TaskExecutionEvidence[] = [];

    // Verify completed write or edit operations by reading files back from disk
    const modificationExecutions = completedToolExecutions.filter(
      (p) => p.tool === "workspace_write_file" || p.tool === "workspace_edit_file"
    );

    // Group modifications by resolved file path so we verify the final/latest modification state
    const latestModificationsByFile = new Map<string, { resolvedPath: string; modExec: ToolExecutionProvenance }>();
    for (const modExec of modificationExecutions) {
      const targetPath = (modExec.inputParameters?.["filePath"] as string) || "";
      if (targetPath) {
        let resolvedPath = path.normalize(targetPath);
        if (!path.isAbsolute(resolvedPath) && task.workspacePath) {
          resolvedPath = path.normalize(path.resolve(task.workspacePath, targetPath));
        }
        latestModificationsByFile.set(resolvedPath.toLowerCase(), { resolvedPath, modExec });
      }
    }

    for (const { resolvedPath, modExec } of latestModificationsByFile.values()) {
      if (!fs.existsSync(resolvedPath)) {
        return {
          canComplete: false,
          status: "FAILED",
          blockReason: `Verification Failure: Target file '${resolvedPath}' does not exist on disk after modification operation.`,
        };
      }

      try {
        const readBack = fs.readFileSync(resolvedPath, "utf8");
        const expectedContent =
          (modExec.inputParameters?.["content"] as string) ||
          (modExec.inputParameters?.["replacement"] as string) ||
          "";

        const normalizedReadBack = readBack.replace(/\r\n/g, "\n");
        const normalizedExpected = expectedContent.trim().replace(/\r\n/g, "\n");

        const matches =
          !expectedContent ||
          normalizedReadBack === normalizedExpected ||
          normalizedReadBack.includes(normalizedExpected);

        if (!matches) {
          return {
            canComplete: false,
            status: "FAILED",
            blockReason: `Verification Failure: Read-back content does not match expected modification for '${resolvedPath}'.`,
          };
        }

        verifiedEvidence.push({
          tool: modExec.tool,
          operation: modExec.tool,
          targetPath: resolvedPath,
          result: `Verified on disk (${readBack.length} bytes)`,
          verificationStatus: "VERIFIED",
          verifiedAt: Date.now(),
          readBackContent: readBack,
        });
      } catch (err: unknown) {
        return {
          canComplete: false,
          status: "FAILED",
          blockReason: `Verification Read Error: Could not read back modified file '${resolvedPath}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Add command execution evidence if present
    const cmdExecutions = completedToolExecutions.filter((p) => p.tool === "workspace_execute_command");
    for (const cmdExec of cmdExecutions) {
      verifiedEvidence.push({
        tool: cmdExec.tool,
        operation: "workspace_execute_command",
        targetPath: String(cmdExec.inputParameters?.["command"] || ""),
        result: `Command executed: ${cmdExec.output?.slice(0, 80) || "Code 0"}`,
        verificationStatus: "VERIFIED",
        verifiedAt: Date.now(),
      });
    }

    if (isModificationTask && modificationExecutions.length === 0 && completedToolExecutions.length === 0) {
      return {
        canComplete: false,
        status: "BLOCKED",
        blockReason:
          "Execution Integrity Failure: Task requires creating or modifying project files, but 0 modification tools (workspace_write_file, workspace_edit_file) were successfully executed.",
      };
    }

    if (isModificationTask && modificationExecutions.length > 0 && verifiedEvidence.length === 0) {
      return {
        canComplete: false,
        status: "FAILED",
        blockReason:
          "Execution Integrity Failure: File modification could not be verified on disk.",
      };
    }

    // 6. Acceptance Criteria Verification
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
      verifiedEvidence: verifiedEvidence.length > 0 ? verifiedEvidence : undefined,
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

