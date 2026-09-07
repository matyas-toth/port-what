import { execFile } from 'node:child_process';

export function execute(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

export async function executeAllowFailure(file, args = [], options = {}) {
  try {
    const result = await execute(file, args, options);
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw error;
    }

    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}
