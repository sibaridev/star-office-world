import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  DarijaJokeCadenceController,
  loadDarijaJokes,
  validateDarijaJoke,
  formatJoke,
  startJokeCadence,
} from "../dist/darija_joke_cadence.js";

const execFileAsync = promisify(execFile);

// ============================================================================
// 1. DATASET & SCHEMA VERIFICATION
// ============================================================================

test("1. Darija Joke Dataset & Schema: Schema exists and is valid JSON Schema", () => {
  const schemaPath = path.resolve(process.cwd(), "data", "darija_jokes.schema.json");
  assert.ok(fs.existsSync(schemaPath), "data/darija_jokes.schema.json must exist");

  const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  assert.equal(schemaContent.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(schemaContent.type, "array");
  assert.ok(schemaContent.definitions?.DarijaJoke, "Schema must define DarijaJoke");

  const itemDef = schemaContent.definitions.DarijaJoke;
  assert.equal(itemDef.type, "object");
  const expectedRequired = ["id", "darija_text", "transliteration", "english_translation", "category"];
  for (const field of expectedRequired) {
    assert.ok(itemDef.required.includes(field), `Required schema fields must include '${field}'`);
    assert.ok(itemDef.properties[field], `Schema properties must define '${field}'`);
  }
});

test("2. Darija Joke Dataset: All entries in data/darija_jokes.json are valid and authentic", () => {
  const datasetPath = path.resolve(process.cwd(), "data", "darija_jokes.json");
  assert.ok(fs.existsSync(datasetPath), "data/darija_jokes.json must exist");

  const jokes = loadDarijaJokes(datasetPath);
  assert.ok(Array.isArray(jokes), "Jokes dataset must be an array");
  assert.ok(jokes.length >= 10, "Dataset must contain at least 10 authentic jokes");

  const seenIds = new Set();
  for (const joke of jokes) {
    assert.ok(validateDarijaJoke(joke), `Joke ${JSON.stringify(joke)} must be valid`);
    assert.ok(!seenIds.has(joke.id), `Joke ID '${joke.id}' must be unique`);
    seenIds.add(joke.id);

    // Verify non-empty fields
    assert.ok(joke.id.startsWith("joke-"), "Joke ID should follow 'joke-XXX' convention");
    assert.ok(joke.darija_text.length >= 5, "darija_text must have authentic content");
    assert.ok(joke.transliteration.length >= 5, "transliteration must have content");
    assert.ok(joke.english_translation.length >= 5, "english_translation must have content");
    assert.ok(joke.category.length >= 2, "category must be specified");
  }
});

test("3. validateDarijaJoke: Type guard handles edge cases and malformed objects", () => {
  assert.equal(validateDarijaJoke(null), false);
  assert.equal(validateDarijaJoke(undefined), false);
  assert.equal(validateDarijaJoke("a string"), false);
  assert.equal(validateDarijaJoke({}), false);
  assert.equal(
    validateDarijaJoke({
      id: "joke-001",
      darija_text: "text",
      transliteration: "trans",
      english_translation: "eng",
      // missing category
    }),
    false,
  );
  assert.equal(
    validateDarijaJoke({
      id: "joke-001",
      darija_text: "text",
      transliteration: "trans",
      english_translation: "eng",
      category: "", // empty category
    }),
    false,
  );
  assert.equal(
    validateDarijaJoke({
      id: "joke-001",
      darija_text: "text",
      transliteration: "trans",
      english_translation: "eng",
      category: "daily_life",
    }),
    true,
  );
});

test("4. formatJoke: Produces structured text with all fields and separators", () => {
  const sampleJoke = {
    id: "joke-test",
    darija_text: "واحد المش سولو فار...",
    transliteration: "Wahed l-mech sewel far...",
    english_translation: "A cat asked a mouse...",
    category: "animals",
  };

  const formatted = formatJoke(sampleJoke, 1, 5);
  assert.ok(formatted.includes("[Joke 1/5]"));
  assert.ok(formatted.includes("ID: joke-test"));
  assert.ok(formatted.includes("Category: animals"));
  assert.ok(formatted.includes("واحد المش سولو فار..."));
  assert.ok(formatted.includes("Wahed l-mech sewel far..."));
  assert.ok(formatted.includes("A cat asked a mouse..."));
});

// ============================================================================
// 2. TIMING & BOUNDED CADENCE VERIFICATION (5000ms and Mock Timers)
// ============================================================================

test("5. Cadence Controller Defaults: Uses 5000ms interval and 5 iteration cap by default", () => {
  const controller = new DarijaJokeCadenceController();
  assert.equal(controller.intervalMs, 5000, "Default intervalMs must be 5000ms");
  assert.equal(controller.maxIterations, 5, "Default maxIterations must be 5");
  assert.equal(controller.getStatus(), "idle");
  assert.equal(controller.getIterationCount(), 0);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.hasActiveTimer(), false);
});

