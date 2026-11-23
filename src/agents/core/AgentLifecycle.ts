/**
 * Star Office World — Agent Lifecycle State Machine
 */

import type { AgentRuntimeState } from "./AgentTypes.js";
import type { AgentState, OfficeArea } from "../../types.js";

/**
 * Valid transitions between AgentRuntimeState states.
 */
const VALID_TRANSITIONS: Record<AgentRuntimeState, AgentRuntimeState[]> = {
  CREATED: ["INITIALIZING", "OFFLINE"],
  INITIALIZING: ["IDLE", "ERROR", "OFFLINE"],
  IDLE: ["RECEIVING_TASK", "THINKING", "EXECUTING", "PAUSED", "OFFLINE"],
  RECEIVING_TASK: ["THINKING", "EXECUTING", "ERROR", "PAUSED"],
  THINKING: ["EXECUTING", "COMMUNICATING", "WAITING", "COMPLETED", "ERROR", "PAUSED"],
  EXECUTING: ["THINKING", "COMMUNICATING", "WAITING", "COMPLETED", "ERROR", "PAUSED"],
  COMMUNICATING: ["THINKING", "EXECUTING", "WAITING", "COMPLETED", "ERROR", "PAUSED"],
  WAITING: ["THINKING", "EXECUTING", "COMPLETED", "ERROR", "PAUSED", "IDLE"],
  COMPLETED: ["IDLE", "RECEIVING_TASK", "OFFLINE"],
  ERROR: ["IDLE", "OFFLINE"],
  PAUSED: ["IDLE", "RECEIVING_TASK", "THINKING", "EXECUTING", "OFFLINE"],
  OFFLINE: ["INITIALIZING", "IDLE"],
};

/**
 * Maps granular runtime state to Star Office World visual agent state.
 */
export function mapRuntimeToOfficeState(runtimeState: AgentRuntimeState): AgentState {
  switch (runtimeState) {
    case "CREATED":
    case "INITIALIZING":
    case "IDLE":
    case "COMPLETED":
    case "PAUSED":
    case "OFFLINE":
      return "idle";
    case "RECEIVING_TASK":
    case "COMMUNICATING":
      return "syncing";
    case "THINKING":
      return "researching";
    case "EXECUTING":
      return "executing";
    case "WAITING":
      return "writing";
    case "ERROR":
      return "error";
    default:
      return "idle";
  }
}

export class AgentLifecycle {
  private currentState: AgentRuntimeState;
  private stateChangedAt: number;
  private history: Array<{ state: AgentRuntimeState; timestamp: number; reason?: string }> = [];

  constructor(initialState: AgentRuntimeState = "CREATED") {
    this.currentState = initialState;
    this.stateChangedAt = Date.now();
    this.history.push({ state: initialState, timestamp: this.stateChangedAt });
  }

  public get state(): AgentRuntimeState {
    return this.currentState;
  }

  public get officeVisualState(): AgentState {
    return mapRuntimeToOfficeState(this.currentState);
  }

  public get durationInCurrentStateMs(): number {
    return Date.now() - this.stateChangedAt;
  }

  public getHistory(): Array<{ state: AgentRuntimeState; timestamp: number; reason?: string }> {
    return [...this.history];
  }

  public get lastTransition(): { state: AgentRuntimeState; timestamp: number; reason?: string } | undefined {
    return this.history[this.history.length - 1];
  }

  public transition(newState: AgentRuntimeState, reason?: string): boolean {
    if (this.currentState === newState) return true;

    const allowed = VALID_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.includes(newState)) {
      console.warn(
        `[agent-lifecycle] Illegal state transition from ${this.currentState} to ${newState} (reason: ${reason})`
      );
      return false;
    }

    this.currentState = newState;
    this.stateChangedAt = Date.now();
    this.history.push({ state: newState, timestamp: this.stateChangedAt, reason });

    // Limit history length
    if (this.history.length > 50) {
      this.history.shift();
    }
    return true;
  }
}
