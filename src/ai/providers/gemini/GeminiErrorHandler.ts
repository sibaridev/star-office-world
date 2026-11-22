/**
 * Star Office World — Gemini Error Classification
 */

import { sanitizeLog, type GeminiSessionConfig } from "./GeminiSessionConfig.js";

export type GeminiErrorCategory =
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "USAGE_LIMIT"
  | "MODEL_INVALID"
  | "NETWORK_TIMEOUT"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class ClassifiedGeminiError extends Error {
  public category: GeminiErrorCategory;
  public retryable: boolean;
  public statusCode?: number;

  constructor(category: GeminiErrorCategory, message: string, retryable = false, statusCode?: number) {
    super(message);
    this.name = "ClassifiedGeminiError";
    this.category = category;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export function classifyGeminiError(error: unknown, config?: GeminiSessionConfig): ClassifiedGeminiError {
  if (error instanceof ClassifiedGeminiError) {
    return error;
  }

  const rawMsg = error instanceof Error ? error.message : String(error);
  const cleanMsg = sanitizeLog(rawMsg, config);
  const errName = error instanceof Error ? error.name : "";

  // Auth errors
  if (errName === "AuthError" || cleanMsg.includes("Cookies invalid") || cleanMsg.includes("cookie required") || cleanMsg.includes("401") || cleanMsg.includes("Unauthorized")) {
    return new ClassifiedGeminiError("AUTH_EXPIRED", "Gemini session authentication has expired or is invalid.", false, 401);
  }

  // Rate limits / blocks
  if (errName === "UsageLimitExceeded" || cleanMsg.includes("1037") || cleanMsg.includes("UsageLimitExceeded") || cleanMsg.includes("quota")) {
    return new ClassifiedGeminiError("USAGE_LIMIT", "Personal Gemini account usage limit reached. Please wait for quota refresh.", false, 429);
  }

  if (errName === "TemporarilyBlocked" || cleanMsg.includes("1060") || cleanMsg.includes("IP_TEMPORARILY_BLOCKED") || cleanMsg.includes("Too Many Requests") || cleanMsg.includes("429")) {
    return new ClassifiedGeminiError("RATE_LIMITED", "Gemini request rate limit encountered. Throttling requests.", true, 429);
  }

  // Timeouts
  if (cleanMsg.includes("timeout") || cleanMsg.includes("ETIMEDOUT") || cleanMsg.includes("ECONNABORTED")) {
    return new ClassifiedGeminiError("NETWORK_TIMEOUT", "Gemini request timed out. Retrying may succeed.", true, 408);
  }

  // Model invalid
  if (errName === "ModelInvalid" || cleanMsg.includes("ModelInvalid") || cleanMsg.includes("1050")) {
    return new ClassifiedGeminiError("MODEL_INVALID", `Specified model is not available for this session.`, false, 400);
  }

  // Network / Server errors
  if (cleanMsg.includes("ECONNRESET") || cleanMsg.includes("500") || cleanMsg.includes("502") || cleanMsg.includes("503") || cleanMsg.includes("1013")) {
    return new ClassifiedGeminiError("SERVER_ERROR", "Temporary network or Google server failure.", true, 503);
  }

  return new ClassifiedGeminiError("UNKNOWN", cleanMsg || "Unknown Gemini provider error.", false);
}
