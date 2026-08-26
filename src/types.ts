export type TraceEventType = 'user' | 'assistant' | 'tool_call' | 'tool_result';

export interface UserEvent {
  type: 'user';
  ts?: number;
  text?: string;
}

export interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface AssistantEvent {
  type: 'assistant';
  ts?: number;
  text?: string;
  usage?: AssistantUsage;
}

export interface ToolCallEvent {
  type: 'tool_call';
  ts?: number;
  id?: string;
  name: string;
  args?: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  ts?: number;
  id?: string;
  ok?: boolean;
  durationMs?: number;
  output?: string;
}

export type TraceEvent = UserEvent | AssistantEvent | ToolCallEvent | ToolResultEvent;

// One entry per line that parseTrace could not turn into a TraceEvent. Kept
// alongside the raw text and line number so a caller can show the operator
// exactly what to go fix, rather than just "3 lines were skipped".
export interface ParseIssue {
  line: number;
  message: string;
  raw: string;
}

// One tool_call joined with the tool_result that closed it, if any. `ok` and
// `durationMs` mirror the result once it arrives; a span with no result yet
// (or ever) stays `pending`.
export interface ToolSpan {
  name: string;
  id?: string;
  call: ToolCallEvent;
  result?: ToolResultEvent;
  ok?: boolean;
  durationMs?: number;
  pending: boolean;
}

export interface PairResult {
  spans: ToolSpan[];
  orphans: ToolResultEvent[];
}

// Per-tool row in the stats table. Only spans with a known durationMs count
// towards calls/totalMs/avgMs/maxMs -- a pending call has nothing to time yet,
// so it is reflected in TraceStats.toolCallsPending instead of here.
export interface ToolStat {
  name: string;
  calls: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  timeShare: number;
}

export interface TraceStats {
  eventCounts: Record<TraceEventType, number>;
  totalEvents: number;
  wallClockMs: number;
  toolTimeMs: number;
  toolTimeShare: number;
  toolCalls: number;
  toolCallsCompleted: number;
  toolCallsPending: number;
  toolCallsFailed: number;
  toolFailureRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tools: ToolStat[];
  orphanResults: number;
}
