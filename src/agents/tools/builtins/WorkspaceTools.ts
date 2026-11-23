/**
 * Star Office World — Sandboxed Workspace Tools
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolExecutionContext } from "../ToolTypes.js";

function resolveSafePath(context: ToolExecutionContext, targetPath: string): string {
  const normTarget = path.normalize(targetPath);

  // 1. If absolute path or drive letter:
  if (path.isAbsolute(normTarget) || /^[a-zA-Z]:[\\/]/.test(normTarget)) {
    const absPath = path.resolve(normTarget);
    const absLower = absPath.toLowerCase();

    // Check context.workspaceDir or context.workspacePath
    const activeDir = path.normalize(path.resolve(context.workspacePath || context.workspaceDir)).toLowerCase();
    if (absLower === activeDir || absLower.startsWith(activeDir + path.sep)) {
      return absPath;
    }

    // Check all authorized workspaces in antigravityBridge.workspaces
    if (context.antigravityBridge?.workspaces?.isAuthorizedPath) {
      if (context.antigravityBridge.workspaces.isAuthorizedPath("", absPath)) {
        return absPath;
      }
    }

    throw new Error(`Security Violation: Path traversal or unauthorized path: '${targetPath}' escapes authorized boundaries.`);
  }

  // 2. Relative path: resolve against context.workspacePath or context.workspaceDir
  const baseDir = path.resolve(context.workspacePath || context.workspaceDir);
  const resolved = path.resolve(baseDir, normTarget);
  const normBase = path.normalize(baseDir).toLowerCase();
  const normResolved = path.normalize(resolved).toLowerCase();

  // If path tries to escape via '..' outside baseDir
  if (normResolved !== normBase && !normResolved.startsWith(normBase + path.sep)) {
    throw new Error(`Security Violation: Path traversal outside workspace boundary is forbidden (${targetPath}).`);
  }

  return resolved;
}

export const workspaceWriteFileTool: ToolDefinition = {
  name: "workspace_write_file",
  description: "Write or create a file safely within an authorized workspace directory. Automatically verifies write by reading back content.",
  riskLevel: "low",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative or authorized absolute path (e.g., reports/summary.txt or C:\\Users\\...)",
      required: true,
    },
    content: {
      type: "string",
      description: "Text content to write into the file",
      required: true,
    },
  },
  async execute(args, context) {
    const filePath = String(args["filePath"] ?? "");
    const content = String(args["content"] ?? "");

    if (!filePath) {
      return { success: false, output: "", error: "filePath is required." };
    }

    try {
      const fullPath = resolveSafePath(context, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");

      // Verify write by reading the file back
      const readBack = fs.readFileSync(fullPath, "utf8");
      if (readBack !== content) {
        return {
          success: false,
          output: "",
          error: `Verification Failure: Read-back content does not match expected write for '${fullPath}'.`,
        };
      }

      return {
        success: true,
        output: `File successfully written and verified at ${fullPath} (${content.length} characters). Content: "${content.slice(0, 80)}"`,
        data: {
          filePath,
          absolutePath: fullPath,
          bytesWritten: Buffer.byteLength(content, "utf8"),
          verified: true,
          readBackMatches: true,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const workspaceReadFileTool: ToolDefinition = {
  name: "workspace_read_file",
  description: "Read the contents of a file inside an authorized workspace directory.",
  riskLevel: "low",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative or authorized absolute path inside workspace",
      required: true,
    },
  },
  async execute(args, context) {
    const filePath = String(args["filePath"] ?? "");
    if (!filePath) {
      return { success: false, output: "", error: "filePath is required." };
    }

    try {
      const fullPath = resolveSafePath(context, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: "", error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(fullPath, "utf8");
      return {
        success: true,
        output: content,
        data: { filePath, absolutePath: fullPath, length: content.length },
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const workspaceListFilesTool: ToolDefinition = {
  name: "workspace_list_files",
  description: "List files and subdirectories inside an authorized workspace directory.",
  riskLevel: "low",
  parameters: {
    directory: {
      type: "string",
      description: "Relative directory or authorized absolute directory to list (leave empty for workspace root)",
      required: false,
    },
  },
  async execute(args, context) {
    const subDir = String(args["directory"] ?? "");
    try {
      const targetDir = resolveSafePath(context, subDir || ".");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const files = fs.readdirSync(targetDir);
      return {
        success: true,
        output: files.length > 0 ? files.join("\n") : "(empty directory)",
        data: { directory: subDir, absolutePath: targetDir, files },
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
