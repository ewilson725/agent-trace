import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrace, parseTraceLine, parseTraceStrict } from '../src/parse.ts';

test('parses a tool_call using its canonical field names', () => {
  const line = {
    type: 'tool_call',
    ts: 1767225600950,
    id: 'c1',
    name: 'read_file',
    args: { path: 'src/parse.ts' },
  };
  const result = parseTraceLine(JSON.stringify(line));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.event, {
      type: 'tool_call',
      ts: 1767225600950,
      id: 'c1',
      name: 'read_file',
      args: { path: 'src/parse.ts' },
    });
  }
});

test('accepts the alternate field names other runtimes use', () => {
  const line = { role: 'tool_call', timestamp: 42, tool: 'run_tests', arguments: { suite: 'unit' } };
  const result = parseTraceLine(JSON.stringify(line));
  assert.equal(result.ok, true);
  if (result.ok && result.event.type === 'tool_call') {
    assert.equal(result.event.ts, 42);
    assert.equal(result.event.name, 'run_tests');
    assert.deepEqual(result.event.args, { suite: 'unit' });
  } else {
    assert.fail('expected a tool_call event');
  }
});

test('parses an assistant event with token usage', () => {
  const line = { type: 'assistant', ts: 2, text: 'let me look', usage: { input_tokens: 1180, output_tokens: 96 } };
  const result = parseTraceLine(JSON.stringify(line));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.event, {
      type: 'assistant',
      ts: 2,
      text: 'let me look',
      usage: { input_tokens: 1180, output_tokens: 96 },
    });
  }
});

test('reports invalid JSON with its line number instead of throwing', () => {
  const result = parseTraceLine('not json', 7);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issue.line, 7);
    assert.match(result.issue.message, /invalid JSON/);
  }
});

test('reports a line with neither a "type" nor a "role" field', () => {
  const result = parseTraceLine(JSON.stringify({ text: 'hello' }));
  assert.equal(result.ok, false);
});

test('reports a tool_call with neither a "name" nor a "tool" field', () => {
  const result = parseTraceLine(JSON.stringify({ type: 'tool_call', id: 'c1' }));
  assert.equal(result.ok, false);
});

test('rejects an unrecognised type value', () => {
  const result = parseTraceLine(JSON.stringify({ type: 'debug' }));
  assert.equal(result.ok, false);
});

test('rejects a JSON array line', () => {
  const result = parseTraceLine('[1,2,3]');
  assert.equal(result.ok, false);
});

test('parseTrace collects events and issues separately and skips blank lines', () => {
  const text = [
    JSON.stringify({ type: 'user', ts: 1, text: 'hi' }),
    '',
    'not json',
    JSON.stringify({ type: 'assistant', ts: 2 }),
  ].join('\n');

  const { events, issues } = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
});

test('parseTraceStrict throws when any line is unusable', () => {
  assert.throws(() => parseTraceStrict('not json'), /unusable line/);
});

test('parseTraceStrict returns events when the whole trace is clean', () => {
  const events = parseTraceStrict(JSON.stringify({ type: 'user', text: 'hi' }));
  assert.equal(events.length, 1);
});
