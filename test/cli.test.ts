import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.ts';

function io(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    handle: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
      readInput: (path: string) => {
        if (!(path in files)) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return files[path];
      },
    },
  };
}

const SESSION = [
  '{"type":"user","ts":0,"text":"hi"}',
  '{"type":"tool_call","ts":1,"id":"c1","name":"read_file","args":{"path":"a.ts"}}',
  '{"type":"tool_result","ts":5,"id":"c1","ok":true,"durationMs":4}',
].join('\n');

test('-h prints usage and exits 0', () => {
  const { out, err, handle } = io();
  const code = run(['-h'], handle);
  assert.equal(code, 0);
  assert.match(out[0], /Usage:/);
  assert.equal(err.length, 0);
});

test('--version prints the version and exits 0', () => {
  const { out, handle } = io();
  const code = run(['--version'], handle);
  assert.equal(code, 0);
  assert.match(out[0], /^\d+\.\d+\.\d+\n$/);
});

test('unknown option is rejected before any file is read', () => {
  const { err, handle } = io();
  const code = run(['stats', '--bogus'], handle);
  assert.equal(code, 2);
  assert.match(err[0], /unknown option "--bogus"/);
});

test('--max-arg requires a non-negative integer', () => {
  const { err, handle } = io();
  const code = run(['show', 'x.jsonl', '--max-arg=-1'], handle);
  assert.equal(code, 2);
  assert.match(err[0], /--max-arg must be a non-negative integer/);
});

test('unknown command is rejected', () => {
  const { err, handle } = io({ 'x.jsonl': SESSION });
  const code = run(['replay', 'x.jsonl'], handle);
  assert.equal(code, 2);
  assert.match(err[0], /unknown command "replay"/);
});

test('missing file argument is rejected', () => {
  const { err, handle } = io();
  const code = run(['stats'], handle);
  assert.equal(code, 2);
  assert.match(err[0], /missing <file> argument/);
});

test('a file that cannot be read exits 2 with the underlying error', () => {
  const { err, handle } = io();
  const code = run(['stats', 'missing.jsonl'], handle);
  assert.equal(code, 2);
  assert.match(err[0], /could not read "missing.jsonl"/);
});

test('stats prints the table by default', () => {
  const { out, handle } = io({ 'x.jsonl': SESSION });
  const code = run(['stats', 'x.jsonl'], handle);
  assert.equal(code, 0);
  assert.match(out[0], /^events\s+3/);
});

test('stats --json prints parsed JSON', () => {
  const { out, handle } = io({ 'x.jsonl': SESSION });
  const code = run(['stats', 'x.jsonl', '--json'], handle);
  assert.equal(code, 0);
  const stats = JSON.parse(out[0]);
  assert.equal(stats.totalEvents, 3);
});

test('show prints the timeline', () => {
  const { out, handle } = io({ 'x.jsonl': SESSION });
  const code = run(['show', 'x.jsonl'], handle);
  assert.equal(code, 0);
  assert.match(out[0], /call {2}read_file/);
});

test('show --tool and --no-text are passed through to the renderer', () => {
  const { out, handle } = io({ 'x.jsonl': SESSION });
  const code = run(['show', 'x.jsonl', '--tool=read_file', '--no-text'], handle);
  assert.equal(code, 0);
  assert.ok(!out[0].includes('user'));
  assert.match(out[0], /read_file/);
});

test('parse issues are reported to stderr but do not block a usable trace', () => {
  const { out, err, handle } = io({ 'x.jsonl': `${SESSION}\nnot json` });
  const code = run(['stats', 'x.jsonl'], handle);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.match(err.join(''), /line 4: invalid JSON/);
});

test('--strict exits 1 and reports every issue when any line fails to parse', () => {
  const { out, err, handle } = io({ 'x.jsonl': `${SESSION}\nnot json` });
  const code = run(['stats', 'x.jsonl', '--strict'], handle);
  assert.equal(code, 1);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /line 4: invalid JSON/);
});

test('a trace with no usable events exits 1 and lists the issues', () => {
  const { err, handle } = io({ 'x.jsonl': 'not json' });
  const code = run(['stats', 'x.jsonl'], handle);
  assert.equal(code, 1);
  assert.match(err.join(''), /no usable events in trace/);
  assert.match(err.join(''), /line 1: invalid JSON/);
});

test('reads from stdin when the file argument is "-"', () => {
  const { out, handle } = io({ '-': SESSION });
  const code = run(['stats', '-'], handle);
  assert.equal(code, 0);
  assert.match(out[0], /^events\s+3/);
});
