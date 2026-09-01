import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStats, renderTimeline } from '../src/render.ts';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

function call(id: string | undefined, name: string, ts?: number, args?: unknown): TraceEvent {
  return { type: 'tool_call', id, name, ts, args };
}

function result(id: string | undefined, ts?: number, extra: Partial<TraceEvent> = {}): TraceEvent {
  return { type: 'tool_result', id, ts, ...extra } as TraceEvent;
}

test('renderStats reports event counts by type', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0 },
    { type: 'assistant', ts: 1 },
    call('c1', 'read_file', 2),
    result('c1', 3, { ok: true, durationMs: 1 }),
  ];
  const output = renderStats(computeStats(events));
  assert.match(output, /^events\s+4 {2}\(user 1, assistant 1, tool_call 1, tool_result 1\)/m);
});

test('renderStats shows tool time as a share of wall clock', () => {
  const events: TraceEvent[] = [
    call('c1', 'read_file', 0),
    result('c1', 1000, { ok: true, durationMs: 500 }),
  ];
  const output = renderStats(computeStats(events));
  assert.match(output, /^wall clock\s+1\.000s$/m);
  assert.match(output, /^tool time\s+500ms {2}\(50\.0% of wall clock\)$/m);
});

test('renderStats omits the wall-clock share when there is no wall clock', () => {
  const output = renderStats(computeStats([]));
  assert.match(output, /^tool time\s+0ms$/m);
  assert.doesNotMatch(output, /of wall clock/);
});

test('renderStats prints a tool table sorted by total time, and omits it when empty', () => {
  const events: TraceEvent[] = [
    call('c1', 'run_tests', 0),
    result('c1', 1760, { ok: false, durationMs: 1760 }),
    call('c2', 'run_tests', 1760),
    result('c2', 3515, { ok: true, durationMs: 1755 }),
    call('c3', 'read_file', 0),
    result('c3', 54, { ok: true, durationMs: 54 }),
  ];
  const output = renderStats(computeStats(events));
  const lines = output.split('\n');
  const header = lines.find((line) => line.includes('calls') && line.includes('share'));
  assert.ok(header);
  const runTestsRow = lines.find((line) => line.trim().startsWith('run_tests'));
  assert.ok(runTestsRow);
  assert.match(runTestsRow!, /run_tests\s+2\s+1\s+3\.515s\s+1\.75[78]s\s+1\.760s\s+98\.5%/);

  assert.doesNotMatch(renderStats(computeStats([])), /tool {2,}calls {2,}fail {2,}total {2,}avg {2,}max {2,}share/);
});

test('renderStats reports orphan results only when there are any', () => {
  assert.doesNotMatch(renderStats(computeStats([])), /orphans/);
  const withOrphan = renderStats(computeStats([result('missing', 0, { ok: true })]));
  assert.match(withOrphan, /^orphans\s+1 tool_result event\(s\) matched no open call$/m);
});

test('renderTimeline lists user and assistant text in order', () => {
  const events: TraceEvent[] = [
    { type: 'user', text: 'the parse test fails on windows' },
    { type: 'assistant', text: 'let me look' },
  ];
  const output = renderTimeline(events);
  assert.equal(output, 'user  the parse test fails on windows\nassistant  let me look');
});

test('renderTimeline hides text events when showText is false', () => {
  const events: TraceEvent[] = [
    { type: 'user', text: 'hi' },
    call('c1', 'read_file', 0, { path: 'src/parse.ts' }),
  ];
  const output = renderTimeline(events, { showText: false });
  assert.equal(output.includes('hi'), false);
  assert.match(output, /call {2}read_file/);
});

test('renderTimeline truncates args and output past maxArgLength', () => {
  const events: TraceEvent[] = [
    call('c1', 'read_file', 0, { path: 'a'.repeat(50) }),
    result('c1', 10, { ok: true, durationMs: 10, output: 'b'.repeat(50) }),
  ];
  const output = renderTimeline(events, { maxArgLength: 20 });
  assert.equal(output.includes('a'.repeat(50)), false);
  assert.equal(output.includes('b'.repeat(50)), false);
  assert.equal((output.match(/…/g) ?? []).length, 2);
});

test('renderTimeline filters to a single tool, matching results by pairing', () => {
  const events: TraceEvent[] = [
    { type: 'user', text: 'run the tests' },
    call('c1', 'read_file', 0),
    result('c1', 10, { ok: true, durationMs: 10 }),
    call('c2', 'run_tests', 10),
    result('c2', 1770, { ok: false, durationMs: 1760 }),
  ];
  const output = renderTimeline(events, { tool: 'run_tests' });
  assert.equal(output.includes('read_file'), false);
  assert.equal(output.includes('run the tests'), false);
  assert.match(output, /call {2}run_tests/);
  assert.match(output, /fail {2}1\.760s/);
});

test('renderTimeline marks a pending call with no result line', () => {
  const output = renderTimeline([call('c1', 'read_file', 0)]);
  assert.equal(output, '  call  read_file');
});
