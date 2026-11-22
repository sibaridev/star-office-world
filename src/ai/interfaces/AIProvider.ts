/**
 * Star Office World — AI Provider Interface
 */

import type { AIRequest } from "./AIRequest.js";
import type { AIResponse } from "./AIResponse.js";

export type SessionState =
  | "healthy"
  | "unauthenticated"
  | "expired"
  | "rate_limited"
  | "error";

export interface SessionStatus {
  state: SessionState;
  authenticated: boolean;
  isGuest: boolean;
  message: string;
  lastValidatedAt: number;
}

export interface ProviderHealth {
  status: "ok" | "degraded" | "error";
  provider: string;
  session: SessionStatus;
  queuedRequests: number;
  activeRequests: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTimeMs: number;
}

export interface AIProvider {
  initialize(): Promise<void>;
  validateSession(): Promise<SessionStatus>;
  generate(request: AIRequest): Promise<AIResponse>;
  getHealth(): Promise<ProviderHealth>;
  shutdown(): Promise<void>;
}
