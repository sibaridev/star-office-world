/**
 * Star Office World — Sandboxed Workspace Tools
 */

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
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

export const workspaceEditFileTool: ToolDefinition = {
  name: "workspace_edit_file",
  description: "Perform surgical find-and-replace edit on an existing file in an authorized workspace with automatic verification and instant rollback on failure.",
  riskLevel: "medium",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative or authorized absolute path to the file to edit",
      required: true,
    },
    target: {
      type: "string",
      description: "Exact character sequence to find and replace (must match existing file content)",
      required: true,
    },
    replacement: {
      type: "string",
      description: "New replacement character sequence",
      required: true,
    },
  },
  async execute(args, context) {
    const filePath = String(args["filePath"] ?? "");
    const target = String(args["target"] ?? "");
    const replacement = String(args["replacement"] ?? "");

    if (!filePath || target === undefined || replacement === undefined) {
      return { success: false, output: "", error: "filePath, target, and replacement are required." };
    }

    try {
      const fullPath = resolveSafePath(context, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: "", error: `Target file not found for editing: '${filePath}'` };
      }

      const originalContent = fs.readFileSync(fullPath, "utf8");

      let effectiveTarget = target;
      let effectiveReplacement = replacement;

      if (!originalContent.includes(target)) {
        // Try CRLF / LF normalization to match the file's line ending format
        const usesCRLF = originalContent.includes("\r\n");
        const targetNormalized = usesCRLF
          ? target.replace(/(?<!\r)\n/g, "\r\n")
          : target.replace(/\r\n/g, "\n");
        const replacementNormalized = usesCRLF
          ? replacement.replace(/(?<!\r)\n/g, "\r\n")
          : replacement.replace(/\r\n/g, "\n");

        if (originalContent.includes(targetNormalized)) {
          effectiveTarget = targetNormalized;
          effectiveReplacement = replacementNormalized;
        } else {
          return {
            success: false,
            output: "",
            error: `Target string not found in '${filePath}'. Target: "${target.slice(0, 100)}..."`,
          };
        }
      }

      // Perform replacement
      const modifiedContent = originalContent.replace(effectiveTarget, effectiveReplacement);

      // Write modified content to disk
      fs.writeFileSync(fullPath, modifiedContent, "utf8");

      // Verify read-back immediately
      const readBack = fs.readFileSync(fullPath, "utf8");
      if (readBack !== modifiedContent) {
        // Rollback to original content
        fs.writeFileSync(fullPath, originalContent, "utf8");
        return {
          success: false,
          output: "",
          error: `Verification Failure: Read-back mismatch after editing '${filePath}'. Reverted to original content.`,
        };
      }

      // Assert that replacement is now in readBack
      if (!readBack.includes(effectiveReplacement)) {
        fs.writeFileSync(fullPath, originalContent, "utf8");
        return {
          success: false,
          output: "",
          error: `Verification Failure: Replacement not present in read-back. Reverted to original content.`,
        };
      }

      return {
        success: true,
        output: `File successfully edited and verified on disk at ${fullPath}. Bytes before: ${originalContent.length}, bytes after: ${readBack.length}. Target replaced with replacement.`,
        data: {
          filePath,
          absolutePath: fullPath,
          target,
          replacement,
          bytesBefore: originalContent.length,
          bytesAfter: readBack.length,
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

export const workspaceExecuteCommandTool: ToolDefinition = {
  name: "workspace_execute_command",
  description: "Execute a project build, test, lint, or inspection command inside an authorized workspace directory and capture stdout, stderr, and exitCode.",
  riskLevel: "medium",
  parameters: {
    command: {
      type: "string",
      description: "Shell command to execute (e.g., 'npm.cmd test', 'npx.cmd tsx --test tests/uploadQuotaHandling.test.ts', 'python script.py')",
      required: true,
    },
    cwd: {
      type: "string",
      description: "Optional working directory relative to or within the authorized workspace",
      required: false,
    },
    timeoutMs: {
      type: "number",
      description: "Optional timeout in milliseconds (default: 60000)",
      required: false,
    },
  },
  async execute(args, context) {
    const rawCmd = String(args["command"] ?? "").trim();
    if (!rawCmd) {
      return { success: false, output: "", error: "command is required." };
    }

    const requestedCwd = args["cwd"] ? String(args["cwd"]) : "";
    let targetCwd: string;

    try {
      targetCwd = requestedCwd ? resolveSafePath(context, requestedCwd) : path.resolve(context.workspacePath || context.workspaceDir);
    } catch (err) {
      return { success: false, output: "", error: `Invalid cwd: ${err instanceof Error ? err.message : String(err)}` };
    }

    const timeout = typeof args["timeoutMs"] === "number" ? args["timeoutMs"] : 60000;

    return new Promise((resolve) => {
      const startTime = Date.now();
      exec(
        rawCmd,
        {
          cwd: targetCwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const outStr = stdout ? stdout.toString() : "";
          const errStr = stderr ? stderr.toString() : "";
          const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;

          if (exitCode === 0) {
            resolve({
              success: true,
              output: outStr || `Command finished with exit code 0 (${durationMs}ms)`,
              data: {
                command: rawCmd,
                cwd: targetCwd,
                exitCode: 0,
                stdout: outStr,
                stderr: errStr,
                durationMs,
              },
            });
          } else {
            resolve({
              success: false,
              output: outStr,
              error: errStr || `Command failed with exit code ${exitCode}: ${error?.message || ""}`,
              data: {
                command: rawCmd,
                cwd: targetCwd,
                exitCode,
                stdout: outStr,
                stderr: errStr,
                durationMs,
              },
            });
          }
        }
      );
    });
  },
};

export const workspaceDeleteFileTool: ToolDefinition = {
  name: "workspace_delete_file",
  description: "Delete a file inside an authorized workspace when explicitly confirmed.",
  riskLevel: "high",
  parameters: {
    filePath: {
      type: "string",
      description: "Relative or authorized absolute path to the file to delete",
      required: true,
    },
    confirmAuthorized: {
      type: "boolean",
      description: "Must be true to authorize deletion",
      required: true,
    },
  },
  async execute(args, context) {
    const filePath = String(args["filePath"] ?? "");
    const confirm = args["confirmAuthorized"] === true;

    if (!filePath) {
      return { success: false, output: "", error: "filePath is required." };
    }
    if (!confirm) {
      return { success: false, output: "", error: "Deletion rejected: confirmAuthorized must be true." };
    }

    try {
      const fullPath = resolveSafePath(context, filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: "", error: `File not found: '${filePath}'` };
      }

      fs.unlinkSync(fullPath);
      if (fs.existsSync(fullPath)) {
        return { success: false, output: "", error: `File deletion verification failed: '${fullPath}' still exists.` };
      }

      return {
        success: true,
        output: `File successfully deleted and verified removed from disk: ${fullPath}`,
        data: { filePath, absolutePath: fullPath, deleted: true },
      };
    } catch (err: unknown) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const workspaceDiscoverProjectTool: ToolDefinition = {
  name: "workspace_discover_project",
  description: "Inspect workspace to automatically discover project type (Next.js, React, Node, TypeScript, Python, etc.), package manager, scripts, and conventions.",
  riskLevel: "low",
  parameters: {
    directory: {
      type: "string",
      description: "Optional relative or authorized absolute directory to discover (defaults to workspace root)",
      required: false,
    },
  },
  async execute(args, context) {
    try {
      const targetDir = args["directory"]
        ? resolveSafePath(context, String(args["directory"]))
        : path.resolve(context.workspacePath || context.workspaceDir);

      const items = fs.readdirSync(targetDir);
      const hasPackageJson = items.includes("package.json");
      const hasTsConfig = items.includes("tsconfig.json");
      const hasPyproject = items.includes("pyproject.toml") || items.includes("setup.py") || items.includes("requirements.txt");
      const hasCargo = items.includes("Cargo.toml");

      let packageManager = "unknown";
      if (items.includes("pnpm-lock.yaml")) packageManager = "pnpm";
      else if (items.includes("yarn.lock")) packageManager = "yarn";
      else if (items.includes("bun.lockb") || items.includes("bun.lock")) packageManager = "bun";
      else if (items.includes("package-lock.json")) packageManager = "npm";
      else if (hasPyproject) packageManager = items.includes("poetry.lock") ? "poetry" : "pip";

      let projectType = "generic";
      let scripts: Record<string, string> = {};

      if (hasPackageJson) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
          scripts = pkg.scripts || {};
          const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          if (allDeps["next"]) projectType = "Next.js";
          else if (allDeps["react"]) projectType = "React";
          else if (allDeps["express"] || allDeps["fastify"]) projectType = "Node.js Server";
          else projectType = "Node.js";
        } catch {}
      } else if (hasPyproject) {
        projectType = "Python";
      } else if (hasCargo) {
        projectType = "Rust";
      }

      const discovered = {
        projectPath: targetDir,
        projectType,
        isTypeScript: hasTsConfig,
        packageManager,
        hasTests: Boolean(scripts["test"] || items.includes("tests") || items.includes("test")),
        scripts,
        sourceDirectories: items.filter((f) => ["src", "app", "lib", "components", "pages", "tests", "test"].includes(f)),
      };

      return {
        success: true,
        output: `Discovered ${projectType} project at ${targetDir} (Package Manager: ${packageManager}, TypeScript: ${hasTsConfig}, Scripts: ${Object.keys(scripts).join(", ") || "none"})`,
        data: discovered,
      };
    } catch (err: unknown) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};
