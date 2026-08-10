import { BadRequestException } from '@nestjs/common';
import { AoeImportService } from './aoe-import.service';
import { AoeHandoffPackage } from './aoe-import.types';

describe('AoeImportService', () => {
  const service = new AoeImportService({} as never, {} as never);

  const validPackage: AoeHandoffPackage = {
    organization: 'ATERIMA Care',
    source_variant: 'BALANCED',
    deployment_status: 'DRAFT',
    digital_employees: [{
      name: 'Qualification Copilot', code: 'QUALIFICATION_COPILOT', employee_type: 'ASSISTANT', version: '0.1.0', status: 'DRAFT',
      intelligence_tier: 'MEDI', autonomy: 'ASSIST', human_boundary: 'Final suitability remains human.', data_access: [], integrations: [], success_metrics: [], risk_level: 'MEDIUM',
    }],
    capabilities: [{ code: 'QUALIFY', name: 'Qualification', risk_level: 'MEDIUM', requires_approval: true, assigned_employee_codes: ['QUALIFICATION_COPILOT'] }],
    workflows: [],
    audit_policy: { enabled: true, actor_type: 'DIGITAL_EMPLOYEE', events: ['employee.created_draft'] },
    human_approval_required: true,
    execution_boundary: 'configuration only',
  };

  it('accepts a valid draft-only package', () => {
    expect(() => service.validate(validPackage)).not.toThrow();
  });

  it('rejects packages that are not draft', () => {
    expect(() => service.validate({ ...validPackage, deployment_status: 'ACTIVE' as never })).toThrow(BadRequestException);
  });

  it('rejects packages without human approval', () => {
    expect(() => service.validate({ ...validPackage, human_approval_required: false as never })).toThrow(BadRequestException);
  });

  it('rejects capability assignments to unknown employees', () => {
    const invalid = { ...validPackage, capabilities: [{ ...validPackage.capabilities[0], assigned_employee_codes: ['UNKNOWN'] }] };
    expect(() => service.validate(invalid)).toThrow(BadRequestException);
  });
});
