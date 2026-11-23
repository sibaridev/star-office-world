/**
 * Star Office World — Multi-Agent Meeting Engine
 * Orchestrates dynamic multi-agent meetings moderated by Alex (agent_coordinator).
 */

import path from "node:path";
import type { OfficeWorldState } from "../../types.js";
import { updateAgentState, addMemo } from "../../state.js";
import type { SSEManager } from "../../sse.js";
import type { MemoStore } from "../../memo-store.js";
import type { AIProvider } from "../../ai/interfaces/AIProvider.js";
import type { TaskManager } from "../tasks/TaskManager.js";
import type { AgentConfigManager } from "../management/AgentConfigManager.js";
import { DEFAULT_AGENTS } from "../core/AgentRegistry.js";
import { MeetingStore } from "./MeetingStore.js";
import type {
  OfficeMeeting,
  MeetingMessage,
  MeetingMinutes,
  MeetingActionItem,
  StartMeetingOptions,
} from "./types.js";

export interface MeetingEngineDeps {
  officeState: OfficeWorldState;
  sse: SSEManager;
  memoStore: MemoStore;
  taskManager: TaskManager;
  aiProvider: AIProvider;
  dataDir: string;
  configManager?: AgentConfigManager;
}

export class MeetingEngine {
  private deps: MeetingEngineDeps;
  public readonly store: MeetingStore;
  private isProcessingTurn = false;
  private turnTimer: NodeJS.Timeout | null = null;

  constructor(deps: MeetingEngineDeps) {
    this.deps = deps;
    this.store = new MeetingStore(deps.dataDir);
  }

  public getActiveMeeting(): OfficeMeeting | null {
    return this.store.getActiveMeeting();
  }

  public getMeeting(id: string): OfficeMeeting | null {
    return this.store.getMeeting(id);
  }

  public listMeetings(): OfficeMeeting[] {
    return this.store.listMeetings();
  }

  public async startMeeting(opts: StartMeetingOptions): Promise<OfficeMeeting> {
    const existing = this.store.getActiveMeeting();
    if (existing) {
      throw new Error(
        `Another meeting "${existing.title}" (${existing.id}) is already in progress.`
      );
    }

    const leadAgentId = "agent_coordinator";
    const availableAgents = this.deps.configManager
      ? this.deps.configManager.listAgents()
      : DEFAULT_AGENTS;

    let participantIds = opts.participantIds && opts.participantIds.length > 0
      ? opts.participantIds
      : availableAgents.map((a) => a.agentId);

    // Ensure Alex is always included as leader
    if (!participantIds.includes(leadAgentId)) {
      participantIds = [leadAgentId, ...participantIds];
    }

    const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const meeting: OfficeMeeting = {
      id: meetingId,
      title: opts.title.trim(),
      agenda: opts.agenda.trim(),
      leadAgentId,
      participantIds,
      status: "IN_PROGRESS",
      currentSpeakerId: leadAgentId,
      turnCount: 0,
      messages: [],
      createdAt: Date.now(),
      startedAt: Date.now(),
    };

    if (opts.initialNote) {
      const initialMsg: MeetingMessage = {
        id: `msg_${Date.now()}_0`,
        senderId: "human_owner",
        senderName: "Owner",
        senderAvatar: "guest_role_6",
        senderRole: "Office Owner",
        content: opts.initialNote.trim(),
        timestamp: Date.now(),
      };
      meeting.messages.push(initialMsg);
    }

    this.store.saveMeeting(meeting);

    // Update office visuals: Move attendees to meeting state
    for (const agentId of participantIds) {
      const updated = updateAgentState(
        this.deps.officeState,
        agentId,
        "syncing",
        `Meeting: "${meeting.title.slice(0, 40)}"`
      );
      if (updated) {
        this.deps.sse.broadcast("agent_update", updated);
      }
    }

    const memoEntry = addMemo(
      this.deps.officeState,
      leadAgentId,
      "Alex",
      `Started office meeting: "${meeting.title}". Agenda: ${meeting.agenda}`
    );
    try {
      this.deps.memoStore.append(memoEntry);
    } catch {}
    this.deps.sse.broadcast("memo", memoEntry);
    this.deps.sse.broadcast("meeting_started", { meeting });

    // Launch meeting loop asynchronously
    this.scheduleNextTurn(meetingId, 300);

    return meeting;
  }

  public async postHumanMessage(
    meetingId: string,
    content: string
  ): Promise<MeetingMessage> {
    const meeting = this.store.getMeeting(meetingId);
    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }
    if (meeting.status !== "IN_PROGRESS") {
      throw new Error(`Meeting ${meetingId} is ${meeting.status} and cannot receive messages`);
    }

