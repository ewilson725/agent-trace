import type { PairResult, ToolCallEvent, ToolResultEvent, ToolSpan, TraceEvent } from './types.ts';

function durationOf(call: ToolCallEvent, result: ToolResultEvent): number | undefined {
  if (result.durationMs !== undefined) {
    return result.durationMs;
  }
  if (call.ts !== undefined && result.ts !== undefined) {
    return result.ts - call.ts;
  }
  return undefined;
}

// Joins tool_call events to the tool_result that closed them. Results carry
// an id when the runtime supports concurrent calls; when they don't, they
// close whichever call has been open longest, which is how sequential agents
// (call, wait, call, wait...) report back. A result with an id that matches
// no open call is an orphan rather than a guess at the wrong span -- an id
// mismatch usually means a bug in the runtime that produced the trace, and
// silently pairing it would hide that.
export function pairToolEvents(events: TraceEvent[]): PairResult {
  const open: ToolCallEvent[] = [];
  const spanByCall = new Map<ToolCallEvent, ToolSpan>();
  const spans: ToolSpan[] = [];
  const orphans: ToolResultEvent[] = [];

  for (const event of events) {
    if (event.type === 'tool_call') {
      const span: ToolSpan = { name: event.name, id: event.id, call: event, pending: true };
      spans.push(span);
      spanByCall.set(event, span);
      open.push(event);
      continue;
    }

    if (event.type !== 'tool_result') {
      continue;
    }

    const matchIndex = event.id !== undefined ? open.findIndex((call) => call.id === event.id) : open.length > 0 ? 0 : -1;

    if (matchIndex === -1) {
      orphans.push(event);
      continue;
    }

    const [call] = open.splice(matchIndex, 1);
    const span = spanByCall.get(call)!;
    span.result = event;
    span.pending = false;
    span.ok = event.ok;
    span.durationMs = durationOf(call, event);
  }

  return { spans, orphans };
}
