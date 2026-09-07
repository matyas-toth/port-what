import assert from 'node:assert/strict';
import { test } from 'node:test';
import { internals, parseLinuxSocketTable, parseLsof, parseWindowsNetstat } from '../src/platform.js';

test('parseLinuxSocketTable finds only listening TCP sockets', () => {
  const table = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345 1
   1: 0100007F:0BB9 0100007F:C001 01 00000000:00000000 00:00000000 00000000 1000 0 99999 1
`;
  assert.deepEqual(parseLinuxSocketTable(table, 'TCP'), [{
    protocol: 'TCP', address: '127.0.0.1', port: 3000, inode: '12345',
  }]);
});

test('Linux address parser handles wildcard IPv4 and IPv6', () => {
  assert.equal(internals.decodeLinuxAddress('00000000'), '0.0.0.0');
  assert.equal(internals.decodeLinuxAddress('00000000000000000000000000000000'), '::');
  assert.equal(internals.decodeLinuxAddress('00000000000000000000000001000000'), '::1');
});

test('parseLsof reads TCP and IPv6 endpoint records', () => {
  const output = [
    'p123',
    'cnode',
    'Ldev',
    'PTCP',
    'n127.0.0.1:3000',
    'p456',
    'cpython',
    'Ldev',
    'PUDP',
    'n[::1]:3000',
  ].join('\n');
  assert.deepEqual(parseLsof(output, 3000), [
    { pid: 123, name: 'node', user: 'dev', protocol: 'TCP', address: '127.0.0.1', port: 3000 },
    { pid: 456, name: 'python', user: 'dev', protocol: 'UDP', address: '::1', port: 3000 },
  ]);
});

test('parseWindowsNetstat reads TCP listeners and UDP bindings', () => {
  const output = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       123
  TCP    [::1]:3000             [::]:0                 LISTENING       456
  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       999
  UDP    127.0.0.1:3000         *:*                                    789
`;
  assert.deepEqual(parseWindowsNetstat(output, 3000), [
    { pid: 123, protocol: 'TCP', address: '0.0.0.0', port: 3000 },
    { pid: 456, protocol: 'TCP', address: '::1', port: 3000 },
    { pid: 789, protocol: 'UDP', address: '127.0.0.1', port: 3000 },
  ]);
});
