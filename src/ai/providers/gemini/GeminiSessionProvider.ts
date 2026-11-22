/**
 * Star Office World — Gemini Session Provider
 * Implements the unified AIProvider interface.
 */

import type {
  AIProvider,
  ProviderHealth,
  SessionStatus,
} from "../../interfaces/AIProvider.js";
import type { AIRequest } from "../../interfaces/AIRequest.js";
import type { AIResponse } from "../../interfaces/AIResponse.js";
import {
  loadGeminiSessionConfig,
  type GeminiSessionConfig,
} from "./GeminiSessionConfig.js";
import { GeminiRateLimiter } from "./GeminiRateLimiter.js";
import { GeminiSessionClient } from "./GeminiSessionClient.js";

export class GeminiSessionProvider implements AIProvider {
  private config: GeminiSessionConfig;
  private client: GeminiSessionClient;
  private rateLimiter: GeminiRateLimiter;

  constructor(overrides?: Partial<GeminiSessionConfig>) {
    this.config = { ...loadGeminiSessionConfig(), ...overrides };
    this.client = new GeminiSessionClient(this.config);
    this.rateLimiter = new GeminiRateLimiter(this.config);
  }

  public async initialize(): Promise<void> {
    if (!this.config.enabled) {
      console.log("[ai-provider] Gemini session provider is disabled via GEMINI_SESSION_ENABLED=false");
      return;
    }
    await this.client.initialize();
  }

  public async validateSession(): Promise<SessionStatus> {
    return this.client.validate();
  }

  public async generate(request: AIRequest): Promise<AIResponse> {
    return this.rateLimiter.enqueue(() => this.client.generate(request));
  }

  public async getHealth(): Promise<ProviderHealth> {
    const sessionStatus = this.client.getStatus();
    const isDegraded = sessionStatus.state === "expired" || sessionStatus.state === "rate_limited";
    const isError = sessionStatus.state === "error";

    return {
      status: isError ? "error" : isDegraded ? "degraded" : "ok",
      provider: "gemini-session",
      session: sessionStatus,
      queuedRequests: this.rateLimiter.queueLength,
      activeRequests: this.rateLimiter.activeRequests,
      totalRequests: this.rateLimiter.totalRequests,
      successfulRequests: this.rateLimiter.successfulRequests,
      failedRequests: this.rateLimiter.failedRequests,
      averageResponseTimeMs: this.rateLimiter.averageDurationMs,
    };
  }

  public async shutdown(): Promise<void> {
    this.rateLimiter.clear();
    await this.client.close();
  }
}