test("6. 5s Interval Timing: Emits exactly one joke every 5000ms using mock timers", async (t) => {
  // Enable virtual mock timers
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });

  const emittedJokes = [];
  const controller = new DarijaJokeCadenceController({
    intervalMs: 5000,
    maxIterations: 5,
    onJoke: (joke, iteration) => {
      emittedJokes.push({ joke, iteration, time: Date.now() });
    },
  });

  const cadencePromise = controller.start();
  assert.equal(controller.getStatus(), "running");
  assert.equal(controller.hasActiveTimer(), true);

  // At t = 0ms: no jokes emitted yet (interval has not elapsed)
  assert.equal(emittedJokes.length, 0);

  // Advance 4999ms: still no jokes emitted
  t.mock.timers.tick(4999);
  assert.equal(emittedJokes.length, 0);

  // Advance 1ms (Total: 5000ms) -> Joke 1 emitted
  t.mock.timers.tick(1);
  assert.equal(emittedJokes.length, 1);
  assert.equal(emittedJokes[0].iteration, 1);

  // Advance 5000ms (Total: 10000ms) -> Joke 2 emitted
  t.mock.timers.tick(5000);
  assert.equal(emittedJokes.length, 2);
  assert.equal(emittedJokes[1].iteration, 2);

  // Advance 5000ms (Total: 15000ms) -> Joke 3 emitted
  t.mock.timers.tick(5000);
  assert.equal(emittedJokes.length, 3);
  assert.equal(emittedJokes[2].iteration, 3);

  // Advance 5000ms (Total: 20000ms) -> Joke 4 emitted
  t.mock.timers.tick(5000);
  assert.equal(emittedJokes.length, 4);
  assert.equal(emittedJokes[3].iteration, 4);

  // Advance 5000ms (Total: 25000ms) -> Joke 5 emitted & maxIterations cap reached!
  t.mock.timers.tick(5000);
  assert.equal(emittedJokes.length, 5);
  assert.equal(emittedJokes[4].iteration, 5);

  const result = await cadencePromise;
  assert.equal(result.totalEmitted, 5);
  assert.equal(result.reason, "completed");
  assert.equal(controller.getStatus(), "completed");
  assert.equal(controller.hasActiveTimer(), false, "Timer must be cleared after completion");
  assert.equal(controller.isActive(), false);
});

// ============================================================================
// 3. ITERATION CAP & TERMINATION VERIFICATION
// ============================================================================

test("7. Iteration Cap: Strictly terminates after configured iteration cap (custom cap = 3)", async () => {
  const emitted = [];
  const controller = new DarijaJokeCadenceController({
    intervalMs: 15, // Fast interval for rapid test execution
    maxIterations: 3,
    onJoke: (joke, iteration) => {
      emitted.push({ id: joke.id, iteration });
    },
  });

  const result = await controller.start();

  assert.equal(result.totalEmitted, 3);
  assert.equal(result.reason, "completed");
  assert.equal(emitted.length, 3);
  assert.equal(controller.getIterationCount(), 3);
  assert.equal(controller.getStatus(), "completed");
  assert.equal(controller.hasActiveTimer(), false);
});

test("8. Zero Iteration Cap: Terminates immediately without scheduling timer", async () => {
  let jokeCalled = false;
  const controller = new DarijaJokeCadenceController({
    intervalMs: 10,
    maxIterations: 0,
    onJoke: () => {
      jokeCalled = true;
    },
  });

  const result = await controller.start();
  assert.equal(result.totalEmitted, 0);
  assert.equal(result.reason, "completed");
  assert.equal(jokeCalled, false);
  assert.equal(controller.hasActiveTimer(), false);
  assert.equal(controller.getStatus(), "completed");
});

// ============================================================================
// 4. EXPLICIT STOP CONDITION (stop() & AbortSignal)
// ============================================================================

test("9. Explicit Stop Condition: Calling controller.stop() immediately halts cadence and cleans up", async () => {
  const emitted = [];
  const controller = new DarijaJokeCadenceController({
    intervalMs: 20,
    maxIterations: 10,
    onJoke: (joke, iteration) => {
      emitted.push(iteration);
      if (iteration === 2) {
        controller.stop();
      }
    },
  });

  const result = await controller.start();

  assert.equal(result.totalEmitted, 2);
  assert.equal(result.reason, "stopped");
  assert.equal(controller.getStatus(), "stopped");
  assert.equal(controller.hasActiveTimer(), false, "Active timer handle must be null after stop()");

  // Wait a moment to ensure no delayed ticks fire
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(emitted.length, 2, "No more jokes should be emitted after stop()");

  // Calling stop() again is idempotent
  const secondStop = controller.stop();
  assert.equal(secondStop.totalEmitted, 2);
  assert.equal(secondStop.reason, "stopped");
});

