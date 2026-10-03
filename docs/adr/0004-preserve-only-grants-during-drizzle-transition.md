---
status: accepted
---

# Preserve only grants during the Drizzle transition

On 2026-10-02, preserve production conversion grants while discarding their existing conversions during the transition from handwritten SQLite migrations to Drizzle. Restore each grant's full configured allowance. Preserve grant IDs, credential verifiers, session signing keys, expiry, revocation, labels, and provisioning inventory so existing trial links and sessions continue under their existing rules.

This supersedes only [ADR 0003](0003-charge-for-accessible-generated-narration.md)'s requirement to preserve historical audiobook access and free replay across this migration. Its duration-accounting policy remains in force for conversions created after the transition. The explicit choice to retain only grants avoids carrying historical conversion and usage data into the new baseline.

## Consequences

- Remove old conversion records, segment usage, start attempts, and registry ownership routes. Old audiobook links become unavailable.
- Apply each object's reset, schema creation, grant restoration, and Drizzle migration journal atomically. Retry failures without losing the retained grants; never reset usage again after the transition succeeds.
- Keep existing Durable Object namespaces. The grant registry class is renamed to `RegistryDurableObject` through a Cloudflare rename migration that preserves its namespace. Newly added account objects use fresh schemas and need no legacy transition. The undeployed account registry is folded into the preserved registry; its coordination tables are added to the unified registry baseline.
- Leave R2 artifacts outside this SQLite migration. Their physical cleanup is separate from removing audiobook access.
- Finish or terminate old running workflows before deployment. The migration does not stop external work already in progress.
- Treat rollback to the handwritten-migration Worker as unsupported after the transition.

The [grant migration guide](../../libs/conversion-grants/README.md) and [registry migration guide](../../libs/registry/README.md) describes supported legacy versions, implementation, and regression coverage. This decision does not establish that production has been migrated.
