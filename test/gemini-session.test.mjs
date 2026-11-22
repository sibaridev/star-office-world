import test from "node:test";
import assert from "node:assert/strict";
import { GeminiSessionProvider } from "../dist/ai/providers/gemini/GeminiSessionProvider.js";
import { sanitizeLog } from "../dist/ai/providers/gemini/GeminiSessionConfig.js";
import { classifyGeminiError } from "../dist/ai/providers/gemini/GeminiErrorHandler.js";
import { GeminiRateLimiter } from "../dist/ai/providers/gemini/GeminiRateLimiter.js";

test("GeminiSessionConfig — sanitizeLog redacts session cookies from logs and messages", () => {
  const secretPSID = "sample_secret_cookie_token_12345";
  const secretPSIDTS = "sample_ts_token_67890";
  const logMsg = `Error connecting with cookie __Secure-1PSID=${secretPSID}; __Secure-1PSIDTS=${secretPSIDTS}`;

  const clean = sanitizeLog(logMsg, {
    secure1PSID: secretPSID,
    secure1PSIDTS: secretPSIDTS,
  });

  assert.ok(!clean.includes(secretPSID), "Log must not contain __Secure-1PSID secret");
  assert.ok(!clean.includes(secretPSIDTS), "Log must not contain __Secure-1PSIDTS secret");
  assert.ok(clean.includes("[REDACTED"), "Log must replace cookies with redaction placeholder");
});

test("GeminiErrorHandler — classifies errors accurately", () => {
  const authErr = new Error("AuthError: Cookies invalid. __Secure-1PSID required");
  const classifiedAuth = classifyGeminiError(authErr);
  assert.equal(classifiedAuth.category, "AUTH_EXPIRED");
  assert.equal(classifiedAuth.retryable, false);

  const rateErr = new Error("Too Many Requests 429: IP_TEMPORARILY_BLOCKED");
  const classifiedRate = classifyGeminiError(rateErr);
  assert.equal(classifiedRate.category, "RATE_LIMITED");
  assert.equal(classifiedRate.retryable, true);

  const timeoutErr = new Error("ETIMEDOUT connection timed out");
  const classifiedTimeout = classifyGeminiError(timeoutErr);
  assert.equal(classifiedTimeout.category, "NETWORK_TIMEOUT");
  assert.equal(classifiedTimeout.retryable, true);
});

test("GeminiRateLimiter — enforces concurrency limit of 1 and queue processing", async () => {
  const limiter = new GeminiRateLimiter({
    authMode: "guest",
    enabled: true,
    model: "gemini-2.5-flash",
    maxConcurrentRequests: 1,
    retryAttempts: 1,
    requestTimeoutMs: 10000,
  });

  let maxObservedActive = 0;
  let active = 0;

  const mockTask = async (id, durationMs) => {
    return limiter.enqueue(async () => {
      active++;
      if (active > maxObservedActive) maxObservedActive = active;
      await new Promise((r) => setTimeout(r, durationMs));
      active--;
      return `result_${id}`;
    });
  };

  const results = await Promise.all([
    mockTask(1, 30),
    mockTask(2, 20),
    mockTask(3, 10),
  ]);

  assert.deepEqual(results, ["result_1", "result_2", "result_3"]);
  assert.equal(maxObservedActive, 1, "Concurrency must never exceed 1");
  assert.equal(limiter.totalRequests, 3);
  assert.equal(limiter.successfulRequests, 3);
});

test("GeminiSessionProvider — initializes safely with guest status when credentials absent", async () => {
  const provider = new GeminiSessionProvider({
    authMode: "guest",
    secure1PSID: undefined,
  });

  const health = await provider.getHealth();
  assert.equal(health.provider, "gemini-session");
  assert.equal(health.session.authenticated, false);
  assert.equal(health.session.isGuest, true);
  await provider.shutdown();
});
