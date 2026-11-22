/**
 * Star Office World — Prompt Diff Engine
 * Produces accurate line-by-line and word-level diffs with visual highlighting metadata.
 */

import type { LineDiffChunk, PromptDiffResult, WordDiffChunk } from "./types.js";

export class PromptDiffEngine {
  /**
   * Generates line and word level diff between original and proposed prompts.
   */
  public static computeDiff(oldText: string, newText: string): PromptDiffResult {
    const oldLines = oldText.split(/\r?\n/);
    const newLines = newText.split(/\r?\n/);

    const lines: LineDiffChunk[] = [];
    let addedCount = 0;
    let deletedCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;

    let i = 0;
    let j = 0;
    let oldNum = 1;
    let newNum = 1;

    while (i < oldLines.length || j < newLines.length) {
      const oldLine = i < oldLines.length ? oldLines[i] : null;
      const newLine = j < newLines.length ? newLines[j] : null;

      if (oldLine !== null && newLine !== null && oldLine === newLine) {
        // Unchanged
        lines.push({
          type: "unchanged",
          oldLine,
          newLine,
          oldLineNumber: oldNum++,
          newLineNumber: newNum++,
          words: [{ type: "unchanged", text: oldLine }],
        });
        unchangedCount++;
        i++;
        j++;
      } else if (oldLine !== null && newLine !== null && this.isLineModified(oldLine, newLine)) {
        // Modified line
        const words = this.computeWordDiff(oldLine, newLine);
        lines.push({
          type: "modified",
          oldLine,
          newLine,
          oldLineNumber: oldNum++,
          newLineNumber: newNum++,
          words,
        });
        modifiedCount++;
        i++;
        j++;
      } else if (oldLine !== null && (newLine === null || !newLines.slice(j).includes(oldLine))) {
        // Deleted line
        lines.push({
          type: "deleted",
          oldLine,
          oldLineNumber: oldNum++,
          words: [{ type: "deleted", text: oldLine }],
        });
        deletedCount++;
        i++;
      } else if (newLine !== null) {
        // Added line
        lines.push({
          type: "added",
          newLine,
          newLineNumber: newNum++,
          words: [{ type: "added", text: newLine }],
        });
        addedCount++;
        j++;
      } else {
        break;
      }
    }

    return {
      oldContent: oldText,
      newContent: newText,
      lines,
      stats: {
        addedLines: addedCount,
        deletedLines: deletedCount,
        modifiedLines: modifiedCount,
        unchangedLines: unchangedCount,
      },
    };
  }

  /**
   * Determines if two lines are edits of each other (similarity threshold)
   */
  private static isLineModified(l1: string, l2: string): boolean {
    if (l1 === l2) return false;
    const len = Math.max(l1.length, l2.length);
    if (len === 0) return false;
    const dist = this.levenshtein(l1, l2);
    // If more than 35% similar, treat as a modified line
    return (1 - dist / len) > 0.35;
  }

  /**
   * Computes word-level diff for modified lines.
   */
  private static computeWordDiff(w1: string, w2: string): WordDiffChunk[] {
    const tokens1 = w1.split(/(\s+|[^\w\s])/);
    const tokens2 = w2.split(/(\s+|[^\w\s])/);

    const chunks: WordDiffChunk[] = [];
    let i = 0;
    let j = 0;

    while (i < tokens1.length || j < tokens2.length) {
      const t1 = i < tokens1.length ? tokens1[i] : null;
      const t2 = j < tokens2.length ? tokens2[j] : null;

      if (t1 !== null && t2 !== null && t1 === t2) {
        chunks.push({ type: "unchanged", text: t1 });
        i++;
        j++;
      } else if (t1 !== null && (t2 === null || !tokens2.slice(j, j + 4).includes(t1))) {
        chunks.push({ type: "deleted", text: t1 });
        i++;
      } else if (t2 !== null) {
        chunks.push({ type: "added", text: t2 });
        j++;
      } else {
        break;
      }
    }

    return chunks;
  }

  private static levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }
}
