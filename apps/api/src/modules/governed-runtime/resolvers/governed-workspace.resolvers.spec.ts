import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  GovernedWorkingDirectoryResolver,
  GovernedHomeDirectoryResolver,
  parseGovernedWorkspaceRoot,
  governedOrgDirectoryName,
} from './governed-workspace.resolvers';

/**
 * Fokussierte B2b-Tests: Governed Working-/Home-Directory-Resolvers.
 *
 * Das Workspace-Root kommt ausschließlich aus vertrauenswürdiger
 * Server-Konfiguration. Tenant-Identifier können niemals Traversal
 * ermöglichen: die organisationsspezifische Directory ist ein deterministischer
 * SHA-256-Ableitungspfad.
 */

const TRUSTED = {
  organizationId: 'org-1',
  workflowRunId: 'run-1',
  workflowStepRunId: 'step-1',
  capabilityCode: 'CODE_BUILD',
  providerId: 'provider-1',
};

describe('parseGovernedWorkspaceRoot', () => {
  it('accepts an absolute path and normalizes it', () => {
    expect(parseGovernedWorkspaceRoot('/srv/vito/workspaces/')).toBe('/srv/vito/workspaces');
  });

  it('fails closed on missing root', () => {
    expect(() => parseGovernedWorkspaceRoot(undefined)).toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
    expect(() => parseGovernedWorkspaceRoot('')).toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
  });

  it('fails closed on a relative root', () => {
    expect(() => parseGovernedWorkspaceRoot('relative/root')).toThrow(
      /GOVERNED_WORKSPACE_ROOT_INVALID/,
    );
  });
});

describe('governedOrgDirectoryName', () => {
  it('is deterministic for the same organization id', () => {
    expect(governedOrgDirectoryName('org-1')).toBe(governedOrgDirectoryName('org-1'));
  });

  it('differs across organizations', () => {
    expect(governedOrgDirectoryName('org-1')).not.toBe(governedOrgDirectoryName('org-2'));
  });

  it('cannot contain traversal sequences or separators for adversarial organization ids', () => {
    for (const hostile of ['../../etc', '..', 'a/b/c', '.\\..\\windows', '\0etc']) {
      const name = governedOrgDirectoryName(hostile);
      expect(name).toMatch(/^[a-f0-9]+$/);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
    }
  });

  it('matches the sha256 hex derivation contract', () => {
    expect(governedOrgDirectoryName('org-1')).toBe(
      createHash('sha256').update('vito-governed-org:org-1').digest('hex'),
    );
  });
});

describe('GovernedWorkingDirectoryResolver', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vito-b2b-workspaces-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('valid org resolves to a governed directory inside the configured root', async () => {
    const resolver = new GovernedWorkingDirectoryResolver(root);
    const dir = await resolver.resolve(TRUSTED);
    expect(dir).toBe(join(root, 'orgs', governedOrgDirectoryName('org-1')));
  });

  it('resolved paths are absolute and normalized descendants of the configured root', async () => {
    const resolver = new GovernedWorkingDirectoryResolver(root);
    const dir = (await resolver.resolve(TRUSTED)) as string;
    expect(dir.startsWith(`${root}/`)).toBe(true);
  });

  it('two organizations resolve different directories', async () => {
    const resolver = new GovernedWorkingDirectoryResolver(root);
    const a = await resolver.resolve({ ...TRUSTED, organizationId: 'org-a' });
    const b = await resolver.resolve({ ...TRUSTED, organizationId: 'org-b' });
    expect(a).not.toBe(b);
  });

  it('traversal-like tenant input cannot escape the configured root', async () => {
    const resolver = new GovernedWorkingDirectoryResolver(root);
    const dir = (await resolver.resolve({
      ...TRUSTED,
      organizationId: '../../etc',
    })) as string;
    expect(dir.startsWith(`${root}/orgs/`)).toBe(true);
    expect(dir).toBe(join(root, 'orgs', governedOrgDirectoryName('../../etc')));
  });

  it('resolution is deterministic across repeated calls', async () => {
    const resolver = new GovernedWorkingDirectoryResolver(root);
    expect(await resolver.resolve(TRUSTED)).toBe(await resolver.resolve(TRUSTED));
  });

  it('construction fails closed on relative or missing root', () => {
    expect(() => new GovernedWorkingDirectoryResolver('relative')).toThrow(
      /GOVERNED_WORKSPACE_ROOT_INVALID/,
    );
    expect(
      () => new GovernedWorkingDirectoryResolver(undefined as unknown as string),
    ).toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
  });
});

describe('GovernedHomeDirectoryResolver', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vito-b2b-home-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves the logical org workspace home deterministically (no OS user home exposure)', async () => {
    const resolver = new GovernedHomeDirectoryResolver(root);
    const home = (await resolver.resolve(TRUSTED)) as string;
    expect(home).toBe(join(root, 'orgs', governedOrgDirectoryName('org-1')));
    expect(home.startsWith('/home')).toBe(false);
    expect(home.startsWith(process.env.HOME ?? '/nonexistent-os-home')).toBe(false);
  });

  it('adversarial tenant input cannot escape the configured root', async () => {
    const resolver = new GovernedHomeDirectoryResolver(root);
    const home = (await resolver.resolve({ ...TRUSTED, organizationId: '../..' })) as string;
    expect(home.startsWith(`${root}/orgs/`)).toBe(true);
  });

  it('construction fails closed on invalid root', () => {
    expect(() => new GovernedHomeDirectoryResolver('')).toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
  });
});
