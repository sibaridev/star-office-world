import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { MeetingEngine } from "../dist/agents/meeting/MeetingEngine.js";
import { MeetingStore } from "../dist/agents/meeting/MeetingStore.js";
import { TaskManager } from "../dist/agents/tasks/TaskManager.js";
import { SSEManager } from "../dist/sse.js";
import { MemoStore } from "../dist/memo-store.js";
import { createInitialState, addAgent } from "../dist/state.js";
import { DEFAULT_AGENTS } from "../dist/agents/core/AgentRegistry.js";
import { createStarOfficeWorld } from "../dist/index.js";

function setupTestEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-meeting-test-"));
  const memoDir = path.join(tempDir, "memos");
  fs.mkdirSync(memoDir, { recursive: true });

  const sse = new SSEManager(60_000);
  const memoStore = new MemoStore(memoDir);
  const officeState = createInitialState({ worldId: "meeting-test-world", port: 19995 });
  for (const a of DEFAULT_AGENTS) {
    addAgent(officeState, a.agentId, a.name, a.avatar, "idle", a.role, a.isMain);
  }
  const taskManager = new TaskManager(tempDir);

  let turn = 0;
  const mockAI = {
    async generate(opts) {
      turn++;
      if (turn === 1) {
        // Turn 1: Alex opens meeting and calls on Nova
        return {
          text: JSON.stringify({
            action: "speak",
            content: "Welcome team to our sprint meeting. Nova, what is the status of Antigravity CLI and bridge stability?",
            callingOn: "agent_nova",
            thought: "Opening meeting and asking Nova for engineering status",
          }),
        };
      } else if (turn === 2) {
        // Turn 2: Nova responds
        return {
          text: JSON.stringify({
            action: "speak",
            content: "Antigravity CLI v1.5.14 is verified and connected. We have full tool access and clean git status.",
            thought: "Giving status update",
          }),
        };
      } else if (turn === 3) {
        // Turn 3: Alex calls on Robin
        return {
          text: JSON.stringify({
            action: "speak",
            content: "Great to hear. Robin, what did your research find on multi-agent execution scalability?",
            callingOn: "agent_researcher",
            thought: "Asking researcher",
          }),
        };
      } else if (turn === 4) {
        // Turn 4: Robin responds
        return {
          text: JSON.stringify({
            action: "speak",
            content: "Non-blocking supervisor polling scales seamlessly without thread contention.",
            thought: "Reporting research findings",
          }),
        };
      } else {
        // Turn 5: Conclude meeting
        return {
          text: JSON.stringify({
            action: "conclude",
            summary: "Team aligned on Antigravity stability and supervisor performance.",
            decisions: [
              "Approved Antigravity CLI v1.5.14 as baseline",
              "Standardized on non-blocking supervisor polling",
            ],
            actionItems: [
              {
                id: "act_1",
                title: "Run Antigravity verification test",
                description: "Execute e2e tests against repository root",
                assignedAgentId: "agent_nova",
                priority: "high",
              },
              {
                id: "act_2",
                title: "Document meeting guidelines",
                description: "Compile meeting system protocol into technical specifications",
                assignedAgentId: "agent_writer",
                priority: "medium",
              },
            ],
            thought: "All agenda items satisfied",
          }),
        };
      }
    },
  };

  const engine = new MeetingEngine({
    officeState,
    sse,
    memoStore,
    taskManager,
    aiProvider: mockAI,
    dataDir: tempDir,
  });

  return { tempDir, engine, sse, memoStore, taskManager, officeState, mockAI };
}

