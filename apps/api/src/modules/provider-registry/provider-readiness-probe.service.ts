import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderType,
  type GovernedSandboxConfig,
  type ProviderDeclaration,
} from '@vito/contracts';
import { CLOUD_EXECUTION_WORKER } from '../cloud-governed-execution/cloud-governed-execution.module';
import { CloudExecutionProfileRegistry } from '../cloud-governed-execution/cloud-execution-profile.registry';
import {
  CODE_BUILD_BASE_REF,
  CODE_BUILD_REPOSITORY,
} from '../governed-runtime/adapters/code-build-execution-target';
import { TrustedLocalExecutableResolver } from '../governed-runtime/resolvers/trusted-local-executable.resolver';
import {
  RemoteExecutionWorkerService,
  WorkerExecutionError,
} from '../remote-execution-worker/remote-execution-worker.service';
import { ProviderRuntimeStateService } from './provider-runtime-state.service';

const DEFAULT_PROBE_TIMEOUT_MS = 45_000;
const MIN_PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_TIMEOUT_MS = 120_000;
const PROBE_PROMPT =
  'Provider readiness probe. Return exactly VITO_PROVIDER_READY. Do not edit files, do not run shell commands, do not call subagents or external tools.';

export interface ProviderReadinessProbeResult {
  readonly providerId: string;
  readonly providerCode: string;
  readonly attempted: boolean;
  readonly refreshed: boolean;
  readonly reasonCode: string;
  readonly healthStatus?: ProviderHealthStatus;
  readonly quotaStatus?: ProviderQuotaStatus;
}

@Injectable()
export class ProviderReadinessProbeService {
  private readonly inflight = new Map<string, Promise<ProviderReadinessProbeResult>>();
  private readonly timeoutMs = boundedProbeTimeout(process.env.VITO_PROVIDER_PROBE_TIMEOUT_MS);

  constructor(
    @Inject(CLOUD_EXECUTION_WORKER)
    private readonly cloudWorker: RemoteExecutionWorkerService,
    private readonly profiles: CloudExecutionProfileRegistry,
    private readonly trustedExecutables: TrustedLocalExecutableResolver,
    private readonly runtimeState: ProviderRuntimeStateService,
  ) {}

