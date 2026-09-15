import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraceLine } from '../src/parse.ts';

// Deterministic PRNG so a failure is reproducible from the printed seed
// instead of only showing up on some CI runs and not others.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260916;
const ITERATIONS = 500;

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]!;
}

function randomString(rng: () => number, maxLength = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.:/';
  const length = Math.floor(rng() * maxLength);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(rng() * chars.length)];
  }
  return out;
}

// Every field that has two accepted spellings, with the value each should
// carry so a test can tell which one parseTraceLine actually read.
test('tool_call events parse the same regardless of which field spelling is used', () => {
  const rng = mulberry32(SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const useTypeField = rng() < 0.5;
    const useNameField = rng() < 0.5;
    const useTsField = rng() < 0.5;
    const useArgsField = rng() < 0.5;
    const includeId = rng() < 0.5;

    const name = randomString(rng, 10) || 'unnamed_tool';
    const ts = Math.floor(rng() * 1_000_000);
    const args = { key: randomString(rng, 6) };

    const obj: Record<string, unknown> = {};
    obj[useTypeField ? 'type' : 'role'] = 'tool_call';
    obj[useNameField ? 'name' : 'tool'] = name;
    obj[useTsField ? 'ts' : 'timestamp'] = ts;
    obj[useArgsField ? 'args' : 'arguments'] = args;
    if (includeId) {
      obj.id = `call-${i}`;
    }

    const result = parseTraceLine(JSON.stringify(obj), i);
    assert.equal(result.ok, true, `seed case ${i} failed: ${JSON.stringify(obj)}`);
    if (result.ok && result.event.type === 'tool_call') {
      assert.equal(result.event.name, name);
      assert.equal(result.event.ts, ts);
      assert.deepEqual(result.event.args, args);
      assert.equal(result.event.id, includeId ? `call-${i}` : undefined);
    } else {
      assert.fail(`expected a tool_call event for case ${i}`);
    }
  }
});

test('tool_result events parse the same regardless of which field spelling is used', () => {
  const rng = mulberry32(SEED + 1);
  for (let i = 0; i < ITERATIONS; i++) {
    const useTypeField = rng() < 0.5;
    const useTsField = rng() < 0.5;
    const ok = rng() < 0.5;
    const durationMs = Math.floor(rng() * 5000);
    const includeId = rng() < 0.5;

    const obj: Record<string, unknown> = {};
    obj[useTypeField ? 'type' : 'role'] = 'tool_result';
    obj[useTsField ? 'ts' : 'timestamp'] = i * 10;
    obj.ok = ok;
    obj.durationMs = durationMs;
    if (includeId) {
      obj.id = `call-${i}`;
    }

    const result = parseTraceLine(JSON.stringify(obj), i);
    assert.equal(result.ok, true, `seed case ${i} failed: ${JSON.stringify(obj)}`);
    if (result.ok && result.event.type === 'tool_result') {
      assert.equal(result.event.ts, i * 10);
      assert.equal(result.event.ok, ok);
      assert.equal(result.event.durationMs, durationMs);
      assert.equal(result.event.id, includeId ? `call-${i}` : undefined);
    } else {
      assert.fail(`expected a tool_result event for case ${i}`);
    }
  }
});

test('when both spellings of a field are present, the canonical one wins', () => {
  const rng = mulberry32(SEED + 2);
  for (let i = 0; i < ITERATIONS; i++) {
    const canonicalName = randomString(rng, 8) || 'canonical';
    const altName = randomString(rng, 8) || 'alternate';
    const canonicalTs = Math.floor(rng() * 1000);
    const altTs = Math.floor(rng() * 1000) + 100_000;

    const obj = {
      type: 'tool_call',
      role: 'assistant', // ignored: 'type' is canonical and present
      name: canonicalName,
      tool: altName,
      ts: canonicalTs,
      timestamp: altTs,
      args: { source: 'canonical' },
      arguments: { source: 'alternate' },
    };

    const result = parseTraceLine(JSON.stringify(obj), i);
    assert.equal(result.ok, true);
    if (result.ok && result.event.type === 'tool_call') {
      assert.equal(result.event.name, canonicalName);
      assert.equal(result.event.ts, canonicalTs);
      assert.deepEqual(result.event.args, { source: 'canonical' });
    } else {
      assert.fail(`expected a tool_call event for case ${i}`);
    }
  }
});

// Field-name forgiveness should never turn into a thrown exception, no
// matter how malformed or oddly-shaped the input is.
test('parseTraceLine never throws, for any input', () => {
  const rng = mulberry32(SEED + 3);
  const typeValues = ['user', 'assistant', 'tool_call', 'tool_result', 'bogus', '', undefined, 42, null, {}];

  for (let i = 0; i < ITERATIONS; i++) {
    const shape = pick(rng, ['object', 'array', 'string', 'number', 'raw-garbage'] as const);

    let raw: string;
    switch (shape) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        if (rng() < 0.8) {
          obj[pick(rng, ['type', 'role'])] = pick(rng, typeValues);
        }
        if (rng() < 0.5) {
          obj[pick(rng, ['name', 'tool'])] = pick(rng, [randomString(rng), undefined, 7, null]);
        }
        if (rng() < 0.5) {
          obj[pick(rng, ['ts', 'timestamp'])] = pick(rng, [randomString(rng), 1, -1, NaN, Infinity]);
        }
        raw = JSON.stringify(obj);
        break;
      }
      case 'array':
        raw = JSON.stringify([1, 2, randomString(rng)]);
        break;
      case 'string':
        raw = JSON.stringify(randomString(rng));
        break;
      case 'number':
        raw = String(Math.floor(rng() * 1000) - 500);
        break;
      case 'raw-garbage':
        raw = randomString(rng, 20);
        break;
    }

    assert.doesNotThrow(() => parseTraceLine(raw, i), `seed case ${i} threw for raw: ${raw}`);
    const result = parseTraceLine(raw, i);
    assert.equal(typeof result.ok, 'boolean');
  }
});
