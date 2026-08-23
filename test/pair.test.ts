import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairToolEvents } from '../src/pair.ts';
import type { TraceEvent } from '../src/types.ts';

function call(id: string | undefined, name: string, ts?: number): TraceEvent {
  return { type: 'tool_call', id, name, ts };
}

function result(id: string | undefined, ts?: number, extra: Partial<TraceEvent> = {}): TraceEvent {
  return { type: 'tool_result', id, ts, ...extra } as TraceEvent;
}

test('matches a tool_result to its tool_call by id', () => {
  const events = [call('c1', 'read_file', 0), result('c1', 54, { ok: true, durationMs: 54 })];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].pending, false);
  assert.equal(spans[0].ok, true);
  assert.equal(spans[0].durationMs, 54);
});

test('falls back to the oldest open call when a result has no id', () => {
  const events = [call('c1', 'read_file', 0), call('c2', 'run_tests', 10), result(undefined, 60, { ok: true })];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  const [first, second] = spans;
  assert.equal(first.name, 'read_file');
  assert.equal(first.pending, false);
  assert.equal(second.name, 'run_tests');
  assert.equal(second.pending, true);
});

test('a result whose id matches nothing is an orphan, not a guess', () => {
  const events = [call('c1', 'read_file', 0), result('does-not-exist', 5, { ok: true })];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 1);
  assert.equal(spans[0].pending, true);
});

test('an id-less result with no open calls is an orphan', () => {
  const events = [result(undefined, 5, { ok: true })];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(orphans.length, 1);
});

test('a tool_call with no matching result stays pending', () => {
  const events = [call('c1', 'read_file', 0)];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].pending, true);
  assert.equal(spans[0].ok, undefined);
  assert.equal(spans[0].durationMs, undefined);
});

test('duration falls back to the timestamp delta when durationMs is absent', () => {
  const events = [call('c1', 'read_file', 100), result('c1', 154)];
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].durationMs, 54);
});

test('two sequential calls with no ids each close in call order', () => {
  const events = [
    call(undefined, 'read_file', 0),
    result(undefined, 10, { ok: true }),
    call(undefined, 'run_tests', 20),
    result(undefined, 90, { ok: false }),
  ];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].name, 'read_file');
  assert.equal(spans[0].ok, true);
  assert.equal(spans[1].name, 'run_tests');
  assert.equal(spans[1].ok, false);
});
