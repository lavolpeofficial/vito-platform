# CODE_BUILD dispatch approval integration (PR #128)

CODE_BUILD is denied before provider routing unless the effective server-resolved capability is accompanied by scoped approval evidence from the Operator Bridge. The bridge binds the machine user to the authenticated tenant context and uses its task request ID as the consumption request key. The request fingerprint includes approval ID, mission, repository and branch.

The dispatch-specific approval claim is transactional, tenant-scoped, requires an active `vito-bridge` machine identity, validates mission/repository/feature branch, expiry and revocation, and changes `consumedAt` only once. A second dispatch cannot use the public consume endpoint's idempotent replay behavior. Audit recording occurs in the same transaction. Existing governed runtime and CUSTOS checks remain additional boundaries; this change does not activate capabilities or providers.

The API's standalone workforce and persisted workflow paths fail closed without bridge-provided evidence. The bridge's DTO requires the approval scope for CODE_BUILD. No approval is created, inferred from conversational GO, or granted by this integration. No merge or production deployment is authorized.


## Execution-target binding

Before CODE_BUILD can invoke a provider, VITO resolves the server-owned provider, execution tier, trusted launcher alias, workflow run/step and repository/base target. The single-use approval is then atomically consumed together with a SHA-256 hash and JSON snapshot of that execution target. The governed runtime injects the same server-owned target into the adapter payload and both local and cloud coding adapters fail closed if the target no longer matches the resolved organization, workflow step, provider identity, tier or trusted launcher.

Routing may be recorded before approval consumption so the target can be resolved, but no provider execution occurs until target-bound consumption succeeds. This binding still does not authorize commit publication, merge, deployment, provider/capability activation or Human-Gate approval.