test("10. Explicit Stop Condition: AbortSignal triggers clean teardown and abort reason", async () => {
  const abortController = new AbortController();
  const emitted = [];

  const controller = new DarijaJokeCadenceController({
    intervalMs: 20,
    maxIterations: 10,
    signal: abortController.signal,
    onJoke: (joke, iteration) => {
      emitted.push(iteration);
      if (iteration === 1) {
        abortController.abort();
      }
    },
  });

  const result = await controller.start();

  assert.equal(result.totalEmitted, 1);
  assert.equal(result.reason, "aborted");
  assert.equal(controller.getStatus(), "stopped");
  assert.equal(controller.hasActiveTimer(), false, "Timer must be cleanly destroyed on abort");
});

test("11. Pre-aborted AbortSignal: start() resolves immediately without ticking", async () => {
  const abortController = new AbortController();
  abortController.abort();

  let jokeCalled = false;
  const controller = new DarijaJokeCadenceController({
    intervalMs: 10,
    maxIterations: 5,
    signal: abortController.signal,
    onJoke: () => {
      jokeCalled = true;
    },
  });

  const result = await controller.start();
  assert.equal(result.totalEmitted, 0);
  assert.equal(result.reason, "aborted");
  assert.equal(jokeCalled, false);
  assert.equal(controller.hasActiveTimer(), false);
});

// ============================================================================
// 5. IMMEDIATE FIRST EMIT MODE & ROUND ROBIN
// ============================================================================

test("12. Immediate First Emit: Emits joke 1 synchronously at start, then cadences remainder", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });

  const emitted = [];
  const controller = new DarijaJokeCadenceController({
    intervalMs: 5000,
    maxIterations: 2,
    immediateFirstEmit: true,
    onJoke: (joke, iteration) => {
      emitted.push(iteration);
    },
  });

  const cadencePromise = controller.start();

  // Emitted immediately at t = 0
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0], 1);

  // Tick 5000ms -> Joke 2 emitted and reaches cap of 2
  t.mock.timers.tick(5000);
  assert.equal(emitted.length, 2);

  const result = await cadencePromise;
  assert.equal(result.totalEmitted, 2);
  assert.equal(result.reason, "completed");
  assert.equal(controller.hasActiveTimer(), false);
});

test("13. Round Robin: Cycles through jokes gracefully when iterations exceed dataset length", async () => {
  const customJokes = [
    {
      id: "joke-a",
      darija_text: "نكتة ألف",
      transliteration: "Nokta Alf",
      english_translation: "Joke A",
      category: "short",
    },
    {
      id: "joke-b",
      darija_text: "نكتة باء",
      transliteration: "Nokta Ba",
      english_translation: "Joke B",
      category: "short",
    },
  ];

  const seenIds = [];
  const controller = new DarijaJokeCadenceController({
    intervalMs: 10,
    maxIterations: 5,
    jokes: customJokes,
    onJoke: (joke) => {
      seenIds.push(joke.id);
    },
  });

  const result = await controller.start();
  assert.equal(result.totalEmitted, 5);
  assert.deepEqual(seenIds, ["joke-a", "joke-b", "joke-a", "joke-b", "joke-a"]);
});

// ============================================================================
// 6. CLI SCRIPT EXECUTION INTEGRATION TEST
// ============================================================================

test("14. CLI Script: node scripts/darija_joke_cadence.js runs with flags and exits 0 cleanly", async () => {
  const scriptPath = path.resolve(process.cwd(), "scripts", "darija_joke_cadence.js");

  const { stdout, stderr } = await execFileAsync("node", [
    scriptPath,
    "--max-iterations=2",
    "--interval=50",
    "--immediate",
  ]);

  assert.equal(stderr.trim(), "", "CLI script should produce no error output");
  assert.ok(stdout.includes("MOROCCAN DARIJA JOKE CADENCE CONTROLLER"), "Should print banner");
  assert.ok(stdout.includes("Darija:"), "Should output Darija joke text");
  assert.ok(stdout.includes("Transliteration:"), "Should output Transliteration");
  assert.ok(stdout.includes("English:"), "Should output English translation");
  assert.ok(stdout.includes("Total jokes emitted: 2"), "Should report 2 emitted jokes");
  assert.ok(stdout.includes("Stop Reason: completed"), "Should exit with completed reason");
  assert.ok(stdout.includes("Active timer cleared: true"), "Should confirm clean timer teardown");
});
