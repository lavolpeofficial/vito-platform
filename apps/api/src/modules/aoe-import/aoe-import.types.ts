export type AoeEmployeeType = 'ORCHESTRATOR' | 'SPECIALIST' | 'ASSISTANT';
export type AoeRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AoeHandoffEmployee {
  name: string;
  code: string;
  description?: string;
  employee_type: AoeEmployeeType;
  version: string;
  status: 'DRAFT';
  intelligence_tier: 'MINI' | 'MEDI' | 'MAXI' | 'SOVEREIGN';
  autonomy: 'ASSIST' | 'SUPERVISED' | 'HIGH_WITH_GATES';
  human_boundary: string;
  data_access: string[];
  integrations: string[];
  success_metrics: string[];
  risk_level: AoeRiskLevel;
}

export interface AoeHandoffCapability {
  code: string;
  name: string;
  description?: string;
  risk_level: AoeRiskLevel;
  requires_approval: boolean;
  assigned_employee_codes: string[];
}

export interface AoeHandoffPackage {
  organization: string;
  source_variant: 'LEAN' | 'BALANCED' | 'ADVANCED' | 'SOVEREIGN';
  deployment_status: 'DRAFT';
  digital_employees: AoeHandoffEmployee[];
  capabilities: AoeHandoffCapability[];
  workflows: Array<{ name: string; steps: string[]; human_gates: string[] }>;
  audit_policy: { enabled: true; actor_type: 'DIGITAL_EMPLOYEE'; events: string[] };
  human_approval_required: true;
  execution_boundary: string;
}

export interface AoeImportResult {
  organizationId: string;
  sourceVariant: string;
  digitalEmployeesCreated: number;
  capabilitiesCreated: number;
  assignmentsCreated: number;
  status: 'DRAFT';
}
