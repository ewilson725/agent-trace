import { pairToolEvents } from './pair.ts';
import type { ToolSpan, ToolStat, TraceEvent, TraceEventType, TraceStats } from './types.ts';

// Wall clock is the span between the earliest and latest timestamp in the
// trace, not a sum of anything -- events overlap (a tool call and the
// assistant text that triggered it share roughly the same instant).
function wallClockOf(events: TraceEvent[]): number {
  let min: number | undefined;
  let max: number | undefined;
  for (const event of events) {
    if (event.ts === undefined) {
      continue;
    }
    if (min === undefined || event.ts < min) {
      min = event.ts;
    }
    if (max === undefined || event.ts > max) {
      max = event.ts;
    }
  }
  return min !== undefined && max !== undefined ? max - min : 0;
}

function groupByTool(spans: ToolSpan[]): Map<string, ToolSpan[]> {
  const byTool = new Map<string, ToolSpan[]>();
  for (const span of spans) {
    const list = byTool.get(span.name);
    if (list) {
      list.push(span);
    } else {
      byTool.set(span.name, [span]);
    }
  }
  return byTool;
}

export function computeStats(events: TraceEvent[]): TraceStats {
  const eventCounts: Record<TraceEventType, number> = {
    user: 0,
    assistant: 0,
    tool_call: 0,
    tool_result: 0,
  };
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    eventCounts[event.type]++;
    if (event.type === 'assistant' && event.usage) {
      inputTokens += event.usage.input_tokens ?? 0;
      outputTokens += event.usage.output_tokens ?? 0;
    }
  }

  const { spans, orphans } = pairToolEvents(events);
  const toolCallsPending = spans.filter((span) => span.pending).length;
  const toolCallsFailed = spans.filter((span) => span.ok === false).length;

  const tools: ToolStat[] = [];
  let toolTimeMs = 0;
  for (const [name, list] of groupByTool(spans)) {
    const timed = list.filter((span) => span.durationMs !== undefined);
    const totalMs = timed.reduce((sum, span) => sum + span.durationMs!, 0);
    toolTimeMs += totalMs;
    tools.push({
      name,
      calls: timed.length,
      failures: timed.filter((span) => span.ok === false).length,
      totalMs,
      avgMs: timed.length > 0 ? totalMs / timed.length : 0,
      maxMs: timed.reduce((max, span) => Math.max(max, span.durationMs!), 0),
      timeShare: 0, // filled in below once the grand total is known
    });
  }
  for (const tool of tools) {
    tool.timeShare = toolTimeMs > 0 ? tool.totalMs / toolTimeMs : 0;
  }
  tools.sort((a, b) => b.totalMs - a.totalMs);

  const wallClockMs = wallClockOf(events);

  return {
    eventCounts,
    totalEvents: events.length,
    wallClockMs,
    toolTimeMs,
    toolTimeShare: wallClockMs > 0 ? toolTimeMs / wallClockMs : 0,
    toolCalls: spans.length,
    toolCallsCompleted: spans.length - toolCallsPending,
    toolCallsPending,
    toolCallsFailed,
    toolFailureRate: spans.length > 0 ? toolCallsFailed / spans.length : 0,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    tools,
    orphanResults: orphans.length,
  };
}
