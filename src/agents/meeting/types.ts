/**
 * Star Office World — Multi-Agent Meeting Types & Schemas
 */

export interface MeetingMessage {
  id: string;
  senderId: string; // agentId or "human_owner"
  senderName: string;
  senderAvatar: string;
  senderRole: string;
  content: string;
  timestamp: number;
  thought?: string;
  callingOnAgentId?: string; // If speaker directs the question to a specific attendee
}

export interface MeetingActionItem {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string;
  priority: "low" | "medium" | "high";
  taskId?: string; // Populated once spawned in TaskManager
}

export interface MeetingMinutes {
  title: string;
  agenda: string;
  summary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  concludedAt: number;
  concludedBy: string;
}

export type MeetingStatus =
  | "PREPARING"
  | "IN_PROGRESS"
  | "CONCLUDING"
  | "CONCLUDED"
  | "CANCELLED";

export interface OfficeMeeting {
  id: string;
  title: string;
  agenda: string;
  leadAgentId: string; // "agent_coordinator" (Alex)
  participantIds: string[];
  status: MeetingStatus;
  currentSpeakerId?: string;
  turnCount: number;
  messages: MeetingMessage[];
  minutes?: MeetingMinutes;
  createdAt: number;
  startedAt?: number;
  concludedAt?: number;
}

export interface StartMeetingOptions {
  title: string;
  agenda: string;
  participantIds?: string[];
  initialNote?: string;
}
