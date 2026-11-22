/**
 * Star Office World — Antigravity MCP Server
 * Exposes Model Context Protocol tools for Antigravity to claim tasks, report progress, and submit code results.
 */

import type { AntigravityBridge } from "../bridge/AntigravityBridge.js";
import type { AntigravityTask } from "../types.js";

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export class AntigravityMCPServer {
  private bridge: AntigravityBridge;

  constructor(bridge: AntigravityBridge) {
    this.bridge = bridge;
  }

  public getTools(): MCPToolDefinition[] {
    return [
      {
        name: "list_pending_office_tasks",
        description: "List queued or submitted engineering tasks dispatched from Star Office World.",
        inputSchema: {
          type: "object",
          properties: {
            workspaceId: { type: "string", description: "Optional workspace filter" },
          },
        },
      },
      {
        name: "claim_pending_office_task",
        description: "Claim an office engineering task for execution by Antigravity.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID to claim" },
            antigravitySessionId: { type: "string", description: "Optional Antigravity session/agent ID" },
          },
          required: ["taskId"],
        },
      },
      {
        name: "read_office_task_spec",
        description: "Read the full engineering prompt, requirements, constraints, and workspace info for an office task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
          },
          required: ["taskId"],
        },
      },
      {
        name: "report_office_task_progress",
        description: "Report execution progress percentage (0-100) and milestone message to the office.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            progress: { type: "number", description: "Progress percentage (0-100)" },
            message: { type: "string", description: "Current activity or milestone description" },
          },
          required: ["taskId", "progress", "message"],
        },
      },
      {
        name: "request_task_clarification",
        description: "Ask a clarifying question to the office agent regarding the task requirements.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            question: { type: "string", description: "The question for the office agent" },
          },
          required: ["taskId", "question"],
        },
      },
      {
        name: "publish_task_execution_event",
        description: "Publish a granular execution event (e.g. tool execution, test run) to the office event bus.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            type: { type: "string", description: "Event type identifier" },
            message: { type: "string", description: "Event message" },
          },
          required: ["taskId", "type", "message"],
        },
      },
      {
        name: "submit_task_results",
        description: "Submit final completed engineering deliverable, git diff, and test execution output.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            result: { type: "string", description: "Summary of changes and deliverables implemented" },
            diff: { type: "string", description: "Git diff output of modified files" },
            testResults: { type: "string", description: "Output log of test suite execution" },
          },
          required: ["taskId", "result"],
        },
      },
      {
        name: "report_task_error",
        description: "Report task execution failure and errors to the office.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            error: { type: "string", description: "Error description and stack trace" },
          },
          required: ["taskId", "error"],
        },
      },
      {
        name: "request_task_cancellation",
        description: "Request cancellation of an active task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID" },
            reason: { type: "string", description: "Reason for cancellation" },
          },
          required: ["taskId"],
        },
      },
    ];
  }

  public async executeTool(name: string, args: Record<string, unknown>): Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }> {
    try {
      switch (name) {
        case "list_pending_office_tasks": {
          const wsId = args["workspaceId"] ? String(args["workspaceId"]) : undefined;
          const pendingStatuses = ["QUEUED", "SUBMITTED", "READY_FOR_SUBMISSION", "SUBMITTED_TO_ANTIGRAVITY", "ACCEPTED_BY_ANTIGRAVITY"];
          const tasks = this.bridge.taskManager
            .listTasks({ workspaceId: wsId })
            .filter((t) => pendingStatuses.includes(t.status));

          const summary = tasks.map((t) => ({
            id: t.id,
            title: t.title,
            workspaceId: t.workspaceId,
            status: t.status,
            createdAt: new Date(t.createdAt).toISOString(),
          }));

          return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
        }

        case "claim_pending_office_task": {
          const taskId = String(args["taskId"] ?? "");
          const task = this.bridge.taskManager.getTask(taskId);
          if (!task) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }

          const claimable = ["QUEUED", "SUBMITTED", "READY_FOR_SUBMISSION", "SUBMITTED_TO_ANTIGRAVITY", "ACCEPTED_BY_ANTIGRAVITY"];
          if (!claimable.includes(task.status)) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} is not pending (status: ${task.status})` }] };
          }

          task.antigravitySessionId = args["antigravitySessionId"] ? String(args["antigravitySessionId"]) : undefined;
          this.bridge.taskManager.updateStatus(taskId, "ACCEPTED", "Claimed by Antigravity", 5);
          return { content: [{ type: "text", text: `Task ${taskId} successfully claimed.` }] };
        }

        case "read_office_task_spec": {
          const taskId = String(args["taskId"] ?? "");
          const task = this.bridge.taskManager.getTask(taskId);
          if (!task) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          const ws = this.bridge.workspaces.getWorkspace(task.workspaceId);

          const payload = {
            id: task.id,
            title: task.title,
            workspace: ws ? { id: ws.workspaceId, name: ws.name, path: ws.path, permissions: ws.allowedOperations } : null,
            engineeringPrompt: task.engineeringPrompt,
            status: task.status,
            followUpInstructions: task.followUpInstructions,
          };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
        }

        case "report_office_task_progress": {
          const taskId = String(args["taskId"] ?? "");
          const progress = Math.max(0, Math.min(100, Number(args["progress"] ?? 0)));
          const msg = String(args["message"] ?? "");

          const updated = this.bridge.taskManager.updateStatus(taskId, "RUNNING", msg, progress);
          if (!updated) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          return { content: [{ type: "text", text: `Progress updated: ${progress}% - ${msg}` }] };
        }

        case "request_task_clarification": {
          const taskId = String(args["taskId"] ?? "");
          const question = String(args["question"] ?? "");

          const clar = this.bridge.taskManager.requestClarification(taskId, question);
          if (!clar) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          return { content: [{ type: "text", text: `Clarification requested: "${question}" (id: ${clar.id})` }] };
        }

        case "publish_task_execution_event": {
          const taskId = String(args["taskId"] ?? "");
          const type = String(args["type"] ?? "event");
          const msg = String(args["message"] ?? "");

          this.bridge.taskManager.addEvent(taskId, type, msg);
          return { content: [{ type: "text", text: `Event logged for ${taskId}` }] };
        }

        case "submit_task_results": {
          const taskId = String(args["taskId"] ?? "");
          const result = String(args["result"] ?? "");
          const diff = args["diff"] ? String(args["diff"]) : undefined;
          const testResults = args["testResults"] ? String(args["testResults"]) : undefined;

          // If no diff provided, attempt to pull latest git diff from workspace directly
          const task = this.bridge.taskManager.getTask(taskId);
          let capturedDiff = diff;
          if (!capturedDiff && task) {
            capturedDiff = this.bridge.workspaces.getGitDiff(task.workspaceId);
          }

          const completed = this.bridge.taskManager.completeTask(taskId, {
            result,
            diff: capturedDiff,
            testResults,
          });

          if (!completed) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          return { content: [{ type: "text", text: `Task ${taskId} completed and recorded.` }] };
        }

        case "report_task_error": {
          const taskId = String(args["taskId"] ?? "");
          const error = String(args["error"] ?? "Unknown error");

          const failed = this.bridge.taskManager.failTask(taskId, error);
          if (!failed) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          return { content: [{ type: "text", text: `Task ${taskId} marked as failed.` }] };
        }

        case "request_task_cancellation": {
          const taskId = String(args["taskId"] ?? "");
          const reason = String(args["reason"] ?? "Cancelled by Antigravity");

          const cancelled = this.bridge.taskManager.cancelTask(taskId, reason);
          if (!cancelled) {
            return { isError: true, content: [{ type: "text", text: `Task ${taskId} not found` }] };
          }
          return { content: [{ type: "text", text: `Task ${taskId} cancelled.` }] };
        }

        default:
          return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
      }
    } catch (err: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }

  /**
   * Dispatches standard JSON-RPC 2.0 MCP requests.
   */
  public async handleJsonRpc(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = request["id"];
    const method = String(request["method"] ?? "");
    const params = (request["params"] as Record<string, unknown>) || {};

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "star-office-antigravity-mcp",
            version: "1.0.0",
          },
          capabilities: {
            tools: {},
          },
        },
      };
    }

    if (method === "notifications/initialized") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: this.getTools(),
        },
      };
    }

    if (method === "tools/call") {
      const name = String(params["name"] ?? "");
      const args = (params["arguments"] as Record<string, unknown>) || {};
      const res = await this.executeTool(name, args);
      return {
        jsonrpc: "2.0",
        id,
        result: res,
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}
