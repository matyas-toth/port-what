import { getProcess } from './platform.js';

const MAX_ANCESTORS = 4;

export async function describeListeners(listeners, platform = process.platform) {
  const byPid = new Map();
  for (const listener of listeners) {
    const existing = byPid.get(listener.pid) ?? [];
    existing.push(listener);
    byPid.set(listener.pid, existing);
  }

  const descriptions = [];
  for (const [pid, endpoints] of byPid) {
    const processInfo = await getProcess(pid, platform) ?? fallbackProcess(endpoints[0]);
    const ancestors = await getAncestors(processInfo.ppid, platform);
    descriptions.push({ ...processInfo, endpoints, ancestors });
  }
  return descriptions.sort((a, b) => a.pid - b.pid);
}

async function getAncestors(startPid, platform) {
  const ancestors = [];
  const visited = new Set([process.pid]);
  let pid = startPid;

  while (pid > 0 && ancestors.length < MAX_ANCESTORS && !visited.has(pid)) {
    visited.add(pid);
    const processInfo = await getProcess(pid, platform);
    if (!processInfo) break;
    ancestors.push(processInfo);
    pid = processInfo.ppid;
  }
  return ancestors;
}

function fallbackProcess(listener) {
  return {
    pid: listener.pid,
    ppid: 0,
    name: listener.name || 'unknown process',
    user: listener.user,
    command: listener.name || '',
    executable: '',
  };
}
