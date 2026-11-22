/**
 * Star Office World — Antigravity Integration Type Definitions
 */

export type AntigravityTaskStatus =
  | "PROMPT_PREPARATION"
  | "READY_FOR_SUBMISSION"
  | "SUBMITTED_TO_ANTIGRAVITY"
  | "ACCEPTED_BY_ANTIGRAVITY"
  | "RUNNING_IN_ANTIGRAVITY"
  | "WAITING_FOR_ANTIGRAVITY"
  | "REVIEW_REQUIRED"
  | "COMPLETED"
  | "FAILED"
  | "CONNECTION_UNAVAILABLE"
  // Backwards compatibility aliases
  | "QUEUED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_INPUT"
  | "CANCELLED"
  | "INTERRUPTED";

export type ConnectionState =
  | "NOT_INSTALLED"
  | "NOT_CONFIGURED"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "AUTHENTICATION_REQUIRED"
  | "UNSUPPORTED_INTERFACE"
  | "ERROR";

export interface CapabilityDiagnostic {
  name: string;
  status: ConnectionState;
  details: string;
  detectedPath?: string;
  version?: string;
}

export interface AntigravityDiagnostics {
  overallStatus: ConnectionState;
  summary: string;
  checkedAt: number;
  capabilities: {
    installationDetection: CapabilityDiagnostic;
    supportedInterfaceDetection: CapabilityDiagnostic;
    processAvailability: CapabilityDiagnostic;
    authenticationReadiness: CapabilityDiagnostic;
    workspaceDiscovery: CapabilityDiagnostic;
    taskSubmissionCapability: CapabilityDiagnostic;
    executionStatusRetrieval: CapabilityDiagnostic;
    resultRetrieval: CapabilityDiagnostic;
  };
  detectedAgyPath?: string;
  detectedIdePath?: string;
  runningProcesses: Array<{ pid: number; name: string; cmd?: string }>;
  version?: string;
}

export interface E2ETestResult {
  connectionId: string;
  executionId: string;
  workspaceId: string;
  submissionTimestamp: number;
  completedTimestamp?: number;
  executionStatus: AntigravityTaskStatus;
  prompt: string;
  actualResponse: string;
  error?: string;
  structuredReport?: {
    projectName?: string;
    techStack?: string[];
    repositoryStatus?: string;
    importantDirectories?: string[];
    rawOutput?: string;
  };
}

export type WorkspacePermission = "read" | "modify" | "test" | "git" | "network" | "destructive";

export interface WorkspaceConfig {
  workspaceId: string;
  name: string;
  path: string;
  allowedOperations: WorkspacePermission[];
  permissionPolicy: "strict" | "standard" | "permissive";
  gitInfo?: {
    isRepo: boolean;
    branch?: string;
    remote?: string;
    headCommit?: string;
  };
  activeTaskId?: string | null;
  status: "idle" | "busy" | "offline";
  createdAt: number;
  updatedAt: number;
}

export interface AntigravityTaskEvent {
  timestamp: number;
  type: string;
  message: string;
  data?: unknown;
}

export interface TaskClarification {
  id: string;
  question: string;
  answer?: string;
  askedAt: number;
  answeredAt?: number;
}

export interface AntigravityTask {
  id: string;
  workspaceId: string;
  title: string;
  engineeringPrompt: string;
  status: AntigravityTaskStatus;
  progress: number; // 0 - 100
  progressMessage: string;
  assignedOfficeAgentId: string;
  antigravitySessionId?: string;
  diff?: string;
  testResults?: string;
  result?: string;
  error?: string;
  events: AntigravityTaskEvent[];
  clarifications: TaskClarification[];
  followUpInstructions: Array<{ instruction: string; timestamp: number }>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  // Execution tracking
  executionMethod?: "agy_cli" | "ide_chat" | "mcp";
  executionId?: string;
  pid?: number;
}
