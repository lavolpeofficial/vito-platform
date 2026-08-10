import fs from 'node:fs';
import { AoeImportService } from '../apps/api/src/modules/aoe-import/aoe-import.service';
import type { AoeHandoffPackage } from '../apps/api/src/modules/aoe-import/aoe-import.types';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: pnpm aoe:validate-handoff <package.json>');

const pkg = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as AoeHandoffPackage;
const service = new AoeImportService({} as never, {} as never);
service.validate(pkg);

console.log(`AOE handoff accepted by VITO contract: ${inputPath}`);
console.log(`variant=${pkg.source_variant}; employees=${pkg.digital_employees.length}; capabilities=${pkg.capabilities?.length ?? 0}; status=${pkg.deployment_status}`);
