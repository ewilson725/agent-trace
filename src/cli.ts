#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseTrace } from './parse.ts';
import { computeStats } from './stats.ts';
import { renderStats, renderTimeline } from './render.ts';

const VERSION = '0.1.0';

const USAGE = `agent-trace -- summarise or replay a JSONL agent trace

Usage:
  agent-trace stats <file> [--json] [--strict]
  agent-trace show <file> [--tool=<name>] [--max-arg=<n>] [--no-text] [--strict]

  stats <file>       totals, per-tool timing, token usage
  show <file>        indented timeline of the session

  --json             print stats as JSON instead of a table (stats only)
  --tool=<name>      restrict show to a single tool
  --max-arg=<n>      truncate tool arguments to n characters (default 80)
  --no-text          hide user and assistant messages
  --strict           exit 1 if any line failed to parse
  -h, --help         show this help
  --version          show the version number

Pass - as <file> to read the trace from stdin.
`;

interface Options {
  command?: string;
  file?: string;
  json: boolean;
  tool?: string;
  maxArg: number;
  showText: boolean;
  strict: boolean;
  help: boolean;
  version: boolean;
}

type ParsedArgs = Options | { error: string };

function parseArgs(argv: string[]): ParsedArgs {
  const options: Options = {
    json: false,
    maxArg: 80,
    showText: true,
    strict: false,
    help: false,
    version: false,
  };
  const positionals: string[] = [];

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-text') {
      options.showText = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--tool=')) {
      options.tool = arg.slice('--tool='.length);
    } else if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        return { error: `--max-arg must be a non-negative integer, got "${raw}"` };
      }
      options.maxArg = value;
    } else if (arg.startsWith('-')) {
      return { error: `unknown option "${arg}"` };
    } else {
      positionals.push(arg);
    }
  }

  [options.command, options.file] = positionals;
  return options;
}

function readInput(path: string): string {
  // fd 0 is stdin; readFileSync accepts it directly so a "-" file reads
  // synchronously without the caller having to buffer it themselves.
  return readFileSync(path === '-' ? 0 : path, 'utf8');
}

export function run(
  argv: string[],
  io: { stdout: (text: string) => void; stderr: (text: string) => void; readInput: (path: string) => string },
): number {
  const args = parseArgs(argv);
  if ('error' in args) {
    io.stderr(`agent-trace: ${args.error}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (args.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  if (args.command !== 'stats' && args.command !== 'show') {
    io.stderr(`agent-trace: unknown command "${args.command ?? ''}"\n\n${USAGE}`);
    return 2;
  }
  if (!args.file) {
    io.stderr(`agent-trace: missing <file> argument\n\n${USAGE}`);
    return 2;
  }

  let text: string;
  try {
    text = io.readInput(args.file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`agent-trace: could not read "${args.file}": ${message}\n`);
    return 2;
  }

  const { events, issues } = parseTrace(text);

  if (args.strict && issues.length > 0) {
    for (const issue of issues) {
      io.stderr(`agent-trace: line ${issue.line}: ${issue.message}\n`);
    }
    return 1;
  }

  if (events.length === 0) {
    io.stderr('agent-trace: no usable events in trace\n');
    for (const issue of issues) {
      io.stderr(`  line ${issue.line}: ${issue.message}\n`);
    }
    return 1;
  }

  for (const issue of issues) {
    io.stderr(`agent-trace: line ${issue.line}: ${issue.message}\n`);
  }

  if (args.command === 'stats') {
    const stats = computeStats(events);
    io.stdout(args.json ? `${JSON.stringify(stats, null, 2)}\n` : `${renderStats(stats)}\n`);
  } else {
    io.stdout(
      `${renderTimeline(events, { tool: args.tool, maxArgLength: args.maxArg, showText: args.showText })}\n`,
    );
  }

  return 0;
}

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readInput,
});
