import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const isLinux = process.platform === 'linux';

async function bwrapAvailable(): Promise<boolean> {
  try {
    await execFileAsync('bwrap', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

describe('Bubblewrap E2E', () => {
  it('runs a basic sandboxed command if bwrap and user namespaces are available', async () => {
    if (!isLinux) {
      console.warn('ENVIRONMENT LIMITATION: bwrap E2E requires Linux, skipping');
      return;
    }

    const available = await bwrapAvailable();
    if (!available) {
      console.warn('ENVIRONMENT LIMITATION: bwrap binary not found on host, skipping');
      return;
    }

    try {
      const { stdout } = await execFileAsync(
        'bwrap',
        [
          '--unshare-user',
          '--unshare-net',
          '--ro-bind', '/usr', '/usr',
          '--ro-bind', '/bin', '/bin',
          '--ro-bind', '/lib', '/lib',
          '--tmpfs', '/tmp',
          '--', '/usr/bin/echo', 'hello',
        ],
        { timeout: 10_000 },
      );

      expect(stdout.trim()).toBe('hello');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('No such file or directory') || msg.includes('Operation not permitted')) {
        console.warn(
          `ENVIRONMENT LIMITATION: bwrap is installed but sandboxed execution is not available in this environment: ${msg}`,
        );
        return;
      }
      throw error;
    }
  });
});
