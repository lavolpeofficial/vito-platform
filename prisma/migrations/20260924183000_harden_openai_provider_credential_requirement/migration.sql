-- Harden the governed OpenAI engineering provider credential boundary.
-- Existing rows created before the bootstrap persisted credentialRequirement
-- inherited the fail-closed UNKNOWN default. This migration narrows only the
-- exact server-owned provider code/type and never changes provider status or
-- capabilities.
UPDATE "agent_providers"
SET "credentialRequirement" = 'REQUIRED'
WHERE "providerCode" = 'cloud.openai.main'
  AND "providerType" = 'CLOUD_LLM'
  AND "credentialRequirement" = 'UNKNOWN';
