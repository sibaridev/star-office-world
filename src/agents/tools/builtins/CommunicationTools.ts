/**
 * Star Office World — Inter-Agent Communication Tools
 */

import type { ToolDefinition } from "../ToolTypes.js";

export const sendAgentMessageTool: ToolDefinition = {
  name: "send_agent_message",
  description: "Send a message or information to another agent in the office.",
  riskLevel: "low",
  parameters: {
    targetAgentId: {
      type: "string",
      description: "The agentId or alias of the recipient agent",
      required: true,
    },
    message: {
      type: "string",
      description: "Message content or data to deliver",
      required: true,
    },
  },
  async execute(args, context) {
    const target = String(args["targetAgentId"] ?? "");
    const msg = String(args["message"] ?? "");

    if (!target || !msg) {
      return { success: false, output: "", error: "targetAgentId and message are required." };
    }

    if (context.eventBus) {
      context.eventBus("agent_message", {
        fromAgentId: context.agentId,
        fromAgentName: context.agentName,
        toAgentId: target,
        message: msg,
        taskId: context.taskId,
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      output: `Message successfully delivered to agent ${target}.`,
      data: { to: target, length: msg.length },
    };
  },
};

export const postOfficeMemoTool: ToolDefinition = {
  name: "post_office_memo",
  description: "Post a work progress memo to the office bulletin board.",
  riskLevel: "low",
  parameters: {
    content: {
      type: "string",
      description: "Memo text to display on the office board",
      required: true,
    },
  },
  async execute(args, context) {
    const content = String(args["content"] ?? "").trim();
    if (!content) {
      return { success: false, output: "", error: "Memo content is required." };
    }

    if (context.eventBus) {
      context.eventBus("office_memo", {
        agentId: context.agentId,
        alias: context.agentName,
        content,
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      output: `Memo posted to office board: "${content.slice(0, 80)}..."`,
      data: { content },
    };
  },
};
