import { BubblewrapSandboxExecutor } from './sandbox-executor';

describe('BubblewrapSandboxExecutor', () => {
  describe('validateStartup', () => {
    it('CRITICAL: Production with technology=none ALWAYS fails closed', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'production', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /NOT permitted in production/,
      );
    });

    it('Allows technology=none in development', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'development', 'bwrap');
      await expect(executor.validateStartup()).resolves.toBeUndefined();
    });

    it('Allows technology=none in development with NODE_ENV=test', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'test', 'bwrap');
      await expect(executor.validateStartup()).resolves.toBeUndefined();
    });

    it('Rejects unknown technology', async () => {
      const executor = new BubblewrapSandboxExecutor('firejail', 'development', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /Unknown sandbox technology/,
      );
    });

    it('Validates bubblewrap binary exists', async () => {
      const executor = new BubblewrapSandboxExecutor(
        'bubblewrap',
        'development',
        'nonexistent-bwrap',
      );
      await expect(executor.validateStartup()).rejects.toThrow(
        /Bubblewrap binary not found/,
      );
    });

    it('Executes when technology=bubblewrap (validateStartup succeeds if bwrap exists)', async () => {
      const executor = new BubblewrapSandboxExecutor(
        'bubblewrap',
        'development',
        'bwrap',
      );
      await expect(executor.validateStartup()).resolves.toBeUndefined();
    });

    it('CRITICAL: Production rejects sandbox=none unconditionally', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'production', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /NOT permitted in production/,
      );
    });

    it('CRITICAL: Production rejects sandbox=none even if env var was previously set', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'production', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /NOT permitted in production/,
      );
    });
  });
});
