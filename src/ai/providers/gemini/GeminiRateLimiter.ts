/**
 * Star Office World — Gemini Rate Limiter and Concurrency Queue
 */

import { classifyGeminiError, ClassifiedGeminiError } from "./GeminiErrorHandler.js";
import type { GeminiSessionConfig } from "./GeminiSessionConfig.js";

interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  attempts: number;
  addedAt: number;
}

export class GeminiRateLimiter {
  private queue: QueueTask<unknown>[] = [];
  private activeCount = 0;
  private config: GeminiSessionConfig;

  // Metrics
  public totalRequests = 0;
  public successfulRequests = 0;
  public failedRequests = 0;
  public totalDurationMs = 0;

  constructor(config: GeminiSessionConfig) {
    this.config = config;
  }

  public get queueLength(): number {
    return this.queue.length;
  }

  public get activeRequests(): number {
    return this.activeCount;
  }

  public get averageDurationMs(): number {
    if (this.successfulRequests === 0) return 0;
    return Math.round(this.totalDurationMs / this.successfulRequests);
  }

  public enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (val: unknown) => void,
        reject,
        attempts: 0,
        addedAt: Date.now(),
      });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.config.maxConcurrentRequests) {
      return;
    }
    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    this.totalRequests++;
    const startTime = Date.now();

    try {
      const result = await item.fn();
      const duration = Date.now() - startTime;
      this.totalDurationMs += duration;
      this.successfulRequests++;
      item.resolve(result);
    } catch (err: unknown) {
      const classified = classifyGeminiError(err, this.config);

      // Check if retryable
      if (classified.retryable && item.attempts < this.config.retryAttempts) {
        item.attempts++;
        const backoffMs = Math.min(1000 * Math.pow(2, item.attempts), 10000);
        console.warn(
          `[gemini-limiter] Retryable error (${classified.category}): retrying in ${backoffMs}ms (attempt ${item.attempts}/${this.config.retryAttempts})`
        );
        setTimeout(() => {
          this.queue.unshift(item); // Push to front of queue
          this.processNext();
        }, backoffMs);
      } else {
        this.failedRequests++;
        item.reject(classified);
      }
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  public clear(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.reject(new ClassifiedGeminiError("UNKNOWN", "Request cancelled: queue cleared.", false));
      }
    }
  }
}