test("1. MeetingEngine: Starts meeting, moderates turns, and handles agent conversation", async (t) => {
  const { tempDir, engine, sse, officeState } = setupTestEnv();
  t.after(() => {
    engine.shutdown();
    sse.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Start meeting
  const meeting = await engine.startMeeting({
    title: "Engineering Alignment",
    agenda: "Review Antigravity CLI and multi-agent scalability",
    participantIds: ["agent_coordinator", "agent_nova", "agent_researcher"],
    initialNote: "Owner directive: Focus on stability",
  });

  assert.ok(meeting);
  assert.equal(meeting.title, "Engineering Alignment");
  assert.equal(meeting.status, "IN_PROGRESS");
  assert.equal(meeting.leadAgentId, "agent_coordinator");
  assert.equal(meeting.messages.length, 1); // initial note
  assert.equal(meeting.messages[0].senderId, "human_owner");

  // Visual state check: agents in meeting should have 'syncing' state
  assert.equal(officeState.agents["agent_coordinator"]?.state, "syncing");
  assert.equal(officeState.agents["agent_nova"]?.state, "syncing");

  // Execute Turn 1 (Alex opens)
  await engine.processMeetingTurn(meeting.id);
  const m1 = engine.getMeeting(meeting.id);
  assert.ok(m1);
  assert.equal(m1.messages.length, 2);
  const alexOpen = m1.messages[1];
  assert.equal(alexOpen.senderId, "agent_coordinator");
  assert.equal(alexOpen.callingOnAgentId, "agent_nova");
  assert.ok(alexOpen.content.includes("Nova, what is the status"));

  // Execute Turn 2 (Nova responds)
  await engine.processMeetingTurn(meeting.id);
  const m2 = engine.getMeeting(meeting.id);
  assert.equal(m2.messages.length, 3);
  const novaMsg = m2.messages[2];
  assert.equal(novaMsg.senderId, "agent_nova");
  assert.ok(novaMsg.content.includes("Antigravity CLI v1.5.14 is verified"));
});

test("2. Meeting Human-in-the-Loop: Owner speaks into meeting and Alex responds", async (t) => {
  const { tempDir, engine, sse } = setupTestEnv();
  t.after(() => {
    engine.shutdown();
    sse.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const meeting = await engine.startMeeting({
    title: "Product Roadmap",
    agenda: "Define next milestones",
    participantIds: ["agent_coordinator", "agent_writer"],
  });

  // Human speaks
  const humanMsg = await engine.postHumanMessage(
    meeting.id,
    "Can we make sure we have documentation ready by Friday?"
  );
  assert.ok(humanMsg);
  assert.equal(humanMsg.senderId, "human_owner");
  assert.equal(humanMsg.senderName, "Owner");

  const updatedMeeting = engine.getMeeting(meeting.id);
  assert.ok(updatedMeeting.messages.some((m) => m.content.includes("by Friday")));
});

test("3. Conclude Meeting: Generates Minutes and spawns TaskManager Action Items", async (t) => {
  const { tempDir, engine, sse, taskManager, officeState, memoStore } = setupTestEnv();
  t.after(() => {
    engine.shutdown();
    sse.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const meeting = await engine.startMeeting({
    title: "Sprint Sign-Off",
    agenda: "Finalize action items",
    participantIds: ["agent_coordinator", "agent_nova", "agent_writer"],
  });

  // Explicit conclusion with action items
  const minutes = await engine.concludeMeeting(
    meeting.id,
    "Executive summary of sprint sign-off.",
    ["Deploy new features", "Run test suite"],
    [
      {
        id: "act_deploy",
        title: "Deploy Star Office World update",
        description: "Run tsc build and restart server",
        assignedAgentId: "agent_nova",
        priority: "high",
      },
      {
        id: "act_docs",
        title: "Update user manual",
        description: "Document meeting command in handbook",
        assignedAgentId: "agent_writer",
        priority: "medium",
      },
    ]
  );

  assert.ok(minutes);
  assert.equal(minutes.decisions.length, 2);
  assert.equal(minutes.actionItems.length, 2);

  // Verify tasks were spawned in TaskManager!
  const novaTaskId = minutes.actionItems[0].taskId;
  const writerTaskId = minutes.actionItems[1].taskId;
  assert.ok(novaTaskId, "Action item must have spawned taskId");
  assert.ok(writerTaskId, "Action item must have spawned taskId");

  const task1 = taskManager.getTask(novaTaskId);
  const task2 = taskManager.getTask(writerTaskId);
  assert.ok(task1);
  assert.equal(task1.assignedAgentId, "agent_nova");
  assert.equal(task1.priority, "high");
  assert.ok(task2);
  assert.equal(task2.assignedAgentId, "agent_writer");

  // Verify meeting status and visual states reset
  const concludedMeeting = engine.getMeeting(meeting.id);
  assert.equal(concludedMeeting.status, "CONCLUDED");
  assert.equal(officeState.agents["agent_coordinator"]?.state, "idle");
  assert.equal(officeState.agents["agent_nova"]?.state, "idle");

  // Verify memo in store
  const memos = memoStore.getToday();
  assert.ok(memos.some((m) => m.content.includes("Concluded meeting")));
});

test("4. MeetingStore Persistence: Meetings survive store reload", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-store-test-"));
  try {
    const store1 = new MeetingStore(tempDir);
    const meeting = {
      id: "meeting_persist_1",
      title: "Architecture Session",
      agenda: "Review persistence",
      leadAgentId: "agent_coordinator",
      participantIds: ["agent_coordinator", "agent_nova"],
      status: "CONCLUDED",
      turnCount: 4,
      messages: [
        {
          id: "msg_1",
          senderId: "agent_coordinator",
          senderName: "Alex",
          senderAvatar: "guest_role_1",
          senderRole: "Lead",
          content: "Let's review the persistence engine.",
          timestamp: Date.now(),
        },
      ],
      minutes: {
        title: "Architecture Session",
        agenda: "Review persistence",
        summary: "Persistence approved",
        decisions: ["Use JSON on disk"],
        actionItems: [],
        concludedAt: Date.now(),
        concludedBy: "Alex",
      },
      createdAt: Date.now(),
      startedAt: Date.now(),
      concludedAt: Date.now(),
    };

    store1.saveMeeting(meeting);

    // Create fresh store instance on same directory
    const store2 = new MeetingStore(tempDir);
    const loaded = store2.getMeeting("meeting_persist_1");
    assert.ok(loaded);
    assert.equal(loaded.title, "Architecture Session");
    assert.equal(loaded.messages.length, 1);
    assert.equal(loaded.minutes?.summary, "Persistence approved");

    const list = store2.listMeetings();
    assert.equal(list.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("5. REST API Endpoints: Meetings API works end-to-end over HTTP", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-office-http-meeting-"));
  const testPort = 19994;

  const server = await createStarOfficeWorld({
    worldId: "test-meeting-api-world",
    port: testPort,
    dataDir: tempDir,
    enableAgentRuntime: true,
    isPublic: false,
  });

  t.after(async () => {
    server.runtime?.shutdown();
    server.sse.destroy();
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;
  const closeHeaders = { Connection: "close" };

  // 1. GET /api/meetings/active -> should be null initially
  const activeRes1 = await fetch(`${baseUrl}/api/meetings/active`, { headers: closeHeaders });
  assert.equal(activeRes1.status, 200);
  const activeData1 = await activeRes1.json();
  assert.equal(activeData1.ok, true);
  assert.equal(activeData1.meeting, null);

  // 2. POST /api/meetings/start
  const startRes = await fetch(`${baseUrl}/api/meetings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...closeHeaders },
    body: JSON.stringify({
      title: "Q4 Alignment Meeting",
      agenda: "Review engineering roadmap",
      participantIds: ["agent_coordinator", "agent_nova", "agent_reviewer"],
      initialNote: "Focus on zero false completions",
    }),
  });
  assert.equal(startRes.status, 201);
  const startData = await startRes.json();
  assert.equal(startData.ok, true);
  assert.equal(startData.meeting.title, "Q4 Alignment Meeting");
  const meetingId = startData.meeting.id;

  // 3. GET /api/meetings/active -> should now return the active meeting
  const activeRes2 = await fetch(`${baseUrl}/api/meetings/active`, { headers: closeHeaders });
  const activeData2 = await activeRes2.json();
  assert.equal(activeData2.meeting.id, meetingId);

  // 4. POST /api/meetings/:id/speak (Owner intervention)
  const speakRes = await fetch(`${baseUrl}/api/meetings/${meetingId}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...closeHeaders },
    body: JSON.stringify({ content: "Alex, please prioritize test coverage." }),
  });
  assert.equal(speakRes.status, 200);
  const speakData = await speakRes.json();
  assert.equal(speakData.ok, true);
  assert.equal(speakData.message.senderId, "human_owner");

  // 5. POST /api/meetings/:id/conclude
  const concludeRes = await fetch(`${baseUrl}/api/meetings/${meetingId}/conclude`, {
    method: "POST",
    headers: { ...closeHeaders },
  });
  assert.equal(concludeRes.status, 200);
  const concludeData = await concludeRes.json();
  assert.equal(concludeData.ok, true);
  assert.ok(concludeData.minutes);

  // 6. GET /api/meetings -> list should contain the completed meeting
  const listRes = await fetch(`${baseUrl}/api/meetings`, { headers: closeHeaders });
  const listData = await listRes.json();
  assert.equal(listData.ok, true);
  assert.ok(listData.meetings.length >= 1);
  assert.equal(listData.meetings[0].id, meetingId);
});
