/**
 * Star Office World — Gemini Session Client
 * Encapsulates the unofficial session integration with gemini-reverse.
 */

import { Gemini, Model, AuthError } from "gemini-reverse";
import type { GeminiSessionConfig } from "./GeminiSessionConfig.js";
import { classifyGeminiError, ClassifiedGeminiError } from "./GeminiErrorHandler.js";
import type { AIRequest } from "../../interfaces/AIRequest.js";
import type { AIResponse } from "../../interfaces/AIResponse.js";
import type { SessionStatus } from "../../interfaces/AIProvider.js";

interface ReverseGeminiClient {
  init(): Promise<void>;
  close(): Promise<void>;
  newChat(opts?: { model?: unknown }): {
    generateContent(opts: { prompt: string; model?: unknown }): Promise<{
      text?: string;
      thought?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>;
  };
  cookies: Record<string, string>;
  _ready: boolean;
  _guest: boolean;
}

export class GeminiSessionClient {
  private config: GeminiSessionConfig;
  private client: ReverseGeminiClient | null = null;
  private lastValidatedAt = 0;
  private lastStatus: SessionStatus;

  constructor(config: GeminiSessionConfig) {
    this.config = config;
    this.lastStatus = {
      state: "unauthenticated",
      authenticated: false,
      isGuest: !config.secure1PSID,
      message: "Session uninitialized.",
      lastValidatedAt: 0,
    };
  }

  public async initialize(): Promise<void> {
    try {
      this.client = new Gemini({
        secure_1psid: this.config.secure1PSID ?? null,
        proxy: this.config.proxy ?? null,
        timeout: this.config.requestTimeoutMs,
        verbose: false,
      }) as unknown as ReverseGeminiClient;

      // Inject __Secure-1PSIDTS if available
      if (this.config.secure1PSIDTS && this.client.cookies) {
        this.client.cookies["__Secure-1PSIDTS"] = this.config.secure1PSIDTS;
      }

      await this.validate();
    } catch (err: unknown) {
      const classified = classifyGeminiError(err, this.config);
      this.lastStatus = {
        state: classified.category === "AUTH_EXPIRED" ? "expired" : "error",
        authenticated: false,
        isGuest: !this.config.secure1PSID,
        message: classified.message,
        lastValidatedAt: Date.now(),
      };
      console.warn(`[gemini-session] Session initialization issue: ${classified.message}`);
    }
  }

  public async validate(): Promise<SessionStatus> {
    if (!this.client) {
      this.lastStatus = {
        state: "unauthenticated",
        authenticated: false,
        isGuest: !this.config.secure1PSID,
        message: "Session client not instantiated.",
        lastValidatedAt: Date.now(),
      };
      return this.lastStatus;
    }

    try {
      await this.client.init();
      this.lastValidatedAt = Date.now();
      const isGuest = this.client._guest;

      this.lastStatus = {
        state: "healthy",
        authenticated: !isGuest,
        isGuest,
        message: isGuest
          ? "Connected via Gemini Guest Mode (Read-only / Basic reasoning)."
          : "Personal Gemini Session authenticated successfully via __Secure-1PSID.",
        lastValidatedAt: this.lastValidatedAt,
      };
    } catch (err: unknown) {
      const classified = classifyGeminiError(err, this.config);
      this.lastStatus = {
        state: classified.category === "AUTH_EXPIRED" ? "expired" : "error",
        authenticated: false,
        isGuest: !this.config.secure1PSID,
        message: classified.message,
        lastValidatedAt: Date.now(),
      };
    }

    return this.lastStatus;
  }

  public getStatus(): SessionStatus {
    return this.lastStatus;
  }

  public async generate(request: AIRequest): Promise<AIResponse> {
    if (!this.client) {
      throw new ClassifiedGeminiError("UNKNOWN", "Gemini client not initialized", false);
    }

    const startTime = Date.now();

    // Construct prompt with system instructions and conversation context
    let fullPrompt = "";
    if (request.systemInstruction) {
      fullPrompt += `[System Directives]\n${request.systemInstruction}\n\n`;
    }

    if (request.conversationHistory && request.conversationHistory.length > 0) {
      fullPrompt += `[Context & History]\n`;
      for (const msg of request.conversationHistory) {
        fullPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
      }
      fullPrompt += `\n[Current Task / Input]\n${request.prompt}\n`;
    } else {
      fullPrompt += request.prompt;
    }

    const chat = this.client.newChat();
    const result = await chat.generateContent({
      prompt: fullPrompt,
      model: request.model || this.config.model,
    });

    const durationMs = Date.now() - startTime;
    const text = result?.text || "";
    const thoughts = result?.thought || undefined;

    return {
      text,
      model: request.model || this.config.model,
      durationMs,
      thoughts,
      finishReason: "stop",
    };
  }

  public async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
    }
  }
}
