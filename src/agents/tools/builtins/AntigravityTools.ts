/**
 * Star Office World — Antigravity Engineering Tools
 * Allows office agents to delegate coding and software tasks to Google Antigravity
 * and check the real Antigravity Bridge connection status.
 */

import type { ToolDefinition } from "../ToolTypes.js";
import type { WorkspaceConfig, AntigravityTask } from "../../../integrations/antigravity/types.js";

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

export const runAntigravityE2ETestTool: ToolDefinition = {
  name: "run_antigravity_e2e_test",
  description: "Execute a safe, live end-to-end inspection test using Google Antigravity (agy.exe) on an authorized workspace to analyze project stack, directories, and git status without modifying any files.",
  riskLevel: "low",
  parameters: {
    workspaceId: {
      type: "string",
      description: "Optional workspace ID to inspect (defaults to default_workspace)",
      required: false,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return { success: false, output: "", error: "Antigravity Bridge is not configured on this server." };
    }
    const wsId = args["workspaceId"] ? String(args["workspaceId"]) : undefined;
    try {
      const res = await context.antigravityBridge.runE2ETest(wsId);
      const output = [
        `=== Google Antigravity Live E2E Inspection Test ===`,
        `Status: ${res.executionStatus}`,
        `Connection ID: ${res.connectionId}`,
        `Execution ID: ${res.executionId}`,
        `Workspace: ${res.workspaceId}`,
        `Submitted At: ${new Date(res.submissionTimestamp).toISOString()}`,
        `Completed At: ${res.completedTimestamp ? new Date(res.completedTimestamp).toISOString() : "N/A"}`,
        ``,
        `--- Actual Antigravity Output ---`,
        res.actualResponse || res.error || "(No output returned)",
      ].join("\n");
      return { success: res.executionStatus === "COMPLETED", output, data: res };
    } catch (err: unknown) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const listAntigravityTasksTool: ToolDefinition = {
  name: "list_antigravity_tasks",
  description: "List all software engineering tasks dispatched to Google Antigravity with their execution status, progress, and session IDs.",
  riskLevel: "low",
  parameters: {
    status: {
      type: "string",
      description: "Optional status filter (e.g., RUNNING_IN_ANTIGRAVITY, COMPLETED, FAILED)",
      required: false,
    },
    workspaceId: {
      type: "string",
      description: "Optional workspace ID filter",
      required: false,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return { success: false, output: "", error: "Antigravity Bridge is not configured on this server." };
    }
    const status = args["status"] ? (String(args["status"]) as any) : undefined;
    const workspaceId = args["workspaceId"] ? String(args["workspaceId"]) : undefined;
    const tasks = context.antigravityBridge.taskManager.listTasks({ status, workspaceId });
    if (tasks.length === 0) {
      return { success: true, output: "No Antigravity tasks found matching filter.", data: [] };
    }
    const formatted = tasks
      .map(
        (t: AntigravityTask) =>
          `[${t.id}] "${t.title}" | Status: ${t.status} | Progress: ${t.progress}% | Agent: ${t.assignedOfficeAgentId} | Session: ${t.antigravitySessionId || "N/A"}`
      )
      .join("\n");
    return { success: true, output: formatted, data: tasks };
  },
};

export const getAntigravityTaskDetailsTool: ToolDefinition = {
  name: "get_antigravity_task_details",
  description: "Retrieve complete execution details, result deliverables, git diffs, and test results for a specific Antigravity task.",
  riskLevel: "low",
  parameters: {
    taskId: {
      type: "string",
      description: "Task ID to inspect (e.g. ag_task_...)",
      required: true,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return { success: false, output: "", error: "Antigravity Bridge is not configured on this server." };
    }
    const taskId = String(args["taskId"] ?? "").trim();
    if (!taskId) return { success: false, output: "", error: "taskId is required" };
    const task = context.antigravityBridge.taskManager.getTask(taskId);
    if (!task) return { success: false, output: "", error: `Task '${taskId}' not found` };

    const output = [
      `=== Antigravity Task Details: ${task.id} ===`,
      `Title: ${task.title}`,
      `Workspace: ${task.workspaceId}`,
      `Status: ${task.status} (${task.progress}%)`,
      `Progress Message: ${task.progressMessage}`,
      `Assigned Agent: ${task.assignedOfficeAgentId}`,
      `Session ID: ${task.antigravitySessionId || "N/A"}`,
      `Created: ${new Date(task.createdAt).toISOString()}`,
      `Completed: ${task.completedAt ? new Date(task.completedAt).toISOString() : "In progress"}`,
      ``,
      `--- Deliverable Result ---`,
      task.result || "(No result deliverable submitted yet)",
      ``,
      `--- Git Diff ---`,
      task.diff || "(No git diff)",
      ``,
      `--- Test Execution Output ---`,
      task.testResults || "(No test output)",
    ].join("\n");
    return { success: true, output, data: task };
  },
};

export const cancelAntigravityTaskTool: ToolDefinition = {
  name: "cancel_antigravity_task",
  description: "Safely cancel an in-flight or queued Google Antigravity task and release the workspace lock.",
  riskLevel: "medium",
  parameters: {
    taskId: {
      type: "string",
      description: "Task ID to cancel",
      required: true,
    },
    reason: {
      type: "string",
      description: "Reason for cancellation",
      required: false,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return { success: false, output: "", error: "Antigravity Bridge is not configured on this server." };
    }
    const taskId = String(args["taskId"] ?? "").trim();
    const reason = args["reason"] ? String(args["reason"]).trim() : "Cancelled by Antigravity Master";
    if (!taskId) return { success: false, output: "", error: "taskId is required" };
    const cancelled = context.antigravityBridge.cancelTask(taskId, reason);
    if (!cancelled) return { success: false, output: "", error: `Task '${taskId}' could not be cancelled or not found` };
    return { success: true, output: `Task '${taskId}' successfully cancelled. Reason: ${reason}`, data: cancelled };
  },
};

export const inspectAntigravityWorkspaceTool: ToolDefinition = {
  name: "inspect_antigravity_workspace",
  description: "Inspect an authorized workspace directory, validating its existence, empty/non-empty status, file count, and git repository details.",
  riskLevel: "low",
  parameters: {
    workspaceId: {
      type: "string",
      description: "Workspace ID to inspect (e.g. default_workspace)",
      required: true,
    },
  },
  async execute(args, context) {
    if (!context.antigravityBridge) {
      return { success: false, output: "", error: "Antigravity Bridge is not configured on this server." };
    }
    const wsId = String(args["workspaceId"] ?? "").trim();
    if (!wsId) return { success: false, output: "", error: "workspaceId is required" };
    try {
      const inspection = context.antigravityBridge.workspaces.inspectWorkspace(wsId);
      const ws = context.antigravityBridge.workspaces.getWorkspace(wsId);
      const output = [
        `=== Workspace Inspection: ${ws?.name || wsId} ===`,
        `Workspace ID: ${wsId}`,
        `Path: ${inspection.path}`,
        `Exists: ${inspection.exists}`,
        `Is Empty: ${inspection.isEmpty} (${inspection.fileCount} files)`,
        `Git Repo: ${inspection.gitInfo?.isRepo ? `Yes (Branch: ${inspection.gitInfo.branch}, Head: ${inspection.gitInfo.headCommit?.slice(0, 7) || "N/A"})` : "No"}`,
        `Allowed Operations: ${ws?.allowedOperations.join(", ") || "Standard"}`,
        `Current Status: ${ws?.status} (Active Task: ${ws?.activeTaskId || "None"})`,
      ].join("\n");
      return { success: true, output, data: inspection };
    } catch (err: unknown) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};
