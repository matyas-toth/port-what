import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CLI discovers and stops a real TCP listener and its descendant', { skip: process.platform === 'win32' && !process.env.CI }, async (t) => {
  const child = spawn(process.execPath, ['test/fixture-server.js', 'tcp'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const [port, descendantPid] = (await firstLine(child.stdout)).split(' ');
  t.after(() => {
    if (descendantPid && isAlive(Number(descendantPid))) process.kill(Number(descendantPid), 'SIGKILL');
  });
  const inspect = await execNode(['bin/port-who.js', port, '--no-color']);
  assert.match(inspect.stdout, new RegExp(`Port ${port} is in use`));
  assert.match(inspect.stdout, new RegExp(`PID ${child.pid}`));
  assert.match(inspect.stdout, new RegExp(`port-who ${port} --kill`));

  const stopped = await execNode(['bin/port-who.js', port, '--kill', '--no-color']);
  assert.match(stopped.stdout, new RegExp(`Port ${port} is free`));
  assert.match(stopped.stdout, /1 descendant/);
  await waitForExit(child);
  await waitUntilDead(Number(descendantPid));

  const free = await execNode(['bin/port-who.js', port, '--no-color']);
  assert.match(free.stdout, new RegExp(`Port ${port} is free`));
});

test('CLI discovers and stops a real UDP binding', { skip: process.platform === 'win32' && !process.env.CI }, async (t) => {
  const child = spawn(process.execPath, ['test/fixture-server.js', 'udp'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const [port] = (await firstLine(child.stdout)).split(' ');
  const inspect = await execNode(['bin/port-who.js', port, '--no-color']);
  assert.match(inspect.stdout, /UDP/);
  assert.match(inspect.stdout, new RegExp(`PID ${child.pid}`));

  const stopped = await execNode(['bin/port-who.js', port, '--kill', '--no-color']);
  assert.match(stopped.stdout, new RegExp(`Port ${port} is free`));
  await waitForExit(child);
});

function execNode(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline !== -1) resolve(buffer.slice(0, newline));
    });
    stream.on('error', reject);
    stream.on('close', () => reject(new Error('Fixture exited before reporting its port')));
  });
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

async function waitUntilDead(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(isAlive(pid), false, `PID ${pid} should have exited`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
