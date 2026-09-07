import path from 'node:path';

export function createOutput(stream, { color = supportsColor(stream) } = {}) {
  const paint = createPainter(color);
  return {
    help(version) {
      stream.write([
        `${paint.bold('port-who')} ${paint.dim(`v${version}`)}`,
        '',
        'See what is using a port, then free it.',
        '',
        paint.bold('Usage'),
        '  port-who <port>',
        '  port-who <port> --kill',
        '',
        paint.bold('Options'),
        '  -k, --kill     Stop the process and its descendants',
        '  -h, --help     Show help',
        '  -v, --version  Show the version',
        '      --no-color Disable colors',
        '',
        paint.bold('Examples'),
        '  port-who 3000',
        '  port-who 5173 --kill',
      ].join('\n') + '\n');
    },
    version(version) {
      stream.write(`${version}\n`);
    },
    free(port) {
      stream.write(`${paint.green('✓')} Port ${paint.bold(port)} is free.\n`);
    },
    found(port, descriptions) {
      stream.write(`${paint.yellow('●')} Port ${paint.bold(port)} is in use\n`);
      descriptions.forEach((item, index) => {
        if (index > 0) stream.write('\n');
        const identity = [paint.bold(clean(item.name || 'unknown process')), `PID ${item.pid}`, clean(item.user)]
          .filter(Boolean).join(paint.dim(' · '));
        stream.write(`  ${identity}\n`);

        const endpoints = item.endpoints.map((endpoint) =>
          `${clean(endpoint.protocol)} ${formatEndpoint(endpoint.address, endpoint.port)}`,
        ).join(', ');
        stream.write(`  ${paint.dim('listens')}  ${endpoints}\n`);
        if (item.command) stream.write(`  ${paint.dim('command')}  ${truncate(clean(item.command), terminalWidth(stream) - 11)}\n`);
        if (item.ancestors.length > 0) {
          const ancestry = item.ancestors.map((ancestor) =>
            `${clean(ancestor.name || path.basename(ancestor.executable || '') || 'unknown')} (${ancestor.pid})`,
          ).join(' ← ');
          stream.write(`  ${paint.dim('parent')}   ${truncate(ancestry, terminalWidth(stream) - 11)}\n`);
        }
      });
      stream.write(`\nYou can kill it with ${paint.cyan(`port-who ${port} --kill`)}\n`);
    },
    killing(descriptions) {
      const names = descriptions.map((item) => `${clean(item.name || 'process')} (PID ${item.pid})`).join(', ');
      stream.write(`Stopping ${names}…\n`);
    },
    killed(port, result) {
      const descendants = Math.max(0, new Set(result.killed).size - (result.roots?.length ?? 1));
      const detail = descendants > 0 ? ` and ${descendants} descendant${descendants === 1 ? '' : 's'}` : '';
      const force = result.forced.length > 0 ? paint.dim(' (force was required)') : '';
      const listener = (result.roots?.length ?? 1) === 1 ? 'listener' : 'listeners';
      stream.write(`${paint.green('✓')} Port ${paint.bold(port)} is free. Stopped the ${listener}${detail}.${force}\n`);
    },
    failedToFree(port, listeners) {
      const pids = [...new Set(listeners.map((listener) => listener.pid))].join(', ');
      stream.write(`${paint.red('✗')} Port ${paint.bold(port)} is still in use${pids ? ` by PID ${pids}` : ''}.\n`);
    },
    error(message) {
      stream.write(`${paint.red('Error:')} ${message}\n`);
    },
  };
}

function supportsColor(stream) {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function createPainter(enabled) {
  const wrap = (code) => (value) => enabled ? `\u001B[${code}m${value}\u001B[0m` : String(value);
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
  };
}

function terminalWidth(stream) {
  return Math.max(50, stream.columns || 100);
}

function truncate(value, width) {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(1, width - 1))}…`;
}

function formatEndpoint(address, port) {
  const safeAddress = clean(address);
  const host = safeAddress.includes(':') ? `[${safeAddress}]` : safeAddress;
  return `${host}:${port}`;
}

function clean(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
