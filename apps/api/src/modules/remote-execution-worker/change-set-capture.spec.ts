import { captureGovernedResultSettling, ChangeSetCaptureError, MAX_PATCH_BYTES } from './change-set-capture';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkspaceHandle } from './types';

function initRepo(repoPath: string): string {
  execFileSync('git', ['init', repoPath], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@vito.dev'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Vito Test'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  writeFileSync(join(repoPath, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
}

function makeWorkspace(repoPath: string, sha: string): WorkspaceHandle {
  return {
    worktreePath: repoPath,
    baseSha: sha,
    role: 'builder',
    repositoryId: 'test/spec',
    createdAt: new Date(),
  };
}

describe('captureGovernedResultSettling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vito-cs-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('untracked new file content survives capture', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    writeFileSync(join(repoPath, 'new-file.ts'), 'export const x = 1;\n');

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-001',
    );

    expect(result.changedFiles).toContain('new-file.ts');
    expect(result.patch).toContain('new file mode');
    expect(result.patch).toContain('export const x = 1;');
    expect(result.empty).toBe(false);
  });

  it('new binary file survives capture', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    const binaryData = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;
    writeFileSync(join(repoPath, 'image.bin'), binaryData);

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-002',
    );

    expect(result.changedFiles).toContain('image.bin');
    expect(result.patch).toContain('new file mode');
    const hasBinary =
      result.patch.includes('GIT binary patch') ||
      result.patch.includes('delta ') ||
      result.patch.includes('literal ');
    expect(hasBinary).toBe(true);
  });

  it('tracked modification survives', async () => {
    const repoPath = join(tmpDir, 'repo');
    execFileSync('git', ['init', repoPath], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@vito.dev'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Vito Test'], { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(repoPath, 'file.ts'), 'old content\n');
    execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoPath, stdio: 'pipe' });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();

    writeFileSync(join(repoPath, 'file.ts'), 'new content\n');

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-003',
    );

    expect(result.changedFiles).toContain('file.ts');
    expect(result.patch).toContain('-old content');
    expect(result.patch).toContain('+new content');
  });

  it('deletion survives', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    rmSync(join(repoPath, 'README.md'));

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-004',
    );

    expect(result.changedFiles).toContain('README.md');
    expect(result.patch).toContain('deleted file mode');
  });

  it('mixed change-set is reconstructable', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    writeFileSync(join(repoPath, 'tracked.ts'), 'tracked\n');
    writeFileSync(join(repoPath, 'to-delete.ts'), 'delete me\n');
    execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add two files'], {
      cwd: repoPath,
      stdio: 'pipe',
    });

    writeFileSync(join(repoPath, 'tracked.ts'), 'modified\n');
    writeFileSync(join(repoPath, 'brand-new.ts'), 'new\n');
    rmSync(join(repoPath, 'to-delete.ts'));

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-005',
    );

    expect(result.changedFiles).toContain('tracked.ts');
    expect(result.changedFiles).toContain('brand-new.ts');
    expect(result.changedFiles).toContain('to-delete.ts');
    expect(result.patch).toContain('deleted file mode');
    expect(result.patch).toContain('new file mode');
    expect(result.patch).toContain('+modified');
    expect(result.patch).toContain('+new\n');
  });

  it('returns executionId and baseSha', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-006',
    );

    expect(result.executionId).toBe('exec-006');
    expect(result.baseSha).toBe(sha);
  });

  it('empty workspace produces empty change-set', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    const result = await captureGovernedResultSettling(
      makeWorkspace(repoPath, sha),
      'exec-007',
    );

    expect(result.changedFiles).toEqual([]);
    expect(result.patch).toBe('');
    expect(result.empty).toBe(true);
  });

  it('CHANGESET_TOO_LARGE when patch exceeds MAX_PATCH_BYTES', async () => {
    const repoPath = join(tmpDir, 'repo');
    const sha = initRepo(repoPath);

    for (let i = 0; i < 200; i++) {
      writeFileSync(join(repoPath, `large-${i}.txt`), 'A'.repeat(12000));
    }

    await expect(
      captureGovernedResultSettling(
        makeWorkspace(repoPath, sha),
        'exec-008',
      ),
    ).rejects.toThrow(ChangeSetCaptureError);

    try {
      await captureGovernedResultSettling(
        makeWorkspace(repoPath, sha),
        'exec-008',
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ChangeSetCaptureError);
      expect((error as ChangeSetCaptureError).code).toBe('CHANGESET_TOO_LARGE');
      expect((error as ChangeSetCaptureError).message).toContain(
        String(MAX_PATCH_BYTES),
      );
    }
  });
});
