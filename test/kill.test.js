import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectTrees } from '../src/kill.js';

test('collectTrees includes every descendant without unrelated processes', () => {
  const table = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 10 },
    { pid: 13, ppid: 11 },
    { pid: 20, ppid: 1 },
  ];
  assert.deepEqual([...collectTrees([10], table)].sort((a, b) => a - b), [10, 11, 12, 13]);
});

test('collectTrees tolerates cycles in malformed process data', () => {
  const result = collectTrees([10], [{ pid: 10, ppid: 11 }, { pid: 11, ppid: 10 }]);
  assert.deepEqual([...result].sort((a, b) => a - b), [10, 11]);
});
