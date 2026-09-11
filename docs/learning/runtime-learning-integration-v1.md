# VITO Runtime Learning Integration v1

This phase connects the Self-Learning Core to VITO's central command execution path.

## Runtime position

Learning retrieval runs only after authentication, handler resolution and command policy checks succeed, and immediately before `handler.execute()`.

The runtime query is deterministic and bounded. It is built from the command type, target and primitive command parameters, capped at 512 characters. Retrieval is capped at 8 items.

## Execution contract

Retrieved `EXPERIENCE`, `LEARNING_CANDIDATE` and `FAILURE_PATTERN` records are attached to the internal `VitoCommand.learningContext` passed to the command handler.

This makes prior learning available at execution time without changing approval levels, command policy or handler registration.

## Safety boundary

Runtime learning is advisory in v1:

- authentication and authorization happen before retrieval;
- rejected or unresolved commands do not retrieve tenant learning;
- retrieval failure does not bypass governance and does not block an otherwise authorized command;
- retrieval failure is audited as `COMMAND.LEARNING_RETRIEVAL_FAILED`;
- successful command start audit metadata records the number and kinds of retrieved learning items;
- retrieved learning cannot autonomously alter approval levels, activate skills, modify production code or promote learning maturity.

## Failure behavior

If the Learning Store is unavailable, the handler receives an empty `learningContext`. Existing command execution semantics remain intact. This prevents the learning layer from becoming a new single point of failure while keeping failures observable through the audit trail.

## Next boundary

A later agent/planner layer may explicitly interpret `learningContext` when selecting plans or capability parameters. Runtime Learning Integration v1 only guarantees that governed prior evidence is retrieved and supplied before execution.
