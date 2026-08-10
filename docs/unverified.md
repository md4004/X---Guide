# docs/unverified.md

Behaviours we believe are true but have not confirmed against a real AOS, and behaviours
we know we cannot faithfully simulate.

Nothing on this list may be implemented in the engine or asserted by a lesson task. Prose
explanation is fine, and is often the right answer — a paragraph that says "this is how it
works and here is why we can't show you" beats an interactive lesson that lies.

## Cannot simulate faithfully

| Topic                                         | Why                                                  | What we do instead                                                            |
| --------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Real query plans and index selection          | SQLite is not SQL Server; the optimiser is different | Teach set-based vs. row-by-row via statement counts, never claim a plan shape |
| Batch framework scheduling and recurrence     | No server, no scheduler                              | Simulate the class _shape_ only (Phase 10), say so in the UI                  |
| Number sequence concurrency and preallocation | Depends on real locking semantics                    | Prose only                                                                    |
| Financial dimension resolution                | Enormous, and wrong-in-detail is worse than absent   | Out of scope for v1                                                           |

## Believed true, not yet verified

_None yet. Add entries as they come up, then move them to `verified-behaviour.md` once
checked against a real environment._

| Topic | What we think | How to verify |
| ----- | ------------- | ------------- |
