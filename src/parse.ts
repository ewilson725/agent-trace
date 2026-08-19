import type { AssistantUsage, ParseIssue, TraceEvent } from './types.ts';

export type LineResult = { ok: true; event: TraceEvent } | { ok: false; issue: ParseIssue };

export interface ParseResult {
  events: TraceEvent[];
  issues: ParseIssue[];
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function coerceUsage(value: unknown): AssistantUsage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const input_tokens = coerceNumber(usage.input_tokens);
  const output_tokens = coerceNumber(usage.output_tokens);
  if (input_tokens === undefined && output_tokens === undefined) {
    return undefined;
  }
  return { input_tokens, output_tokens };
}

// Single-line parser so streaming callers (tail -f a live trace, read stdin
// as it arrives) don't have to buffer the whole file to get error locations.
// parseTrace below is just this run over every line of a complete file.
export function parseTraceLine(raw: string, line: number = 1): LineResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, issue: { line, message: 'empty line', raw } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, issue: { line, message: `invalid JSON: ${message}`, raw } };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issue: { line, message: 'not a JSON object', raw } };
  }

  const obj = parsed as Record<string, unknown>;
  const rawType = obj.type ?? obj.role;
  if (typeof rawType !== 'string') {
    return { ok: false, issue: { line, message: 'missing "type" (or "role") field', raw } };
  }

  const ts = coerceNumber(obj.ts ?? obj.timestamp);

  switch (rawType) {
    case 'user':
      return { ok: true, event: { type: 'user', ts, text: coerceString(obj.text) } };

    case 'assistant':
      return {
        ok: true,
        event: {
          type: 'assistant',
          ts,
          text: coerceString(obj.text),
          usage: coerceUsage(obj.usage),
        },
      };

    case 'tool_call': {
      const name = coerceString(obj.name ?? obj.tool);
      if (!name) {
        return { ok: false, issue: { line, message: 'tool_call missing "name" (or "tool") field', raw } };
      }
      return {
        ok: true,
        event: {
          type: 'tool_call',
          ts,
          id: coerceString(obj.id),
          name,
          args: obj.args ?? obj.arguments,
        },
      };
    }

    case 'tool_result':
      return {
        ok: true,
        event: {
          type: 'tool_result',
          ts,
          id: coerceString(obj.id),
          ok: typeof obj.ok === 'boolean' ? obj.ok : undefined,
          durationMs: coerceNumber(obj.durationMs),
          output: coerceString(obj.output),
        },
      };

    default:
      return { ok: false, issue: { line, message: `unknown type "${rawType}"`, raw } };
  }
}

export function parseTrace(text: string): ParseResult {
  const events: TraceEvent[] = [];
  const issues: ParseIssue[] = [];

  text.split('\n').forEach((raw, index) => {
    if (raw.trim().length === 0) {
      return;
    }
    const result = parseTraceLine(raw, index + 1);
    if (result.ok) {
      events.push(result.event);
    } else {
      issues.push(result.issue);
    }
  });

  return { events, issues };
}

export function parseTraceStrict(text: string): TraceEvent[] {
  const { events, issues } = parseTrace(text);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `trace has ${issues.length} unusable line(s); first at line ${first.line}: ${first.message}`,
    );
  }
  return events;
}
