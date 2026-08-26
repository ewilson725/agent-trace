import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

function call(id: string | undefined, name: string, ts?: number): TraceEvent {
  return { type: 'tool_call', id, name, ts };
}

function result(id: string | undefined, ts?: number, extra: Partial<TraceEvent> = {}): TraceEvent {
  return { type: 'tool_result', id, ts, ...extra } as TraceEvent;
}

function assistant(ts: number, inputTokens?: number, outputTokens?: number): TraceEvent {
  return {
    type: 'assistant',
    ts,
    usage: inputTokens === undefined && outputTokens === undefined
      ? undefined
      : { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

test('counts events by type', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0 },
    assistant(1),
    call('c1', 'read_file', 2),
    result('c1', 3, { ok: true, durationMs: 1 }),
  ];
  const stats = computeStats(events);
  assert.deepEqual(stats.eventCounts, { user: 1, assistant: 1, tool_call: 1, tool_result: 1 });
  assert.equal(stats.totalEvents, 4);
});

test('wall clock spans the earliest to latest timestamp', () => {
  const events: TraceEvent[] = [{ type: 'user', ts: 100 }, { type: 'assistant', ts: 340 }];
  const stats = computeStats(events);
  assert.equal(stats.wallClockMs, 240);
});

test('wall clock is zero when no event carries a timestamp', () => {
  const stats = computeStats([{ type: 'user' }]);
  assert.equal(stats.wallClockMs, 0);
});

test('sums input and output tokens across assistant events', () => {
  const events = [assistant(0, 100, 10), assistant(1, 50, 5), assistant(2)];
  const stats = computeStats(events);
  assert.equal(stats.inputTokens, 150);
  assert.equal(stats.outputTokens, 15);
  assert.equal(stats.totalTokens, 165);
});

test('builds per-tool timing, sorted by total time descending', () => {
  const events: TraceEvent[] = [
    call('c1', 'run_tests', 0),
    result('c1', 1760, { ok: false, durationMs: 1760 }),
    call('c2', 'run_tests', 1760),
    result('c2', 3515, { ok: true, durationMs: 1755 }),
    call('c3', 'read_file', 0),
    result('c3', 54, { ok: true, durationMs: 54 }),
  ];
  const stats = computeStats(events);
  assert.equal(stats.toolTimeMs, 3569);
  assert.equal(stats.tools.length, 2);

  const [runTests, readFile] = stats.tools;
  assert.equal(runTests.name, 'run_tests');
  assert.equal(runTests.calls, 2);
  assert.equal(runTests.failures, 1);
  assert.equal(runTests.totalMs, 3515);
  assert.equal(runTests.avgMs, 1757.5);
  assert.equal(runTests.maxMs, 1760);
  assert.equal(Math.round(runTests.timeShare * 1000) / 1000, 0.985);

  assert.equal(readFile.name, 'read_file');
  assert.equal(readFile.calls, 1);
  assert.equal(readFile.totalMs, 54);
});

test('a pending call has no timing but still counts towards toolCallsPending', () => {
  const events: TraceEvent[] = [call('c1', 'read_file', 0)];
  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.toolCallsPending, 1);
  assert.equal(stats.toolCallsCompleted, 0);
  assert.equal(stats.tools.length, 0);
});

test('failure rate is failed calls over all tool calls, pending included', () => {
  const events: TraceEvent[] = [
    call('c1', 'run_tests', 0),
    result('c1', 10, { ok: false, durationMs: 10 }),
    call('c2', 'run_tests', 10),
  ];
  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 2);
  assert.equal(stats.toolCallsFailed, 1);
  assert.equal(stats.toolFailureRate, 0.5);
});

test('orphan results are counted but do not appear as spans', () => {
  const events: TraceEvent[] = [result('does-not-exist', 5, { ok: true })];
  const stats = computeStats(events);
  assert.equal(stats.orphanResults, 1);
  assert.equal(stats.toolCalls, 0);
});

test('an empty trace produces zeroed-out stats rather than dividing by zero', () => {
  const stats = computeStats([]);
  assert.equal(stats.wallClockMs, 0);
  assert.equal(stats.toolTimeShare, 0);
  assert.equal(stats.toolFailureRate, 0);
  assert.deepEqual(stats.tools, []);
});
