import fs from 'node:fs/promises';
import path from 'node:path';
import { execute, executeAllowFailure } from './command.js';

const SUPPORTED_PLATFORMS = new Set(['linux', 'darwin', 'win32']);

export async function findListeners(port, platform = process.platform) {
  assertSupported(platform);

  if (platform === 'linux') return findLinuxListeners(port);
  if (platform === 'darwin') return findDarwinListeners(port);
  return findWindowsListeners(port);
}

export async function getProcess(pid, platform = process.platform) {
  assertSupported(platform);

  if (platform === 'linux') return getLinuxProcess(pid);
  if (platform === 'darwin') return getDarwinProcess(pid);
  return getWindowsProcess(pid);
}

export async function getProcessTable(platform = process.platform) {
  assertSupported(platform);

  if (platform === 'linux') return getLinuxProcessTable();
  if (platform === 'darwin') return getPsProcessTable();
  return getWindowsProcessTable();
}

function assertSupported(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported operating system: ${platform}`);
  }
}

async function findLinuxListeners(port) {
  const tables = [
    ['/proc/net/tcp', 'TCP', true],
    ['/proc/net/tcp6', 'TCP', true],
    ['/proc/net/udp', 'UDP', false],
    ['/proc/net/udp6', 'UDP', false],
  ];
  const sockets = new Map();

  await Promise.all(
    tables.map(async ([file, protocol, tcp]) => {
      let contents;
      try {
        contents = await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }

      for (const socket of parseLinuxSocketTable(contents, protocol, tcp)) {
        if (socket.port !== port) continue;
        const existing = sockets.get(socket.inode) ?? [];
        existing.push(socket);
        sockets.set(socket.inode, existing);
      }
    }),
  );

  if (sockets.size === 0) return [];

  const entries = await fs.readdir('/proc', { withFileTypes: true });
  const pids = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const listeners = [];
  const resolvedInodes = new Set();
  let permissionDenied = false;

  for (let index = 0; index < pids.length; index += 64) {
    const chunk = pids.slice(index, index + 64);
    const matches = await Promise.all(chunk.map((pid) => linuxSocketsForPid(pid, sockets)));
    for (const match of matches) {
      listeners.push(...match.listeners);
      for (const inode of match.resolvedInodes) resolvedInodes.add(inode);
      permissionDenied ||= match.permissionDenied;
    }
  }

  if (permissionDenied && resolvedInodes.size < sockets.size) {
    const error = new Error(`Port ${port} is in use, but permission was denied while identifying its owner.`);
    error.code = 'EACCES';
    throw error;
  }
  return dedupeListeners(listeners);
}

export function parseLinuxSocketTable(contents, protocol, tcp = protocol === 'TCP') {
  const sockets = [];

  for (const line of contents.trim().split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    if (tcp && fields[3] !== '0A') continue;

    const [addressHex, portHex] = fields[1].split(':');
    sockets.push({
      protocol,
      address: decodeLinuxAddress(addressHex),
      port: Number.parseInt(portHex, 16),
      inode: fields[9],
    });
  }

  return sockets;
}

async function linuxSocketsForPid(pid, sockets) {
  let descriptors;
  try {
    descriptors = await fs.readdir(`/proc/${pid}/fd`);
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) {
      return { listeners: [], resolvedInodes: [], permissionDenied: true };
    }
    if (error.code === 'ENOENT') {
      return { listeners: [], resolvedInodes: [], permissionDenied: false };
    }
    throw error;
  }

  const found = [];
  const resolvedInodes = new Set();
  let permissionDenied = false;
  for (let index = 0; index < descriptors.length; index += 128) {
    await Promise.all(
      descriptors.slice(index, index + 128).map(async (descriptor) => {
      try {
        const target = await fs.readlink(`/proc/${pid}/fd/${descriptor}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (!match || !sockets.has(match[1])) return;
        resolvedInodes.add(match[1]);
        for (const endpoint of sockets.get(match[1])) found.push({ pid, ...endpoint });
      } catch (error) {
        if (['EACCES', 'EPERM'].includes(error.code)) permissionDenied = true;
        else if (error.code !== 'ENOENT') throw error;
      }
      }),
    );
  }
  return { listeners: found, resolvedInodes, permissionDenied };
}

