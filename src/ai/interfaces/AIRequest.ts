/**
 * Star Office World — AI Request Interface
 */

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export interface AIRequest {
  prompt: string;
  systemInstruction?: string;
  conversationHistory?: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}
