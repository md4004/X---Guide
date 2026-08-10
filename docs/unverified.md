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

Add entries as they come up, then move them to `verified-behaviour.md` once checked
against a real environment.

| Topic                             | What we think                                                                                                                                     | How to verify                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `MainAccount` company scoping     | It is genuinely **shared** in F&O (it hangs off a chart of accounts, not a legal entity). Phase 1 models it as company-scoped, which may be wrong | Check `SaveDataPerCompany` on the `MainAccount` table in an AOT. If shared, flip the flag and move the seed rows      |
| `.insert()` outside a transaction | CLAUDE.md asserts it errors. We think `update()` and `delete()` definitely do, but a bare `insert()` may be allowed and auto-committed            | Run a single `.insert()` with no `ttsbegin` in a real environment and read the Infolog                                |
| RecId allocation                  | Modelled as a strictly increasing per-table counter that never reuses a value. Real F&O allocates from a sequence in blocks, so gaps are larger   | Insert, delete, insert again, and compare RecIds. Only matters if a lesson ever asserts on a specific RecId — none do |
| Index selection                   | Our indexes lead with `DATAAREAID` on company-scoped tables, mirroring F&O                                                                        | Compare against a real table's index definitions. Cosmetic today; matters if Phase 7 ever shows index metadata        |

## Deliberately not modelled in Phase 1

- **Referential integrity.** The schema declares relations, but `PRAGMA foreign_keys` is
  off. An orphan row should fail the way F&O fails — a validation error we raise in
  Phase 3 with a teaching message — not with an opaque SQLite constraint error.
- **Field-level validation.** `mandatory` and string lengths are recorded in the schema
  and shown in Phase 7's property grid, but nothing enforces them yet. `validateWrite()`
  is Phase 3's job.