function decodeLinuxAddress(hex) {
  if (hex.length === 8) {
    return hex.match(/../g).reverse().map((byte) => Number.parseInt(byte, 16)).join('.');
  }

  if (hex.length !== 32) return hex;
  const normalized = hex.match(/.{8}/g)
    .map((word) => word.match(/../g).reverse().join(''))
    .join('');
  const groups = normalized.match(/.{4}/g).map((group) => Number.parseInt(group, 16).toString(16));
  return compressIpv6(groups);
}

function compressIpv6(groups) {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;

  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === '0') {
      if (currentStart === -1) currentStart = index;
      continue;
    }
    if (currentStart !== -1 && index - currentStart > bestLength) {
      bestStart = currentStart;
      bestLength = index - currentStart;
    }
    currentStart = -1;
  }

  if (bestLength < 2) return groups.join(':');
  const before = groups.slice(0, bestStart).join(':');
  const after = groups.slice(bestStart + bestLength).join(':');
  return `${before}::${after}`;
}

async function getLinuxProcess(pid) {
  try {
    const [stat, status, cmdline, executable] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      fs.readFile(`/proc/${pid}/status`, 'utf8'),
      fs.readFile(`/proc/${pid}/cmdline`, 'utf8'),
      fs.readlink(`/proc/${pid}/exe`).catch(() => ''),
    ]);
    const closeParen = stat.lastIndexOf(')');
    const name = stat.slice(stat.indexOf('(') + 1, closeParen);
    const remainder = stat.slice(closeParen + 2).trim().split(/\s+/);
    const uidMatch = /^Uid:\s+(\d+)/m.exec(status);
    const uid = uidMatch ? Number(uidMatch[1]) : undefined;

    return {
      pid,
      ppid: Number(remainder[1]),
      name,
      user: await linuxUsername(uid),
      command: cmdline.split('\0').filter(Boolean).join(' ') || name,
      executable,
    };
  } catch (error) {
    if (['EACCES', 'ENOENT', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

let passwdCache;
async function linuxUsername(uid) {
  if (uid === undefined) return undefined;
  if (!passwdCache) {
    try {
      const passwd = await fs.readFile('/etc/passwd', 'utf8');
      passwdCache = new Map(
        passwd.split('\n').map((line) => line.split(':')).filter((parts) => parts.length > 2)
          .map((parts) => [Number(parts[2]), parts[0]]),
      );
    } catch {
      passwdCache = new Map();
    }
  }
  return passwdCache.get(uid) ?? String(uid);
}

async function getLinuxProcessTable() {
  const entries = await fs.readdir('/proc', { withFileTypes: true });
  const table = [];
  const processes = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
  for (let index = 0; index < processes.length; index += 128) {
    await Promise.all(processes.slice(index, index + 128).map(async (entry) => {
      try {
        const stat = await fs.readFile(`/proc/${entry.name}/stat`, 'utf8');
        const remainder = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        table.push({ pid: Number(entry.name), ppid: Number(remainder[1]) });
      } catch (error) {
        if (!['EACCES', 'ENOENT', 'EPERM'].includes(error.code)) throw error;
      }
    }));
  }
  return table;
}

async function findDarwinListeners(port) {
  const commands = [
    ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-FpcuLnP'],
    ['-nP', '-a', `-iUDP:${port}`, '-FpcuLnP'],
  ];
  const listeners = [];

  for (const args of commands) {
    const result = await executeAllowFailure('lsof', args);
    if (result.exitCode > 1) throw new Error(result.stderr.trim() || 'lsof failed');
    listeners.push(...parseLsof(result.stdout, port));
  }

  return dedupeListeners(listeners);
}

export function parseLsof(output, port) {
  const listeners = [];
  let processRecord = {};
  let protocol;

  for (const line of output.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') processRecord = { pid: Number(value) };
    else if (field === 'c') processRecord.name = value;
    else if (field === 'L') processRecord.user = value;
    else if (field === 'P') protocol = value.toUpperCase();
    else if (field === 'n' && processRecord.pid) {
      const local = value.split('->')[0];
      if (endpointPort(local) === port) {
        listeners.push({
          ...processRecord,
          protocol: protocol || 'TCP',
          address: endpointAddress(local),
          port,
        });
      }
    }
  }
  return listeners;
}

async function getDarwinProcess(pid) {
  const result = await executeAllowFailure('ps', [
    '-p', String(pid), '-o', 'ppid=', '-o', 'user=', '-o', 'comm=', '-o', 'args=',
  ]);
  const line = result.stdout.trim();
  if (!line) return null;
  const match = /^(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
  if (!match) return null;
  return {
    pid,
    ppid: Number(match[1]),
    user: match[2],
    executable: match[3],
    name: path.basename(match[3]),
    command: match[4] || match[3],
  };
}

async function getPsProcessTable() {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=']);
  return stdout.split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2)
    .map(([pid, ppid]) => ({ pid: Number(pid), ppid: Number(ppid) }))
    .filter((item) => Number.isInteger(item.pid) && Number.isInteger(item.ppid));
}

async function findWindowsListeners(port) {
  try {
    const result = await runPowerShell(`
$tcp = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid = $_.OwningProcess; protocol = 'TCP'; address = $_.LocalAddress; port = $_.LocalPort } })
$udp = @(Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid = $_.OwningProcess; protocol = 'UDP'; address = $_.LocalAddress; port = $_.LocalPort } })
@($tcp + $udp) | ConvertTo-Json -Compress
`);
    return dedupeListeners(asArray(parseJson(result.stdout)));
  } catch (error) {
    if (error.code !== 'ENOENT' && !String(error.stderr).includes('Get-NetTCPConnection')) throw error;
    return findWindowsListenersWithNetstat(port);
  }
}

async function findWindowsListenersWithNetstat(port) {
  const { stdout } = await execute('netstat.exe', ['-ano']);
  return parseWindowsNetstat(stdout, port);
}

export function parseWindowsNetstat(stdout, port) {
  const listeners = [];
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toUpperCase();
    if (protocol === 'TCP' && fields[3]?.toUpperCase() === 'LISTENING' && endpointPort(fields[1]) === port) {
      listeners.push({ pid: Number(fields[4]), protocol, address: endpointAddress(fields[1]), port });
    } else if (protocol === 'UDP' && endpointPort(fields[1]) === port) {
      listeners.push({ pid: Number(fields[3]), protocol, address: endpointAddress(fields[1]), port });
    }
  }
  return dedupeListeners(listeners);
}

async function getWindowsProcess(pid) {
  const result = await runPowerShell(`
$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue
if ($null -ne $p) {
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue
  [pscustomobject]@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; name = $p.Name; command = $p.CommandLine; executable = $p.ExecutablePath; user = $owner.User } | ConvertTo-Json -Compress
}
`);
  const item = parseJson(result.stdout);
  return item ? normalizeProcess(item) : null;
}

async function getWindowsProcessTable() {
  const result = await runPowerShell(
    "@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId } }) | ConvertTo-Json -Compress",
  );
  return asArray(parseJson(result.stdout)).map(normalizeProcess);
}

async function runPowerShell(script) {
  let lastError;
  for (const binary of ['powershell.exe', 'pwsh.exe']) {
    try {
      return await execute(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]);
    } catch (error) {
      lastError = error;
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw lastError;
}

function parseJson(value) {
  const trimmed = value.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeProcess(processInfo) {
  return {
    ...processInfo,
    pid: Number(processInfo.pid),
    ppid: Number(processInfo.ppid),
  };
}

function endpointPort(endpoint = '') {
  const match = /:(\d+)$/.exec(endpoint);
  return match ? Number(match[1]) : undefined;
}

function endpointAddress(endpoint = '') {
  const match = /^(.*):(\d+)$/.exec(endpoint);
  const address = match ? match[1] : endpoint;
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

function dedupeListeners(listeners) {
  const seen = new Set();
  return listeners.filter((listener) => {
    const key = `${listener.pid}:${listener.protocol}:${listener.address}:${listener.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Number.isInteger(Number(listener.pid)) && Number(listener.pid) > 0;
  }).map((listener) => ({ ...listener, pid: Number(listener.pid), port: Number(listener.port) }));
}

export const internals = { decodeLinuxAddress, endpointAddress, endpointPort };
