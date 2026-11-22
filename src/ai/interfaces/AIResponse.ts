/**
 * Star Office World — AI Response Interface
 */

export interface AIResponse {
  text: string;
  model: string;
  durationMs: number;
  finishReason?: string;
  thoughts?: string;
}
