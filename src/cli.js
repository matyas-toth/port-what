import { createRequire } from 'node:module';
import { killListeners } from './kill.js';
import { createOutput } from './output.js';
import { findListeners } from './platform.js';
import { describeListeners } from './processes.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export async function run(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    platform = process.platform,
    find = findListeners,
    describe = describeListeners,
    kill = killListeners,
  } = {},
) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    createOutput(stderr).error(error.message);
    stderr.write('Run port-what --help for usage.\n');
    return 2;
  }

  const output = createOutput(stdout, { color: options.color });
  if (options.help) {
    output.help(version);
    return 0;
  }
  if (options.version) {
    output.version(version);
    return 0;
  }

  try {
    const listeners = await find(options.port, platform);
    if (listeners.length === 0) {
      output.free(options.port);
      return 0;
    }

    const descriptions = await describe(listeners, platform);
    if (!options.kill) {
      output.found(options.port, descriptions);
      return 0;
    }

    output.killing(descriptions);
    const result = await kill(listeners, options.port, platform);
    if (result.remaining.length > 0) {
      output.failedToFree(options.port, result.remaining);
      return 1;
    }
    output.killed(options.port, result);
    return 0;
  } catch (error) {
    createOutput(stderr, { color: options.color }).error(friendlyError(error, platform));
    return 1;
  }
}

export function parseArgs(argv) {
  const result = { kill: false, color: undefined, help: false, version: false };
  const positional = [];

  for (const argument of argv) {
    if (argument === '--kill' || argument === '-k') result.kill = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--version' || argument === '-v') result.version = true;
    else if (argument === '--no-color') result.color = false;
    else if (argument === '--color') result.color = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else positional.push(argument);
  }

  if (result.help || result.version) return result;
  if (positional.length === 0) throw new Error('A port is required.');
  if (positional.length > 1) throw new Error('Expected exactly one port.');

  const port = Number(positional[0]);
  if (!/^\d+$/.test(positional[0]) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${positional[0]}. Expected a number from 1 to 65535.`);
  }
  result.port = port;
  return result;
}

function friendlyError(error, platform) {
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    const suffix = /elevated privileges/i.test(error.message)
      ? ''
      : ' You may need to run the command with elevated privileges.';
    return `${error.message}${suffix}`;
  }
  if (error.code === 'ENOENT' && platform === 'darwin') {
    return 'The built-in macOS “lsof” command could not be found.';
  }
  return error.message || String(error);
}
