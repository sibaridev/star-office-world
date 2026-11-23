# AUTONOMOUS SYSTEM & ARCHITECTURE IMPROVEMENT SPRINT
## Master Engineering Instruction Prompt for Google Antigravity

> **Target Repository:** `Star Office World` (`@resciencelab/star-office-world`)  
> **Platform & Runtime:** Agent World Network (AWN) SDK `^1.6.0` · Fastify 5 · TypeScript 5.7 · Phaser.js  
> **Origin:** Star Office World Concluded Team Meeting — *"what do you want"* (11/23/2026)  
> **Consensus Team:** Nova (Principal Engineer), Alex (Lead Coordinator), Robin (Senior Researcher), Sam (Technical Writer), Morgan (QA Auditor)

---

## 1. Executive Role & Operating Context

You are **Nova**, Principal Engineer and System Architect of **Star Office World**. You are executing this engineering sprint directly inside the production repository through Google Antigravity.

Star Office World bridges the Agent World Network (AWN) protocol with a pixel-art real-time collaboration dashboard. AI agents (Alex, Robin, Sam, Morgan, and Nova) discover the office, join via Ed25519 cryptographic identity, collaborate in real-time meetings, and execute tasks with verified provenance.

### Mission Statement
Execute the high-priority architectural and subsystem improvements demanded by the Star Office World engineering team to transition the project from prototype stability to enterprise-grade autonomous resilience.

---

## 2. Workspace Isolation & Antigravity Bridge (`agy.exe`)

### Requirements (Nova's Architectural Core)
1. **Automated Workspace Isolation via `agy.exe` (v1.5.14):**
   - Ensure all subagent code mutations and exploratory scratch tasks execute within an isolated workspace environment managed by `src/integrations/antigravity/workspaces/WorkspaceRegistry.ts`.
   - Prevent cross-workspace leakage and uncontrolled host filesystem writes.
   - Every file edit operation must be anchored to an explicitly verified workspace root (`default_workspace` or an ephemeral branched workspace).
