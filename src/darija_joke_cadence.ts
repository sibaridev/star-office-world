/**
 * Moroccan Darija Joke Cadence Controller
 *
 * Provides a bounded, timer-driven cadence engine for Moroccan Darija jokes
 * with strict iteration caps, explicit stop controls, and clean teardown.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface DarijaJoke {
  id: string;
  darija_text: string;
  transliteration: string;
  english_translation: string;
  category: string;
}

export type CadenceStatus = "idle" | "running" | "stopped" | "completed";

export type StopReason = "completed" | "stopped" | "aborted";

export interface CadenceResult {
  totalEmitted: number;
  reason: StopReason;
}

export interface CadenceOptions {
  /** Cadence emission interval in milliseconds. Defaults to 5000ms. */
  intervalMs?: number;
  /** Maximum number of joke iterations before automatic termination. Defaults to 5. */
  maxIterations?: number;
  /** Custom list of jokes. If omitted, loaded from datasetPath or default data directory. */
  jokes?: DarijaJoke[];
  /** File path to JSON jokes dataset. Defaults to 'data/darija_jokes.json'. */
  datasetPath?: string;
  /** Optional AbortSignal for explicit external stop condition. */
  signal?: AbortSignal;
  /** Callback fired whenever a joke is emitted. */
  onJoke?: (joke: DarijaJoke, iteration: number, totalExpected: number) => void;
  /** Callback fired when cadence terminates cleanly. */
  onComplete?: (result: CadenceResult) => void;
  /** Whether to emit the first joke immediately upon start. Defaults to false. */
  immediateFirstEmit?: boolean;
}

/**
 * Validates whether an unknown object conforms to the DarijaJoke contract.
 */
export function validateDarijaJoke(item: unknown): item is DarijaJoke {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.darija_text === "string" &&
    candidate.darija_text.trim().length > 0 &&
    typeof candidate.transliteration === "string" &&
    candidate.transliteration.trim().length > 0 &&
    typeof candidate.english_translation === "string" &&
    candidate.english_translation.trim().length > 0 &&
    typeof candidate.category === "string" &&
    candidate.category.trim().length > 0
  );
}

/**
 * Loads and validates Moroccan Darija jokes from a JSON file on disk.
 */
export function loadDarijaJokes(customPath?: string): DarijaJoke[] {
  let targetPath = customPath;

  if (!targetPath) {
    // 1. Try cwd/data/darija_jokes.json
    const cwdPath = path.resolve(process.cwd(), "data", "darija_jokes.json");
    if (fs.existsSync(cwdPath)) {
      targetPath = cwdPath;
    } else {
      // 2. Try relative to current module directory
      try {
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const relativeDataPath = path.resolve(currentDir, "..", "data", "darija_jokes.json");
        if (fs.existsSync(relativeDataPath)) {
          targetPath = relativeDataPath;
        }
      } catch {
        // Fallback to cwd path
        targetPath = cwdPath;
      }
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error(`Darija jokes dataset file not found at: ${targetPath}`);
  }

  const raw = fs.readFileSync(targetPath, "utf-8");
  const parsed = JSON.parse(raw);

  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray((parsed as Record<string, unknown>).jokes)
      ? ((parsed as Record<string, unknown>).jokes as unknown[])
      : [];

  if (list.length === 0) {
    throw new Error(`No jokes found in dataset file at: ${targetPath}`);
  }

  const validated: DarijaJoke[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!validateDarijaJoke(item)) {
      throw new Error(`Invalid joke entry at index ${i} in ${targetPath}`);
    }
    validated.push(item);
  }

  return validated;
}

/**
 * Formats a Darija joke for clean terminal or log output.
 */
export function formatJoke(joke: DarijaJoke, iteration: number, totalExpected: number): string {
  return [
    `--- [Joke ${iteration}/${totalExpected}] (ID: ${joke.id} | Category: ${joke.category}) ---`,
    `Darija:          ${joke.darija_text}`,
    `Transliteration: ${joke.transliteration}`,
    `English:         ${joke.english_translation}`,
    `--------------------------------------------------------------------------------`,
  ].join("\n");
}

/**
 * Bounded Cadence Controller for Moroccan Darija jokes.
 *
 * Enforces:
 * 1. Configurable cadence interval (default 5000ms).
 * 2. Strict maximum iteration cap (default 5 iterations).
 * 3. Explicit stop conditions: iteration cap, AbortSignal, or controller.stop().
 * 4. Deterministic resource teardown without lingering timers.
 */
export class DarijaJokeCadenceController {
  public readonly intervalMs: number;
  public readonly maxIterations: number;
  public readonly jokes: readonly DarijaJoke[];
  public readonly immediateFirstEmit: boolean;

  private timer: NodeJS.Timeout | null = null;
  private iterationCount = 0;
  private status: CadenceStatus = "idle";
  private abortSignal?: AbortSignal;
  private abortHandler: (() => void) | null = null;
  private onJokeCallback?: (joke: DarijaJoke, iteration: number, totalExpected: number) => void;
  private onCompleteCallback?: (result: CadenceResult) => void;
  private completionResolve: ((value: CadenceResult) => void) | null = null;
  private runningPromise: Promise<CadenceResult> | null = null;

