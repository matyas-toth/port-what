import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, run } from '../src/cli.js';

function stream() {
  let value = '';
  return {
    columns: 100,
    isTTY: false,
    write(chunk) { value += chunk; },
    toString() { return value; },
  };
}

test('parseArgs accepts the port before or after --kill', () => {
  assert.deepEqual(parseArgs(['3000', '--kill']), {
    kill: true, color: undefined, help: false, version: false, port: 3000,
  });
  assert.equal(parseArgs(['-k', '5173']).port, 5173);
  assert.equal(parseArgs(['-k', '5173']).kill, true);
});

test('parseArgs rejects invalid ports and unknown options', () => {
  assert.throws(() => parseArgs([]), /required/);
  assert.throws(() => parseArgs(['0']), /Invalid port/);
  assert.throws(() => parseArgs(['65536']), /Invalid port/);
  assert.throws(() => parseArgs(['3e3']), /Invalid port/);
  assert.throws(() => parseArgs(['3000', '--wat']), /Unknown option/);
});

test('run reports a free port', async () => {
  const stdout = stream();
  const exitCode = await run(['3000'], {
    stdout,
    stderr: stream(),
    find: async () => [],
  });
  assert.equal(exitCode, 0);
  assert.match(stdout.toString(), /Port 3000 is free/);
});

test('run prints a compact process description and kill command', async () => {
  const stdout = stream();
  const listener = { pid: 42, protocol: 'TCP', address: '127.0.0.1', port: 3000 };
  const exitCode = await run(['3000'], {
    stdout,
    stderr: stream(),
    find: async () => [listener],
    describe: async () => [{
      pid: 42,
      ppid: 7,
      name: 'node',
      user: 'dev',
      command: 'node server.js',
      endpoints: [listener],
      ancestors: [{ pid: 7, name: 'npm' }],
    }],
  });
  assert.equal(exitCode, 0);
  assert.match(stdout.toString(), /node · PID 42 · dev/);
  assert.match(stdout.toString(), /TCP 127\.0\.0\.1:3000/);
  assert.match(stdout.toString(), /parent\s+npm \(7\)/);
  assert.match(stdout.toString(), /port-who 3000 --kill/);
});

test('run strips terminal control sequences from process metadata', async () => {
  const stdout = stream();
  const listener = { pid: 42, protocol: 'TCP', address: '127.0.0.1', port: 3000 };
  await run(['3000'], {
    stdout,
    stderr: stream(),
    find: async () => [listener],
    describe: async () => [{
      pid: 42,
      name: '\u001B[31mevil\u001B[0m',
      command: 'node\n--inspect',
      endpoints: [listener],
      ancestors: [],
    }],
  });
  assert.doesNotMatch(stdout.toString(), /\u001B|\n--inspect/);
  assert.match(stdout.toString(), /evil/);
  assert.match(stdout.toString(), /node --inspect/);
});

test('run kills listeners and reports verification failures', async () => {
  const listener = { pid: 42, protocol: 'TCP', address: '127.0.0.1', port: 3000 };
  const description = { pid: 42, name: 'node', endpoints: [listener], ancestors: [] };
  const success = stream();
  assert.equal(await run(['3000', '--kill'], {
    stdout: success,
    stderr: stream(),
    find: async () => [listener],
    describe: async () => [description],
    kill: async () => ({ killed: [42], forced: [], remaining: [] }),
  }), 0);
  assert.match(success.toString(), /Port 3000 is free/);

  const failure = stream();
  assert.equal(await run(['--kill', '3000'], {
    stdout: failure,
    stderr: stream(),
    find: async () => [listener],
    describe: async () => [description],
    kill: async () => ({ killed: [42], forced: [42], remaining: [listener] }),
  }), 1);
  assert.match(failure.toString(), /still in use/);
});
