/**
 * Star Office World — Sandboxed Workspace Tools
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../ToolTypes.js";

function resolveSafePath(workspaceDir: string, relativePath: string): string {
  // Normalize and resolve against workspace directory
  const resolved = path.resolve(workspaceDir, relativePath);
  const normalizedWorkspace = path.resolve(workspaceDir);

  // Security check: path traversal prevention
  if (!resolved.startsWith(normalizedWorkspace)) {
    throw new Error(`Security Violation: Path traversal outside workspace boundary is forbidden (${relativePath}).`);
  }
  return resolved;
}

export const workspaceWriteFileTool: ToolDefinition = {
  name: "workspace_write_file",
  description: "Write or create a file safely within the agent workspace directory.",
  riskLevel: "low",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative path inside workspace (e.g., reports/summary.txt)",
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
      const fullPath = resolveSafePath(context.workspaceDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      return {
        success: true,
        output: `File successfully written to ${filePath} (${content.length} characters).`,
        data: { filePath, bytesWritten: Buffer.byteLength(content, "utf8") },
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
  description: "Read the contents of a file inside the agent workspace directory.",
  riskLevel: "low",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative path inside workspace (e.g., reports/summary.txt)",
      required: true,
    },
  },
  async execute(args, context) {
    const filePath = String(args["filePath"] ?? "");
    if (!filePath) {
      return { success: false, output: "", error: "filePath is required." };
    }

    try {
      const fullPath = resolveSafePath(context.workspaceDir, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: "", error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(fullPath, "utf8");
      return {
        success: true,
        output: content,
        data: { filePath, length: content.length },
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
  description: "List files and subdirectories inside the local Star Office agent file sandbox. IMPORTANT: This only accesses the local scratch directory; an empty directory does NOT indicate Antigravity status or task completion. To check or use Antigravity, call check_antigravity_bridge or delegate_to_antigravity.",
  riskLevel: "low",
  parameters: {
    directory: {
      type: "string",
      description: "Relative directory to list (leave empty for workspace root)",
      required: false,
    },
  },
  async execute(args, context) {
    const subDir = String(args["directory"] ?? "");
    try {
      const targetDir = resolveSafePath(context.workspaceDir, subDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const files = fs.readdirSync(targetDir);
      return {
        success: true,
        output: files.length > 0 ? files.join("\n") : "(empty directory)",
        data: { directory: subDir, files },
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