  async refreshIfStale(input: {
    organizationId: string;
    workflowRunId?: string;
    workflowStepRunId?: string;
    provider: ProviderDeclaration;
  }): Promise<ProviderReadinessProbeResult> {
    if (!this.runtimeState.needsRefresh(input.provider)) {
      return frozenResult(input.provider, false, false, 'STATE_FRESH');
    }
    if (input.provider.providerType !== ProviderType.CLOUD_LLM) {
      return frozenResult(input.provider, false, false, 'PROBE_UNSUPPORTED_PROVIDER_TYPE');
    }

    const profile = this.profiles.resolve(input.provider.providerCode);
    const probeAlias = profile?.readinessProbeLauncherAlias;
    if (!profile || !probeAlias) {
      return frozenResult(input.provider, false, false, 'PROBE_PROFILE_UNAVAILABLE');
    }

    const key = `${input.organizationId}:${input.provider.id}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.probe({ ...input, probeAlias, profile }).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async probe(input: {
    organizationId: string;
    workflowRunId?: string;
    workflowStepRunId?: string;
    provider: ProviderDeclaration;
    probeAlias: string;
    profile: NonNullable<ReturnType<CloudExecutionProfileRegistry['resolve']>>;
  }): Promise<ProviderReadinessProbeResult> {
    const executable = await this.trustedExecutables.resolve(input.probeAlias, {
      organizationId: input.organizationId,
      workflowRunId: input.workflowRunId ?? `provider-probe:${input.provider.id}`,
      capabilityCode: 'PROVIDER_READINESS_PROBE',
      providerId: input.provider.id,
    });
    if (!executable) {
      return frozenResult(input.provider, true, false, 'PROBE_EXECUTABLE_UNAVAILABLE');
    }

    const sandboxConfig: GovernedSandboxConfig = {
      technology: 'none',
      timeoutMs: Math.min(this.timeoutMs, input.profile.maxDurationMs),
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    };

    try {
      const result = await this.cloudWorker.executeSandboxed({
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId ?? `provider-probe:${input.provider.id}`,
        workflowStepRunId: input.workflowStepRunId ?? `provider-probe-step:${input.provider.id}`,
        repositoryId: CODE_BUILD_REPOSITORY,
        baseRef: CODE_BUILD_BASE_REF,
        executable,
        args: ['run', '-'],
        prompt: PROBE_PROMPT,
        sandboxConfig,
        credentialReference: input.profile.credentialRef,
        expectedProviderIdentity: {
          providerId: input.profile.expectedProviderId,
          ...(input.profile.allowedModelIds ? { allowedModelIds: input.profile.allowedModelIds } : {}),
        },
      });

      const observation = classifyProbeResult(result);
      await this.runtimeState.recordProbe(input.organizationId, input.provider.id, observation);
      return Object.freeze({ providerId:input.provider.id,providerCode:input.provider.providerCode,attempted:true,refreshed:true,reasonCode:observation.reasonCode,healthStatus:observation.healthStatus,quotaStatus:observation.quotaStatus });
    } catch (error) {
      const code = error instanceof WorkerExecutionError ? error.code : errorCode(error);
      if (isInfrastructureProbeFailure(code)) return frozenResult(input.provider,true,false,code);
      const observation={healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:code} as const;
      await this.runtimeState.recordProbe(input.organizationId,input.provider.id,observation);
      return Object.freeze({providerId:input.provider.id,providerCode:input.provider.providerCode,attempted:true,refreshed:true,reasonCode:observation.reasonCode,healthStatus:observation.healthStatus,quotaStatus:observation.quotaStatus});
    }
  }
}

function classifyProbeResult(result: Awaited<ReturnType<RemoteExecutionWorkerService['executeSandboxed']>>) {
  const identity=result.observedProviderIdentity; const text=`${result.stdout}\n${result.stderr}`.toLowerCase();
  if(result.governedResultSettling.changedFiles.length>0||!result.governedResultSettling.empty)return{healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:'PROBE_SIDE_EFFECT_DETECTED',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(result.timedOut)return{healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:'PROBE_TIMED_OUT',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(/usage limit has been reached|insufficient[_ -]?quota|quota[_ -]?(exceeded|exhausted)/u.test(text))return{healthStatus:ProviderHealthStatus.HEALTHY,quotaStatus:ProviderQuotaStatus.EXHAUSTED,reasonCode:'PROBE_QUOTA_EXHAUSTED',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(/rate[_ -]?limit|too many requests|\b429\b/u.test(text))return{healthStatus:ProviderHealthStatus.QUOTA_LIMITED,quotaStatus:ProviderQuotaStatus.LIMITED,reasonCode:'PROBE_RATE_LIMITED',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(/unauthorized|authentication|invalid.*(api|token|credential)|oauth.*expired|token.*expired/u.test(text))return{healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:'PROBE_AUTHENTICATION_FAILED',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(result.providerIdentityError)return{healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:result.providerIdentityError.code,durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  if(result.exitCode===0)return{healthStatus:ProviderHealthStatus.HEALTHY,quotaStatus:ProviderQuotaStatus.AVAILABLE,reasonCode:'PROBE_SUCCEEDED',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
  return{healthStatus:ProviderHealthStatus.UNAVAILABLE,quotaStatus:ProviderQuotaStatus.UNKNOWN,reasonCode:'PROBE_PROVIDER_UNAVAILABLE',durationMs:result.durationMs,observedProviderId:identity?.providerId??null,observedModelId:identity?.modelId??null} as const;
}
function frozenResult(provider:ProviderDeclaration,attempted:boolean,refreshed:boolean,reasonCode:string):ProviderReadinessProbeResult{return Object.freeze({providerId:provider.id,providerCode:provider.providerCode,attempted,refreshed,reasonCode});}
function boundedProbeTimeout(raw:string|undefined):number{if(!raw?.trim())return DEFAULT_PROBE_TIMEOUT_MS;const parsed=Number(raw);if(!Number.isInteger(parsed)||parsed<MIN_PROBE_TIMEOUT_MS||parsed>MAX_PROBE_TIMEOUT_MS)return DEFAULT_PROBE_TIMEOUT_MS;return parsed;}
function errorCode(error:unknown):string{if(error&&typeof error==='object'&&'code' in error&&typeof(error as any).code==='string')return(error as any).code;return'PROBE_EXECUTION_ERROR';}
function isInfrastructureProbeFailure(code:string):boolean{return code==='WORKSPACE_PROVISION_FAILED'||code==='REPOSITORY_NOT_ALLOWED'||code==='BASE_REF_NOT_ALLOWED'||code==='PROBE_EXECUTABLE_UNAVAILABLE';}
