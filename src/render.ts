import { pairToolEvents } from './pair.ts';
import type { ToolResultEvent, ToolStat, TraceEvent, TraceStats } from './types.ts';

// Width of the label column in renderStats' summary lines -- chosen so the
// longest label ("wall clock", "tool calls") still leaves a couple of spaces
// before the value.
const LABEL_WIDTH = 14;

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(3)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function summaryLine(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

function renderToolTable(tools: ToolStat[]): string[] {
  const headers = ['tool', 'calls', 'fail', 'total', 'avg', 'max', 'share'];
  const rows = tools.map((tool) => [
    tool.name,
    String(tool.calls),
    String(tool.failures),
    formatDuration(tool.totalMs),
    formatDuration(tool.avgMs),
    formatDuration(tool.maxMs),
    formatPercent(tool.timeShare),
  ]);

  const widths = headers.map((header, col) => Math.max(header.length, ...rows.map((row) => row[col].length)));

  // Name is left-justified like a normal table column; the numeric columns
  // are right-justified so the digits line up for scanning.
  const renderRow = (cells: string[]): string =>
    cells.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join('  ').trimEnd();

  return [renderRow(headers), ...rows.map(renderRow)];
}

export function renderStats(stats: TraceStats): string {
  const { eventCounts } = stats;
  const lines: string[] = [];

  lines.push(
    summaryLine(
      'events',
      `${stats.totalEvents}  (user ${eventCounts.user}, assistant ${eventCounts.assistant}, ` +
        `tool_call ${eventCounts.tool_call}, tool_result ${eventCounts.tool_result})`,
    ),
  );
  lines.push(summaryLine('wall clock', formatDuration(stats.wallClockMs)));

  // The "of wall clock" share is meaningless without a wall clock to compare
  // against, so it's only shown once there is one.
  const toolTimeSuffix = stats.wallClockMs > 0 ? `  (${formatPercent(stats.toolTimeShare)} of wall clock)` : '';
  lines.push(summaryLine('tool time', `${formatDuration(stats.toolTimeMs)}${toolTimeSuffix}`));

  lines.push(
    summaryLine(
      'tool calls',
      `${stats.toolCalls}  (${stats.toolCallsCompleted} completed, ${stats.toolCallsPending} pending, ` +
        `${stats.toolCallsFailed} failed = ${formatPercent(stats.toolFailureRate)} failure rate)`,
    ),
  );
  lines.push(summaryLine('tokens', `${stats.inputTokens} in / ${stats.outputTokens} out = ${stats.totalTokens} total`));

  if (stats.orphanResults > 0) {
    lines.push(summaryLine('orphans', `${stats.orphanResults} tool_result event(s) matched no open call`));
  }

  if (stats.tools.length > 0) {
    lines.push('');
    lines.push(...renderToolTable(stats.tools));
  }

  return lines.join('\n');
}

export interface TimelineOptions {
  // Only show tool_call/tool_result events for this tool name; drops user
  // and assistant text since it isn't part of that tool's story.
  tool?: string;
  // Truncate tool_call args and tool_result output past this length. Default 80.
  maxArgLength?: number;
  // Set to false to drop user/assistant text lines (the CLI's --no-text).
  showText?: boolean;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatArgs(args: unknown, maxLength: number): string {
  if (args === undefined) {
    return '';
  }
  let text: string;
  try {
    text = JSON.stringify(args) ?? String(args);
  } catch {
    text = String(args);
  }
  return truncate(text, maxLength);
}

export function renderTimeline(events: TraceEvent[], options: TimelineOptions = {}): string {
  const maxArgLength = options.maxArgLength ?? 80;
  const showText = options.showText ?? true;

  // tool_result carries no name of its own, so the only way to filter results
  // by tool is to pair them with their call first.
  const resultToolName = new Map<ToolResultEvent, string>();
  if (options.tool !== undefined) {
    for (const span of pairToolEvents(events).spans) {
      if (span.result) {
        resultToolName.set(span.result, span.name);
      }
    }
  }

  const lines: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'user':
        if (options.tool !== undefined || !showText) {
          continue;
        }
        lines.push(`user  ${event.text ?? ''}`.trimEnd());
        break;

      case 'assistant':
        if (options.tool !== undefined || !showText) {
          continue;
        }
        lines.push(`assistant  ${event.text ?? ''}`.trimEnd());
        break;

      case 'tool_call':
        if (options.tool !== undefined && event.name !== options.tool) {
          continue;
        }
        lines.push(`  call  ${event.name}  ${formatArgs(event.args, maxArgLength)}`.trimEnd());
        break;

      case 'tool_result': {
        if (options.tool !== undefined && resultToolName.get(event) !== options.tool) {
          continue;
        }
        const status = event.ok === false ? 'fail' : event.ok === true ? 'ok' : 'result';
        const duration = event.durationMs !== undefined ? `  ${formatDuration(event.durationMs)}` : '';
        const output = event.output !== undefined ? `  ${truncate(event.output, maxArgLength)}` : '';
        lines.push(`  ${status}${duration}${output}`);
        break;
      }
    }
  }

  return lines.join('\n');
}