    const message: MeetingMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: "human_owner",
      senderName: "Owner",
      senderAvatar: "guest_role_6",
      senderRole: "Office Owner",
      content: content.trim(),
      timestamp: Date.now(),
    };

    meeting.messages.push(message);
    this.store.saveMeeting(meeting);
    this.deps.sse.broadcast("meeting_message", { meetingId, message });

    // Trigger next turn quickly so Alex responds
    this.scheduleNextTurn(meetingId, 400);

    return message;
  }

  public async concludeMeeting(
    meetingId: string,
    explicitSummary?: string,
    explicitDecisions?: string[],
    explicitActionItems?: MeetingActionItem[]
  ): Promise<MeetingMinutes> {
    const meeting = this.store.getMeeting(meetingId);
    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }
    if (meeting.status === "CONCLUDED") {
      return meeting.minutes!;
    }

    meeting.status = "CONCLUDING";
    this.deps.sse.broadcast("meeting_status_changed", {
      meetingId,
      status: "CONCLUDING",
    });

    let minutes: MeetingMinutes;

    if (explicitSummary && explicitDecisions && explicitActionItems) {
      minutes = {
        title: meeting.title,
        agenda: meeting.agenda,
        summary: explicitSummary,
        decisions: explicitDecisions,
        actionItems: explicitActionItems,
        concludedAt: Date.now(),
        concludedBy: "Alex (Meeting Moderator)",
      };
    } else {
      minutes = await this.generateMinutesViaAI(meeting);
    }

    // Auto-create assigned tasks in TaskManager for each action item
    for (const item of minutes.actionItems) {
      try {
        const task = this.deps.taskManager.createTask({
          title: item.title,
          description: `${item.description}\n\n[Originated from Meeting: "${meeting.title}"]`,
          assignedAgentId: item.assignedAgentId || "agent_coordinator",
          priority: item.priority || "medium",
        });
        item.taskId = task.id;
      } catch (err) {
        console.warn(`[meeting-engine] Could not spawn task for action item "${item.title}":`, err);
      }
    }

    meeting.status = "CONCLUDED";
    meeting.concludedAt = Date.now();
    meeting.minutes = minutes;
    this.store.saveMeeting(meeting);

    // Reset visual states in office
    for (const agentId of meeting.participantIds) {
      const updated = updateAgentState(
        this.deps.officeState,
        agentId,
        "idle",
        "Meeting concluded"
      );
      if (updated) {
        this.deps.sse.broadcast("agent_update", updated);
      }
    }

    const conclusionMemo = addMemo(
      this.deps.officeState,
      meeting.leadAgentId,
      "Alex",
      `Concluded meeting "${meeting.title}". Minutes published with ${minutes.actionItems.length} action item(s) created.`
    );
    try {
      this.deps.memoStore.append(conclusionMemo);
    } catch {}
    this.deps.sse.broadcast("memo", conclusionMemo);
    this.deps.sse.broadcast("meeting_concluded", { meetingId, minutes });

    return minutes;
  }

  private scheduleNextTurn(meetingId: string, delayMs = 1200): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    this.turnTimer = setTimeout(() => {
      this.processMeetingTurn(meetingId).catch((err) => {
        console.error(`[meeting-engine] Error in turn execution for ${meetingId}:`, err);
      });
    }, delayMs);
  }

  public async processMeetingTurn(meetingId: string): Promise<void> {
    const meeting = this.store.getMeeting(meetingId);
    if (!meeting || meeting.status !== "IN_PROGRESS" || this.isProcessingTurn) {
      return;
    }

    this.isProcessingTurn = true;

    try {
      const nextSpeakerId = this.selectNextSpeaker(meeting);
      meeting.currentSpeakerId = nextSpeakerId;
      this.deps.sse.broadcast("meeting_speaker_changed", {
        meetingId,
        currentSpeakerId: nextSpeakerId,
      });

      const speakerConfig = this.resolveAgentConfig(nextSpeakerId);
      const isLead = nextSpeakerId === meeting.leadAgentId;

      const prompt = this.buildTurnPrompt(meeting, nextSpeakerId, speakerConfig, isLead);
      const systemInstruction = this.buildTurnSystemInstruction(speakerConfig, isLead, meeting);

      const aiResponse = await this.deps.aiProvider.generate({
        prompt,
        systemInstruction,
        temperature: 0.7,
      });

      const parsed = this.parseTurnResponse(aiResponse.text, isLead);

      if (isLead && parsed.action === "conclude") {
        await this.concludeMeeting(
          meetingId,
          parsed.summary,
          parsed.decisions,
          parsed.actionItems
        );
        return;
      }

      const newMsg: MeetingMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        senderId: nextSpeakerId,
        senderName: speakerConfig.name,
        senderAvatar: speakerConfig.avatar,
        senderRole: speakerConfig.role,
        content: parsed.content || aiResponse.text.trim(),
        thought: parsed.thought,
        callingOnAgentId: parsed.callingOn,
        timestamp: Date.now(),
      };

      meeting.messages.push(newMsg);
      meeting.turnCount++;
      this.store.saveMeeting(meeting);

      // Update speaker visual detail in office
      const updated = updateAgentState(
        this.deps.officeState,
        nextSpeakerId,
        "syncing",
        `Speaking in "${meeting.title.slice(0, 30)}"`
      );
      if (updated) {
        this.deps.sse.broadcast("agent_update", updated);
      }

      this.deps.sse.broadcast("meeting_message", { meetingId, message: newMsg });

      // Continue to next turn if meeting is still active
      if (meeting.status === "IN_PROGRESS") {
        this.scheduleNextTurn(meetingId, 1200);
      }
    } finally {
      this.isProcessingTurn = false;
    }
  }

  private selectNextSpeaker(meeting: OfficeMeeting): string {
    const lead = meeting.leadAgentId;
    const attendees = meeting.participantIds.filter((id) => id !== lead);

    if (meeting.messages.length === 0) {
      return lead; // Alex opens
    }

    const lastMsg = meeting.messages[meeting.messages.length - 1];

    // 1. If last speaker explicitly called on an attendee
    if (
      lastMsg.callingOnAgentId &&
      meeting.participantIds.includes(lastMsg.callingOnAgentId) &&
      lastMsg.callingOnAgentId !== lastMsg.senderId
    ) {
      return lastMsg.callingOnAgentId;
    }

    // 2. If last speaker was the human owner, Alex responds
    if (lastMsg.senderId === "human_owner") {
      return lead;
    }

    // 3. If last speaker was an attendee, Alex (lead) takes the floor to moderate
    if (lastMsg.senderId !== lead) {
      return lead;
    }

    // 4. If Alex spoke last but didn't name someone, pick the least recently spoken attendee
    const speakerCounts = new Map<string, number>();
    for (const a of attendees) {
      speakerCounts.set(a, 0);
    }
    for (const m of meeting.messages) {
      if (speakerCounts.has(m.senderId)) {
        speakerCounts.set(m.senderId, (speakerCounts.get(m.senderId) || 0) + 1);
      }
    }

    let minAttendee = attendees[0] || lead;
    let minCount = Infinity;
    for (const [id, count] of speakerCounts) {
      if (count < minCount) {
        minCount = count;
        minAttendee = id;
      }
    }

    return minAttendee;
  }

  private resolveAgentConfig(agentId: string) {
    if (this.deps.configManager) {
      const cfg = this.deps.configManager.getAgent(agentId);
      if (cfg) return cfg;
    }
    const def = DEFAULT_AGENTS.find((a) => a.agentId === agentId);
    if (def) return def;

    return {
      agentId,
      name: agentId,
      role: "Team Member",
      avatar: "guest_role_1",
      systemPrompt: `You are ${agentId} in Star Office World.`,
    };
  }

  private buildTurnPrompt(
    meeting: OfficeMeeting,
    speakerId: string,
    config: any,
    isLead: boolean
  ): string {
    const attendees = meeting.participantIds
      .map((id) => {
        const c = this.resolveAgentConfig(id);
        return `- ${c.name} (${c.role}, ID: ${id})`;
      })
      .join("\n");

    const transcript = meeting.messages
      .map((m) => `[${m.senderName} (${m.senderRole})]: ${m.content}`)
      .join("\n\n");

    return `MEETING SESSION:
Title: ${meeting.title}
Agenda: ${meeting.agenda}
Meeting Turn: #${meeting.turnCount + 1}

ATTENDEES:
${attendees}

CONVERSATION TRANSCRIPT SO FAR:
${transcript || "(The meeting is just starting. Open the meeting with the agenda.)"}

YOUR TURN TO SPEAK:
You are ${config.name} (${config.role}).
${
  isLead
    ? "As the Meeting Leader, review what colleagues and the owner have said. Direct the conversation, challenge points, call on specific attendees, or conclude the meeting when the agenda is fully resolved."
    : "Share your specialized insights, react to previous points made by colleagues, and offer concrete proposals."
}
Formulate your response in the required JSON format.`;
  }

  private buildTurnSystemInstruction(
    config: any,
    isLead: boolean,
    meeting: OfficeMeeting
  ): string {
    const attendeeIds = meeting.participantIds.filter((id) => id !== config.agentId);

    if (isLead) {
      return `${config.systemPrompt}

You are presiding over a team meeting in Star Office World as the Lead and Moderator.
Meeting Title: "${meeting.title}"
Meeting Agenda: "${meeting.agenda}"
Attendees: ${meeting.participantIds.join(", ")}

MODERATOR RULES:
1. Keep the meeting focused on the agenda.
2. In each turn, respond to recent points, ask for opinions, or call on a specific attendee using the "callingOn" field.
3. If the agenda has been thoroughly discussed and consensus is reached, you can conclude the meeting by returning action: "conclude" with summary, decisions, and actionItems.
4. Always respond in valid JSON matching this schema:

To speak and continue the meeting:
\`\`\`json
{
  "action": "speak",
  "content": "Your speech to the team...",
  "callingOn": "one of: ${attendeeIds.join(", ") || "none"}",
  "thought": "Your internal moderation reasoning"
}
\`\`\`

To conclude the meeting:
\`\`\`json
{
  "action": "conclude",
  "summary": "Executive summary of what was discussed...",
  "decisions": [
    "Decision 1...",
    "Decision 2..."
  ],
  "actionItems": [
    {
      "id": "item_1",
      "title": "Action item title",
      "description": "Detailed task instructions",
      "assignedAgentId": "agent_nova | agent_researcher | agent_writer | agent_reviewer",
      "priority": "high"
    }
  ],
  "thought": "Why we are ready to conclude"
}
\`\`\`
`;
    }

    return `${config.systemPrompt}

You are participating in an office meeting with your colleagues in Star Office World.
Title: "${meeting.title}"
Agenda: "${meeting.agenda}"

PARTICIPANT RULES:
1. Speak in character according to your role (${config.role}).
2. Be concise, direct, collaborative, and professional (2-4 sentences).
3. React directly to what colleagues or the Owner have stated in the transcript.
4. Always respond in valid JSON matching this schema:

\`\`\`json
{
  "action": "speak",
  "content": "Your response to the team...",
  "thought": "Your internal reasoning"
}
\`\`\`
`;
  }

  private parseTurnResponse(text: string, isLead: boolean) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const rawJson = jsonMatch ? jsonMatch[1] : text;

    try {
      const parsed = JSON.parse(rawJson!);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fallback: look for JSON object substring
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end > start) {
          const parsed = JSON.parse(text.slice(start, end + 1));
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        }
      } catch {}
    }

    // Default fallback to direct text speech
    return {
      action: "speak",
      content: text.replace(/```(?:json)?|```/g, "").trim(),
      thought: "Direct response",
    };
  }

  private async generateMinutesViaAI(meeting: OfficeMeeting): Promise<MeetingMinutes> {
    const transcript = meeting.messages
      .map((m) => `[${m.senderName} (${m.senderRole})]: ${m.content}`)
      .join("\n\n");

    const prompt = `Synthesize the complete meeting transcript below into structured Meeting Minutes.

MEETING TITLE: ${meeting.title}
AGENDA: ${meeting.agenda}

TRANSCRIPT:
${transcript}

Produce a JSON response with:
- "summary": comprehensive executive summary of the discussion and conclusions
- "decisions": array of key decisions agreed upon
- "actionItems": array of concrete tasks with "title", "description", "assignedAgentId" (choose appropriate agent from attendees), and "priority" ("low" | "medium" | "high")

Return ONLY valid JSON:
\`\`\`json
{
  "summary": "...",
  "decisions": ["..."],
  "actionItems": [
    {
      "title": "...",
      "description": "...",
      "assignedAgentId": "agent_nova",
      "priority": "high"
    }
  ]
}
\`\`\``;

    const res = await this.deps.aiProvider.generate({
      prompt,
      systemInstruction: "You are Alex, Lead Coordinator. Compile accurate, structured meeting minutes from the transcript.",
      temperature: 0.3,
    });

    const parsed = this.parseTurnResponse(res.text, true);

    return {
      title: meeting.title,
      agenda: meeting.agenda,
      summary: parsed.summary || "Meeting concluded successfully.",
      decisions: Array.isArray(parsed.decisions) && parsed.decisions.length > 0
        ? parsed.decisions
        : ["Team aligned on agenda objectives."],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item: any, idx: number) => ({
            id: `item_${Date.now()}_${idx + 1}`,
            title: item.title || `Action item #${idx + 1}`,
            description: item.description || item.title || "Execute meeting decision",
            assignedAgentId: item.assignedAgentId || "agent_coordinator",
            priority: item.priority || "medium",
          }))
        : [],
      concludedAt: Date.now(),
      concludedBy: "Alex (Meeting Moderator)",
    };
  }

  public shutdown(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }
}
