/**
 * Star Office World — Antigravity Engineering Tools
 * Allows office agents to delegate coding and software tasks to Google Antigravity
 * and check the real Antigravity Bridge connection status.
 */

import type { ToolDefinition } from "../ToolTypes.js";
import type { WorkspaceConfig } from "../../../integrations/antigravity/types.js";

export const checkAntigravityBridgeTool: ToolDefinition = {
  name: "check_antigravity_bridge",
  description: "Check the Google Antigravity Bridge connection status, installed CLI interfaces, active processes, and diagnostic readiness in Star Office World.",
  riskLevel: "low",
  parameters: {},
  async execute(_args, context) {
    if (!context.antigravityBridge) {
      return {
        success: false,
        output: "Antigravity Bridge is NOT configured on this server.",
        error: "Bridge uninitialized",
      };
    }

    try {
      const diag = await context.antigravityBridge.runDiagnostics();
      const workspaces = context.antigravityBridge.workspaces.listWorkspaces();
      const output = [
        `=== Google Antigravity Bridge Status ===`,
        `Overall Status: ${diag.overallStatus}`,
        `Summary: ${diag.summary}`,
        `Detected CLI (agy.exe): ${diag.detectedAgyPath || "Not found"}`,
        `Detected IDE: ${diag.detectedIdePath || "Not found"}`,
        `CLI Version: ${diag.version || "Unknown"}`,
        `Active Antigravity Processes: ${diag.runningProcesses.length} running`,
        ``,
        `=== Capabilities ===`,
        `- Installation: ${diag.capabilities.installationDetection.status} (${diag.capabilities.installationDetection.details})`,
        `- Supported Interface: ${diag.capabilities.supportedInterfaceDetection.status} (${diag.capabilities.supportedInterfaceDetection.details})`,
        `- Process Availability: ${diag.capabilities.processAvailability.status} (${diag.capabilities.processAvailability.details})`,
        `- Authentication Readiness: ${diag.capabilities.authenticationReadiness.status} (${diag.capabilities.authenticationReadiness.details})`,
        `- Workspace Discovery: ${diag.capabilities.workspaceDiscovery.status} (${diag.capabilities.workspaceDiscovery.details})`,
        `- Task Submission: ${diag.capabilities.taskSubmissionCapability.status} (${diag.capabilities.taskSubmissionCapability.details})`,
        `- Execution Status Retrieval: ${diag.capabilities.executionStatusRetrieval.status} (${diag.capabilities.executionStatusRetrieval.details})`,
        `- Result Retrieval: ${diag.capabilities.resultRetrieval.status} (${diag.capabilities.resultRetrieval.details})`,
        ``,
        `=== Authorized Workspaces ===`,
        workspaces.length === 0
          ? "No workspaces registered."
          : workspaces
              .map(
                (w: WorkspaceConfig) =>
                  `- [${w.workspaceId}] ${w.name}: ${w.path} (Git: ${w.gitInfo?.isRepo ? `Branch ${w.gitInfo.branch}` : "Non-git"}, Status: ${w.status})`
              )
              .join("\n"),
        ``,
        `How Access Works: Star Office agents submit engineering prompts to Google Antigravity via the official 'agy.exe' CLI runtime. Antigravity executes tasks on authorized project repositories and streams real-time status, git diffs, and execution results back into Star Office World.`,
      ].join("\n");

      return {
        success: true,
        output,
        data: diag,
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

export const delegateToAntigravityTool: ToolDefinition = {
  name: "delegate_to_antigravity",
  description: "Delegate a software development, refactoring, code review, or bugfix task to Google Antigravity coding agent via the real Antigravity Bridge.",
  riskLevel: "medium",
  parameters: {
    title: {
      type: "string",
      description: "Short title of the software engineering task",
      required: true,
    },
    objective: {
      type: "string",
      description: "Detailed engineering objective explaining what needs to be accomplished",
      required: true,
    },
    requirements: {
      type: "string",
      description: "Specific implementation requirements (semicolon or newline separated)",
      required: true,
    },
    workspaceId: {
      type: "string",
      description: "Registered workspace ID (defaults to 'default_workspace')",
      required: false,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return {
        success: false,
        output: "",
        error: "Antigravity Bridge is not configured on this server.",
      };
    }

    const title = String(args["title"] ?? "").trim();
    const objective = String(args["objective"] ?? "").trim();
    const reqRaw = String(args["requirements"] ?? "").trim();
    const workspaceId = String(args["workspaceId"] || "default_workspace");

    if (!title || !objective || !reqRaw) {
      return {
        success: false,
        output: "",
        error: "title, objective, and requirements are all required.",
      };
    }

    const requirements = reqRaw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);

    try {
      const task = context.antigravityBridge.submitEngineeringTask({
        workspaceId,
        title,
        objective,
        requirements,
        assignedOfficeAgentId: context.agentId,
      });

      return {
        success: true,
        output: `Successfully submitted engineering task to Google Antigravity! Task ID: ${task.id} (Status: ${task.status}). Real execution has started via the Antigravity CLI on workspace '${workspaceId}'. Progress and git diff deliverables will be streamed live.`,
        data: { taskId: task.id, workspaceId, status: task.status },
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
