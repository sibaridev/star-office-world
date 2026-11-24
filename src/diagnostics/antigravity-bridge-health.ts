/**
 * Star Office World — Antigravity Bridge Health & Readiness Diagnostic
 * Provides a standalone inspection report of Antigravity CLI, workspace boundaries,
 * and active task states without mutating repository state.
 */

import type { AntigravityBridge } from "../integrations/antigravity/bridge/AntigravityBridge.js";

export interface BridgeHealthReport {
  timestamp: string;
  overallStatus: string;
  cliVersion: string;
  cliPath: string | null;
  workspaceCount: number;
  activeTaskCount: number;
  ready: boolean;
}

export async function collectBridgeHealthReport(bridge: AntigravityBridge): Promise<BridgeHealthReport> {
  const diag = await bridge.runDiagnostics();
  const workspaces = bridge.workspaces.listWorkspaces();
  const activeTasks = bridge.taskManager.listTasks({ status: "RUNNING_IN_ANTIGRAVITY" });

  return {
    timestamp: new Date().toISOString(),
    overallStatus: diag.overallStatus,
    cliVersion: diag.version || "unknown",
    cliPath: diag.detectedAgyPath || null,
    workspaceCount: workspaces.length,
    activeTaskCount: activeTasks.length,
    ready: diag.overallStatus === "CONNECTED",
  };
}
