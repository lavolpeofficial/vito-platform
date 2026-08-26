export const OPERATOR_BRIDGE_CONFIG = Symbol('OPERATOR_BRIDGE_CONFIG');

export interface OperatorBridgeConfig {
  readonly sensitivePayloadTtlHours: number;
  /** Application deployment mode only; this value does not create network isolation. */
  readonly exposure: 'internal';
}

const DEFAULT_SENSITIVE_PAYLOAD_TTL_HOURS = 72;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

export function loadOperatorBridgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperatorBridgeConfig {
  const exposure = environment.OPERATOR_BRIDGE_EXPOSURE ?? 'internal';
  if (exposure !== 'internal') {
    throw new Error(
      'Operator Bridge v0.1 public exposure is forbidden until sensitive-payload cleanup and approved ingress/network controls are deployed and verified.',
    );
  }

  const rawTtl = environment.SENSITIVE_PAYLOAD_TTL_HOURS;
  const sensitivePayloadTtlHours = rawTtl
    ? Number(rawTtl)
    : DEFAULT_SENSITIVE_PAYLOAD_TTL_HOURS;
  const expiryMilliseconds =
    Date.now() + sensitivePayloadTtlHours * 60 * 60 * 1000;
  if (
    !Number.isFinite(sensitivePayloadTtlHours) ||
    sensitivePayloadTtlHours <= 0 ||
    !Number.isFinite(expiryMilliseconds) ||
    expiryMilliseconds > MAX_DATE_MILLISECONDS
  ) {
    throw new Error(
      'SENSITIVE_PAYLOAD_TTL_HOURS must be a positive number within the supported date range.',
    );
  }

  return Object.freeze({
    exposure,
    sensitivePayloadTtlHours,
  });
}
