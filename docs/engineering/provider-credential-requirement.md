# Engineering provider credential requirement

The persisted `AgentProvider.credentialRequirement` is execution authority, not descriptive metadata.

## Invariants

- `UNKNOWN` always fails closed in governed invocation.
- The server-owned `cloud.openai.main` engineering provider is `REQUIRED`.
- Generic provider HTTP creation cannot set `credentialRequirement`; only governed server bootstrap code may persist it.
- Provider activation, capability enablement and credential authorization remain separate explicit gates.
- The compatibility migration only tightens legacy `cloud.openai.main` / `CLOUD_LLM` rows from `UNKNOWN` to `REQUIRED`; it does not activate a provider or capability.

A credential-free cloud provider, if introduced later, must use an explicit server-owned contract and must not be represented as a local tool or as an unknown credential state.
