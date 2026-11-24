#!/usr/bin/env node
/**
 * Standalone Moroccan Darija Joke Cadence Script (TypeScript)
 *
 * Emits an authentic Moroccan Darija joke every 5000ms (configurable)
 * with strict iteration capping (default 5) and clean SIGINT/Abort teardown.
 *
 * Usage:
 *   npx tsx scripts/darija_joke_cadence.ts [--interval=5000] [--max-iterations=5] [--immediate]
 */

import { DarijaJokeCadenceController, formatJoke, CadenceOptions } from "../src/darija_joke_cadence.js";

function parseArgs(): { intervalMs: number; maxIterations: number; immediateFirstEmit: boolean } {
  const args = process.argv.slice(2);
  let intervalMs = Number(process.env.INTERVAL_MS) || 5000;
  let maxIterations = Number(process.env.MAX_ITERATIONS) || 5;
  let immediateFirstEmit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`
Moroccan Darija Joke Cadence Runner (TS)
----------------------------------------
Options:
  --interval, -i <ms>       Cadence interval in ms (default: 5000)
  --max-iterations, -n <n>  Max joke iteration cap (default: 5)
  --immediate               Emit first joke immediately without initial 5s delay
  --help, -h                Display this help message
`);
      process.exit(0);
    } else if (arg.startsWith("--interval=")) {
      intervalMs = parseInt(arg.split("=")[1], 10);
    } else if (arg === "-i" && i + 1 < args.length) {
      intervalMs = parseInt(args[++i], 10);
    } else if (arg.startsWith("--max-iterations=")) {
      maxIterations = parseInt(arg.split("=")[1], 10);
    } else if (arg === "-n" && i + 1 < args.length) {
      maxIterations = parseInt(args[++i], 10);
    } else if (arg === "--immediate") {
      immediateFirstEmit = true;
    }
  }

  return { intervalMs, maxIterations, immediateFirstEmit };
}

async function main(): Promise<void> {
  const { intervalMs, maxIterations, immediateFirstEmit } = parseArgs();

  console.log("================================================================================");
  console.log("            MOROCCAN DARIJA JOKE CADENCE CONTROLLER (TS BOUNDED)               ");
  console.log("================================================================================");
  console.log(`[Config] Interval: ${intervalMs}ms | Iteration Cap: ${maxIterations} | Immediate First: ${immediateFirstEmit}`);
  console.log("[Info] Press Ctrl+C at any time to invoke clean stop & resource teardown.\n");

  const abortController = new AbortController();

  const controller = new DarijaJokeCadenceController({
    intervalMs,
    maxIterations,
    immediateFirstEmit,
    signal: abortController.signal,
    onJoke: (joke, iteration, totalExpected) => {
      console.log(formatJoke(joke, iteration, totalExpected));
    },
    onComplete: (result) => {
      console.log(`\n[Cadence Finished] Total jokes emitted: ${result.totalEmitted} | Stop Reason: ${result.reason}`);
    },
  });

  const handleSignal = (sig: string) => {
    console.log(`\n\n[Signal] Received ${sig}. Triggering clean controller teardown...`);
    controller.stop();
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  const finalResult = await controller.start();

  console.log(`[Exit] Clean teardown verified. Active timer cleared: ${!controller.hasActiveTimer()}`);
  process.exit(finalResult.reason === "completed" || finalResult.reason === "stopped" ? 0 : 1);
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