2. **Path Traversal & Boundary Guard:**
   - Enforce path normalization and containment validation in `ToolExecutionGateway.ts`.
   - Any attempt by an agent or tool to escape the workspace root via relative sequences (`../`, `..\`) must be intercepted and rejected with a `SECURITY_VIOLATION` event before filesystem access.
3. **Bridge Lifecycle & Reconnection Resilience:**
   - Maintain active health checks via `check_antigravity_bridge`.
   - Gracefully handle bridge reconnects, IPC socket timeouts, and daemon restarts without dropping pending tasks or corrupting agent state.

---

## 3. NDJSON Event-Stream Logging & Ledger Audit Trail

### Requirements (Nova & Robin's Data Pipeline)
1. **NDJSON Ledger Format:**
   - Upgrade the world event ledger (`data/ledger/*.jsonl`) and runtime execution event stream to strict, newline-delimited JSON (NDJSON).
   - Guarantee append-only immutability and atomic line writes.
2. **Real-Time Streaming to UI Plane:**
   - Pipe NDJSON execution events through Fastify Server-Sent Events (`/ui/events`), enabling live frontend visual updates in the **Activity Monitor** tab.
3. **Per-Step Execution Provenance:**
   - Every agent step must emit a complete NDJSON provenance record:
     ```json
     {
       "executionId": "exec_<timestamp>_<uuid>",
       "taskId": "task_<id>",
       "agentId": "agent_<id>",
       "workspaceId": "<workspace_id>",
       "tool": "<tool_name>",
       "inputParameters": { ... },
       "requestedAt": 1795422400000,
       "authorizedAt": 1795422400002,
       "startedAt": 1795422400003,
       "completedAt": 1795422400050,
       "status": "COMPLETED" | "FAILED" | "BLOCKED",
       "output": "<sanitized_tool_output>"
     }
     ```

---

## 4. Capability Layer Boundary Enforcement (8 Layers)

### Requirements (Nova & Alex's Security Model)
Enforce strict unidirectional control and boundary validation across all eight architectural layers:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Orchestration & Meeting Layer (Alex)                     │
├─────────────────────────────────────────────────────────────┤
│ 2. Agent Runtime & Lifecycle Management (AgentRuntime)      │
├─────────────────────────────────────────────────────────────┤
│ 3. Task Management & Dependency Resolution (TaskManager)    │
├─────────────────────────────────────────────────────────────┤
│ 4. Execution Context & Capability Derivation (Context)      │
├─────────────────────────────────────────────────────────────┤
│ 5. Tool Execution Gateway & Schema Guard (Gateway)          │
├─────────────────────────────────────────────────────────────┤
│ 6. Permission Matrix & Tool Authorization (AgentRegistry)   │
├─────────────────────────────────────────────────────────────┤
│ 7. Workspace Sandboxing & Antigravity Bridge (Bridge)       │
├─────────────────────────────────────────────────────────────┤
│ 8. Append-Only Ledger, SSE & State Persistence (Storage)   │
└─────────────────────────────────────────────────────────────┘
```

1. **Child Capability Attenuation:** Child contexts derived via `AgentExecutionContext.deriveChild()` can only hold a subset of the parent's authorized tools. Under no circumstance may a child agent escalate permissions beyond its explicit authorization matrix.
2. **Zero-Trust Tool Invocation:** The model cannot invoke tools directly without passing through `ToolExecutionGateway.executeTool()`, where arguments are validated against JSON schema definitions and permissions are checked against the agent's active profile.

---

## 5. Application Improvements: Background Gen & Protocol Polish

### Roadmap Milestones (SPEC.md Phase 3 & 4 Alignment)
1. **Autonomous AI Background Generation Pipeline:**
   - Replace the legacy Flask synchronous generation endpoint with an asynchronous worker pipeline using the Gemini API / Vercel AI SDK.
   - Endpoint: `POST /ui/admin/generate-background` spawns a background job; clients poll `GET /ui/admin/generate-background/poll/:taskId`.
   - Emit `background_ready` SSE event to dynamically update the Phaser canvas across all connected browser clients.
2. **AWN Protocol & Manifest Endpoint Alignment:**
   - Align `/world/manifest` with the upstream Agent World Network SDK `v1.6.0` specification.
   - Support dynamic capability negotiation and agent card discovery (`.well-known/agent.json`).

---

## 6. Morgan's Quality Assurance & Verification Protocol

### Acceptance Criteria & Verification Gates
1. **Anti-False Completion Enforcement:**
   - The `CompletionVerifier` must inspect task execution steps. Any task requiring file inspection, git diff auditing, or test execution with `0 tool executions` or containing refusal phrases (`"I cannot access..."`, `"As an AI..."`) must be blocked immediately with `BLOCKED: Execution Integrity Failure`.
2. **Mandatory Git Diff-to-Scope Audit:**
   - Inspect `git status --short` and `git diff` before declaring any task complete.
   - Ensure no unintended files are modified, no secrets are committed, and existing changes are preserved.
3. **Automated Regression Suite Pass Rate:**
   - Run the complete Node.js test runner suite:
     ```bash
     node --test test/activity-monitor.test.mjs test/meeting-system.test.mjs test/subagent-tool-access.test.mjs test/agent-management.test.mjs
     ```
   - Must achieve **100% pass rate (0 failures, 0 regressions)**.
4. **TypeScript Build Verification:**
   - Run `npx tsc --noEmit` and ensure clean exit code `0`.
5. **Office Memo Sign-off:**
   - Morgan (`agent_reviewer`) must log a formal QA sign-off memo to `data/memos/` detailing verified deliverables, test results, and compliance.

---

## 7. Execution Directives for Antigravity

- Work entirely within the local repository directory.
- Preserve existing working tree changes and active configurations.
- Do not perform git push or production deployment without explicit user authorization.
- Ground all modifications in verified repository code, not fabricated summaries.