  constructor(options: CadenceOptions = {}) {
    this.intervalMs = typeof options.intervalMs === "number" && options.intervalMs > 0
      ? options.intervalMs
      : 5000;

    this.maxIterations = typeof options.maxIterations === "number" && options.maxIterations >= 0
      ? options.maxIterations
      : 5;

    this.immediateFirstEmit = Boolean(options.immediateFirstEmit);
    this.abortSignal = options.signal;
    this.onJokeCallback = options.onJoke;
    this.onCompleteCallback = options.onComplete;

    if (options.jokes && options.jokes.length > 0) {
      for (let i = 0; i < options.jokes.length; i++) {
        if (!validateDarijaJoke(options.jokes[i])) {
          throw new Error(`Invalid joke provided in options.jokes at index ${i}`);
        }
      }
      this.jokes = Object.freeze([...options.jokes]);
    } else {
      this.jokes = Object.freeze(loadDarijaJokes(options.datasetPath));
    }
  }

  /**
   * Current cadence status.
   */
  public getStatus(): CadenceStatus {
    return this.status;
  }

  /**
   * Total number of jokes emitted so far.
   */
  public getIterationCount(): number {
    return this.iterationCount;
  }

  /**
   * Returns true if the controller is actively ticking.
   */
  public isActive(): boolean {
    return this.status === "running";
  }

  /**
   * Returns true if an active timer handle currently exists.
   */
  public hasActiveTimer(): boolean {
    return this.timer !== null;
  }

  /**
   * Starts the joke cadence.
   * Resolves when the cadence finishes (iteration cap reached, stop() called, or aborted).
   */
  public start(): Promise<CadenceResult> {
    if (this.status === "running" && this.runningPromise) {
      return this.runningPromise;
    }

    if (this.abortSignal?.aborted) {
      this.status = "stopped";
      const result: CadenceResult = { totalEmitted: this.iterationCount, reason: "aborted" };
      this.onCompleteCallback?.(result);
      return Promise.resolve(result);
    }

    if (this.maxIterations === 0) {
      this.status = "completed";
      const result: CadenceResult = { totalEmitted: 0, reason: "completed" };
      this.onCompleteCallback?.(result);
      return Promise.resolve(result);
    }

    this.status = "running";

    this.runningPromise = new Promise<CadenceResult>((resolve) => {
      this.completionResolve = resolve;

      // Attach AbortSignal listener if supplied
      if (this.abortSignal) {
        this.abortHandler = () => {
          this.teardown("aborted");
        };
        this.abortSignal.addEventListener("abort", this.abortHandler, { once: true });
      }

      // Handle immediate first emit if requested
      if (this.immediateFirstEmit) {
        this.emitNextJoke();
        if (this.iterationCount >= this.maxIterations) {
          this.teardown("completed");
          return;
        }
      }

      // Setup recurring timer interval
      this.timer = setInterval(() => {
        this.emitNextJoke();
        if (this.iterationCount >= this.maxIterations) {
          this.teardown("completed");
        }
      }, this.intervalMs);
    });

    return this.runningPromise;
  }

  /**
   * Explicit stop condition: halts cadence and releases all timer handles immediately.
   */
  public stop(): CadenceResult {
    if (this.status !== "running") {
      return {
        totalEmitted: this.iterationCount,
        reason: this.status === "completed" ? "completed" : "stopped",
      };
    }
    return this.teardown("stopped");
  }

  /**
   * Emits the next joke in round-robin sequence.
   */
  private emitNextJoke(): void {
    if (this.status !== "running") return;
    if (this.jokes.length === 0) return;

    const joke = this.jokes[this.iterationCount % this.jokes.length];
    this.iterationCount++;

    if (this.onJokeCallback) {
      try {
        this.onJokeCallback(joke, this.iterationCount, this.maxIterations);
      } catch (err) {
        // Callback errors should not leak or crash the cadence timer
        console.error("[DarijaCadence] Error inside onJoke callback:", err);
      }
    }
  }

  /**
   * Clean resource teardown: cancels timers, unhooks listeners, and finalizes state.
   */
  private teardown(reason: StopReason): CadenceResult {
    // 1. Clear timer immediately
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // 2. Detach abort listener
    if (this.abortSignal && this.abortHandler) {
      this.abortSignal.removeEventListener("abort", this.abortHandler);
      this.abortHandler = null;
    }

    // 3. Update status
    this.status = reason === "completed" ? "completed" : "stopped";

    const result: CadenceResult = {
      totalEmitted: this.iterationCount,
      reason,
    };

    // 4. Trigger onComplete callback
    if (this.onCompleteCallback) {
      try {
        this.onCompleteCallback(result);
      } catch (err) {
        console.error("[DarijaCadence] Error inside onComplete callback:", err);
      }
    }

    // 5. Resolve running promise
    if (this.completionResolve) {
      const resolve = this.completionResolve;
      this.completionResolve = null;
      resolve(result);
    }

    return result;
  }
}

/**
 * Convenience helper to start and return a cadence controller instance.
 */
export function startJokeCadence(options?: CadenceOptions): DarijaJokeCadenceController {
  const controller = new DarijaJokeCadenceController(options);
  controller.start().catch((err) => {
    console.error("[DarijaCadence] Unexpected cadence error:", err);
  });
  return controller;
}
