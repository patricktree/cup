---
status: accepted
---

# Use XState for client lifecycle state machines

Two web app modules had grown into hand-rolled state machines. The account auth lifecycle kept its mode in module-level variables (an auth state, a client promise, a signing-out flag, a previous subject, and a promise queue for media cookie issuance) and compared a session generation counter after about six awaits only to discard results that arrived after sign-in, sign-out, or an account switch. The browser audio engine (`AudiobookPlayer`) tracked loading, playing, and segment transitions the same way. Each new rule had to be checked against every flag, and which async result was still current was decided at the far end of each await rather than by the code that started it. On 2026-10-15 the user chose to model these lifecycles with [XState v5](https://stately.ai/docs/xstate) in the web app.

## Decision

- Use XState for client lifecycles with real modes and cancellable async work: states that accept different commands, and async work that becomes irrelevant when the mode changes.
- Run async work as actors invoked or spawned by the state that needs it. Leaving the state stops them and discards their results; no generation counters or "is still current" flags. Work that cannot be recalled, such as a provider sign-in, settles its caller's promise itself, so the caller still learns the real outcome after the state is left.
- Keep effects that touch the network, the platform, the query cache, or playback injectable through `machine.provide(...)`, so tests drive the real machine with fakes.
- Keep the modules' existing APIs as thin facades over the actor where callers, route loaders, and React already depend on them. A facade exposes a referentially stable snapshot for `useSyncExternalStore` and resolves promises from replies or from `waitFor`.
- The first two adopters are the [account auth lifecycle](../architecture/authentication.md#client-session-lifecycle) and the browser audio engine `AudiobookPlayer`, which a sibling change ports.
- Server state and data fetching stay with TanStack Query, and form state stays with TanStack Form. XState is not a general store and does not replace React state for ordinary components.

## Considered options

- Keep hand-rolled flags and counters. Rejected: the stale-result checks were spread across the module and each new transition had to be audited against all of them.
- A reducer with explicit states but hand-managed async work. It names the modes but still needs a counter or abort plumbing to discard results, which is the part that was error-prone.
- A general-purpose store such as Zustand. Rejected: it holds state but has no notion of states that own async work.

## Consequences

- `xstate` becomes a runtime dependency of `@cup/web-app`, adding a library to learn and to the client bundle.
- The facade adds an indirection: requests become events, and their results return through reply callbacks. Snapshots notify subscribers once per macrostep rather than at each assignment.
- Machines can be tested directly in Node with fake actors, including results that arrive after their state was left.
- Machine diagrams in the architecture pages describe the states and events, not every guard; the machine definition is authoritative.
