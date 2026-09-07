import { executeAllowFailure } from './command.js';
import { findListeners, getProcessTable } from './platform.js';

const GRACE_PERIOD_MS = 1_500;
const FORCE_PERIOD_MS = 1_000;
const POLL_INTERVAL_MS = 75;

export async function killListeners(listeners, port, platform = process.platform) {
  const roots = [...new Set(listeners.map((listener) => listener.pid))];
  if (roots.length === 0) return { roots: [], killed: [], forced: [], remaining: [] };

  const table = await getProcessTable(platform);
  const tree = collectTrees(roots, table);
  const orderedPids = [...tree].sort((a, b) => depthOf(b, table) - depthOf(a, table));

  if (platform === 'win32') {
    return killWindows(roots, orderedPids, port);
  }
  return killPosix(roots, orderedPids, port, platform);
}

export function collectTrees(roots, table) {
  const children = new Map();
  for (const item of table) {
    const siblings = children.get(item.ppid) ?? [];
    siblings.push(item.pid);
    children.set(item.ppid, siblings);
  }

  const found = new Set();
  const visit = (pid) => {
    if (found.has(pid)) return;
    found.add(pid);
    for (const child of children.get(pid) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return found;
}

async function killPosix(roots, pids, port, platform) {
  const signaled = signalMany(pids, 'SIGTERM');
  await waitUntil(() => allExited(pids), GRACE_PERIOD_MS);

  const survivors = pids.filter(isAlive);
  const forced = signalMany(survivors, 'SIGKILL');
  await waitUntil(() => allExited(pids), FORCE_PERIOD_MS);

  const remaining = await findListeners(port, platform);
  return { roots, killed: signaled, forced, remaining };
}

async function killWindows(roots, allPids, port) {
  for (const pid of roots) {
    await executeAllowFailure('taskkill.exe', ['/PID', String(pid), '/T']);
  }
  await waitUntil(() => allExited(allPids), GRACE_PERIOD_MS);

  const survivors = allPids.filter(isAlive);
  for (const pid of roots) {
    if (survivors.includes(pid) || isAlive(pid)) {
      await executeAllowFailure('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    }
  }
  await waitUntil(() => allExited(allPids), FORCE_PERIOD_MS);

  const remaining = await findListeners(port, 'win32');
  return { roots, killed: allPids, forced: survivors, remaining };
}

function signalMany(pids, signal) {
  const signaled = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, signal);
      signaled.push(pid);
    } catch (error) {
      if (error.code !== 'ESRCH') throw permissionError(pid, error);
    }
  }
  return signaled;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    return false;
  }
}

function allExited(pids) {
  return pids.every((pid) => !isAlive(pid));
}

async function waitUntil(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return predicate();
}

function depthOf(pid, table) {
  const parents = new Map(table.map((item) => [item.pid, item.ppid]));
  const visited = new Set();
  let depth = 0;
  let current = pid;
  while (parents.has(current) && !visited.has(current)) {
    visited.add(current);
    current = parents.get(current);
    depth += 1;
  }
  return depth;
}

function permissionError(pid, error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    const wrapped = new Error(`Permission denied while stopping PID ${pid}. Try again with elevated privileges.`);
    wrapped.code = error.code;
    return wrapped;
  }
  return error;
}
