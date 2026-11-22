/**
 * Star Office World — Gemini Session Configuration
 */

import fs from "node:fs";

export interface GeminiSessionConfig {
  authMode: "session" | "guest" | "api";
  secure1PSID?: string;
  secure1PSIDTS?: string;
  enabled: boolean;
  model: string;
  maxConcurrentRequests: number;
  retryAttempts: number;
  requestTimeoutMs: number;
  proxy?: string;
}

export function loadGeminiSessionConfig(): GeminiSessionConfig {
  try {
    if (process.env["NODE_ENV"] !== "test" && typeof process.loadEnvFile === "function" && fs.existsSync(".env")) {
      process.loadEnvFile(".env");
    }
  } catch {
    // ignore
  }

  const secure1PSID = process.env["GEMINI_SECURE_1PSID"]?.trim() || undefined;
  const secure1PSIDTS = process.env["GEMINI_SECURE_1PSIDTS"]?.trim() || undefined;
  const authMode = (process.env["GEMINI_AUTH_MODE"] as "session" | "guest" | "api") || (secure1PSID ? "session" : "guest");

  const maxConcurrent = parseInt(process.env["GEMINI_MAX_CONCURRENT_REQUESTS"] ?? "1", 10);
  const retryAttempts = parseInt(process.env["GEMINI_RETRY_ATTEMPTS"] ?? "3", 10);
  const timeoutMs = parseInt(process.env["GEMINI_REQUEST_TIMEOUT"] ?? "120000", 10);

  return {
    authMode,
    secure1PSID,
    secure1PSIDTS,
    enabled: process.env["GEMINI_SESSION_ENABLED"] !== "false",
    model: process.env["GEMINI_MODEL"]?.trim() || "gemini-2.5-flash",
    maxConcurrentRequests: Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 1,
    retryAttempts: Number.isFinite(retryAttempts) && retryAttempts >= 0 ? retryAttempts : 3,
    requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 1000 ? timeoutMs : 120000,
    proxy: process.env["HTTP_PROXY"] || process.env["HTTPS_PROXY"] || undefined,
  };
}

/**
 * Sanitizes strings to prevent credential exposure in logs or UI
 */
export function sanitizeLog(text: string, config?: Partial<GeminiSessionConfig>): string {
  if (!text) return "";
  let clean = text;
  if (config?.secure1PSID) {
    clean = clean.split(config.secure1PSID).join("[REDACTED_1PSID]");
  }
  if (config?.secure1PSIDTS) {
    clean = clean.split(config.secure1PSIDTS).join("[REDACTED_1PSIDTS]");
  }
  // Generic pattern matching for __Secure-1PSID values
  clean = clean.replace(/__Secure-1PSID=([^;,\s]+)/g, "__Secure-1PSID=[REDACTED]");
  clean = clean.replace(/__Secure-1PSIDTS=([^;,\s]+)/g, "__Secure-1PSIDTS=[REDACTED]");
  return clean;
}
