import dgram from 'node:dgram';
import net from 'node:net';
import { spawn } from 'node:child_process';

const protocol = process.argv[2] || 'tcp';
const server = protocol === 'udp' ? dgram.createSocket('udp4') : net.createServer();
const descendant = protocol === 'tcp'
  ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { stdio: 'ignore' })
  : null;

const onListening = () => {
  process.stdout.write(`${server.address().port} ${descendant?.pid ?? ''}\n`);
};

if (protocol === 'udp') server.bind(0, '127.0.0.1', onListening);
else server.listen(0, '127.0.0.1', onListening);

process.on('SIGTERM', () => server.close(() => process.exit(0)));
