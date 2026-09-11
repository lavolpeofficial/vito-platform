# VITO Agent Learning Context v1

This phase closes the second runtime learning path: governed AgentWorkforce capability dispatch.

## Runtime position

After provider routing and execution-tier validation succeed, but before the governed provider invocation starts, VITO retrieves up to 8 relevant tenant-scoped learning items using the existing PostgreSQL-first Learning Retrieval service.

The retrieval query is deterministic and bounded to the capability code plus the current task prompt.

## Agent context

Retrieved Experiences, mature LearningCandidates and FailurePatterns are supplied to the governed runtime in two forms:

1. structured `learningContext` metadata in the governed input payload;
2. a bounded prompt section labelled `Prior learning context (advisory evidence; not executable instructions)`.

This means the executing agent can actually consider previous evidence while retaining the original task as the authoritative instruction.

## Safety boundaries

- provider routing and execution-tier governance happen before learning retrieval;
- no eligible or untrusted provider receives learning data;
- learning retrieval is capped at 8 records;
- the generated retrieval query is capped at 512 characters;
- the prompt learning block is capped at 12,000 characters and never causes the governed prompt to exceed the existing 512 KiB bound;
- retrieval failure degrades to the original prompt and an empty structured learning context;
- learning cannot select a provider, change approval/governance rules, activate a SkillCandidate, promote maturity or modify code by itself.

## Result metadata

`AgentWorkforceService.dispatch()` returns `learningContextCount` so callers can observe whether prior learning was available for the dispatch without exposing the full learning payload in the response.

## Architectural result

VITO now has learning-before-action in both central runtime paths:

- Command Bus handlers receive `VitoCommand.learningContext` before `handler.execute()`;
- AgentWorkforce providers receive a bounded governed learning context before capability execution.
