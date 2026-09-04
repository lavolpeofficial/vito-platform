import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const pkgPath = resolve(dirname(module.filename), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

describe('@vito/contracts production packaging', () => {
  it('resolves from built production output (dist/index.js), not TypeScript source', () => {
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  it('exposes a tsc-based build script for the compiled CJS artifact', () => {
    expect(typeof pkg.scripts?.build).toBe('string');
    expect(pkg.scripts.build).toContain('tsc');
  });

  it('keeps test/watcher scripts intact', () => {
    expect(pkg.scripts.test).toBe('jest');
    expect(pkg.scripts['test:watch']).toBe('jest --watch');
  });
});