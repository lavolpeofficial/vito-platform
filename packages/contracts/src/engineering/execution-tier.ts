import { ProviderType } from './provider-registry.js';

export enum ExecutionTier {
  LOCAL_ISOLATED = 'LOCAL_ISOLATED',
  CLOUD_GOVERNED = 'CLOUD_GOVERNED',
}

export interface CloudExecutionProfile {
  readonly profileId: string;
  readonly providerCode: string;
  readonly credentialRef: string;
  readonly trustedLauncherAlias: string;
  readonly readinessProbeLauncherAlias?: string;
  readonly expectedProviderId: string;
  readonly allowedModelIds?: readonly string[];
  readonly maxDurationMs: number;
  readonly maxParallelism: number;
  readonly enabled: boolean;
}

export function isCloudGovernedProviderType(providerType: ProviderType): boolean {
  return providerType === ProviderType.CLOUD_LLM;
}

export function resolveExecutionTier(providerType: ProviderType, cloudProfile: CloudExecutionProfile | null): ExecutionTier | null {
  if (providerType === ProviderType.LOCAL_TOOL) return cloudProfile === null ? ExecutionTier.LOCAL_ISOLATED : null;
  if (isCloudGovernedProviderType(providerType)) return cloudProfile !== null && cloudProfile.enabled ? ExecutionTier.CLOUD_GOVERNED : null;
  return null;
}

const PROFILE_ID_PATTERN=/^[a-zA-Z0-9._-]{1,64}$/;
const PROVIDER_CODE_PATTERN=/^[a-zA-Z0-9._-]{1,64}$/;
const CREDENTIAL_REF_PATTERN=/^[a-zA-Z0-9._:-]{1,256}$/;
const LAUNCHER_ALIAS_PATTERN=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROVIDER_ID_PATTERN=/^[a-zA-Z0-9._:-]{1,128}$/;
const MODEL_ID_PATTERN=/^[a-zA-Z0-9._:\/-]{1,128}$/;
const MAX_ALLOWED_MODEL_IDS=64;
export const CLOUD_EXECUTION_PROFILE_MIN_DURATION_MS=1_000;
export const CLOUD_EXECUTION_PROFILE_MAX_DURATION_MS=86_400_000;
export const CLOUD_EXECUTION_PROFILE_MAX_PARALLELISM=3;

export function toValidatedCloudExecutionProfile(raw:unknown):CloudExecutionProfile|null{
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))return null;const value=raw as Record<string,unknown>;
  const profileId=value.profileId;if(typeof profileId!=='string'||!PROFILE_ID_PATTERN.test(profileId))return null;
  const providerCode=value.providerCode;if(typeof providerCode!=='string'||!PROVIDER_CODE_PATTERN.test(providerCode))return null;
  const credentialRef=value.credentialRef;if(typeof credentialRef!=='string'||!CREDENTIAL_REF_PATTERN.test(credentialRef))return null;
  const trustedLauncherAlias=value.trustedLauncherAlias;if(typeof trustedLauncherAlias!=='string'||!LAUNCHER_ALIAS_PATTERN.test(trustedLauncherAlias))return null;
  let readinessProbeLauncherAlias:string|undefined;if(value.readinessProbeLauncherAlias!==undefined){if(typeof value.readinessProbeLauncherAlias!=='string'||!LAUNCHER_ALIAS_PATTERN.test(value.readinessProbeLauncherAlias))return null;readinessProbeLauncherAlias=value.readinessProbeLauncherAlias;}
  const expectedProviderId=value.expectedProviderId;if(typeof expectedProviderId!=='string'||!PROVIDER_ID_PATTERN.test(expectedProviderId))return null;
  let allowedModelIds:readonly string[]|undefined;if(value.allowedModelIds!==undefined){if(!Array.isArray(value.allowedModelIds)||value.allowedModelIds.length===0||value.allowedModelIds.length>MAX_ALLOWED_MODEL_IDS)return null;const normalized:string[]=[];for(const entry of value.allowedModelIds){if(typeof entry!=='string'||!MODEL_ID_PATTERN.test(entry))return null;normalized.push(entry);}if(new Set(normalized).size!==normalized.length)return null;allowedModelIds=Object.freeze(normalized);}
  const maxDurationMs=value.maxDurationMs;if(typeof maxDurationMs!=='number'||!Number.isInteger(maxDurationMs)||maxDurationMs<CLOUD_EXECUTION_PROFILE_MIN_DURATION_MS||maxDurationMs>CLOUD_EXECUTION_PROFILE_MAX_DURATION_MS)return null;
  const maxParallelism=value.maxParallelism;if(typeof maxParallelism!=='number'||!Number.isInteger(maxParallelism)||maxParallelism<1||maxParallelism>CLOUD_EXECUTION_PROFILE_MAX_PARALLELISM)return null;
  const enabled=value.enabled;if(typeof enabled!=='boolean')return null;
  return Object.freeze({profileId,providerCode,credentialRef,trustedLauncherAlias,...(readinessProbeLauncherAlias!==undefined?{readinessProbeLauncherAlias}:{}),expectedProviderId,...(allowedModelIds!==undefined?{allowedModelIds}:{}),maxDurationMs,maxParallelism,enabled});
}
