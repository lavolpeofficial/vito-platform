/**
 * Portable source-contract runner for VITO Control Center.
 * Some HEL1 Node.js builds lack optional built-in TypeScript stripping.
 * Use the already pinned TypeScript compiler. The complete native Next build
 * independently checks strict source typing.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = function compileTestSource(mod, file) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowImportingTsExtensions: true,
    },
  });
  const errors = (result.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(errors.map(
      (d) => ts.flattenDiagnosticMessageText(d.messageText, ' '),
    ).join('; '));
  }
  mod._compile(result.outputText, file);
};

const suites = [
  'executive-operations-gate.test.ts',
  'receipt-ledger-contracts.test.ts',
  'specialist-reports-contracts.test.ts',
];
for (const suite of suites) {
  require(path.join(__dirname, suite));
}
