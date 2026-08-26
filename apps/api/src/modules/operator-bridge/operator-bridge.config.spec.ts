import { loadOperatorBridgeConfig } from './operator-bridge.config';

describe('loadOperatorBridgeConfig', () => {
  it('defaults to internal exposure and a 72-hour payload TTL', () => {
    expect(loadOperatorBridgeConfig({})).toEqual({
      exposure: 'internal',
      sensitivePayloadTtlHours: 72,
    });
  });

  it('accepts a positive configured TTL for internal development', () => {
    expect(
      loadOperatorBridgeConfig({
        OPERATOR_BRIDGE_EXPOSURE: 'internal',
        SENSITIVE_PAYLOAD_TTL_HOURS: '24.5',
      }),
    ).toEqual({ exposure: 'internal', sensitivePayloadTtlHours: 24.5 });
  });

  it.each(['public', 'PUBLIC', 'external', ''])('rejects exposure mode %p', (exposure) => {
    expect(() => loadOperatorBridgeConfig({ OPERATOR_BRIDGE_EXPOSURE: exposure })).toThrow(
      /public exposure is forbidden/,
    );
  });

  it('rejects public exposure in production', () => {
    expect(() =>
      loadOperatorBridgeConfig({ NODE_ENV: 'production', OPERATOR_BRIDGE_EXPOSURE: 'public' }),
    ).toThrow(/public exposure is forbidden/);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1e20'])('rejects invalid TTL %p', (ttl) => {
    expect(() =>
      loadOperatorBridgeConfig({
        OPERATOR_BRIDGE_EXPOSURE: 'internal',
        SENSITIVE_PAYLOAD_TTL_HOURS: ttl,
      }),
    ).toThrow(/must be a positive number/);
  });
});
