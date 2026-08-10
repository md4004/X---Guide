# docs/verified-behaviour.md

One entry per behaviour the engine simulates, with the source that confirmed it and the
date it was confirmed. This log is the defence against fidelity drift.

**Rule:** no behaviour ships in the engine without an entry here. If you cannot verify
it, it goes in `docs/unverified.md` and stays out of the engine — explain it in prose
instead. See CLAUDE.md > Fidelity rule.

## Format

| ID  | Behaviour | Verified against | Date | Notes |
| --- | --------- | ---------------- | ---- | ----- |

- **ID** — `VB-nnn`, referenced from the test that asserts it.
- **Verified against** — a named F&O environment and version, or a specific Microsoft
  Learn page with its URL. "I'm pretty sure" is not a source.
- **Date** — when it was checked. Behaviour changes between releases; a five-year-old
  verification is a claim, not a fact.

## Entries

| ID     | Behaviour                                                                                                                            | Verified against                           | Date       | Notes                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| VB-001 | `ttsAbort` discards **all** changes in the transaction and returns `ttsLevel` to 0, regardless of the nesting depth it was called at | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | "explicitly discards all changes in the current transaction … the database is rolled back to the original state, where nothing is changed" |
| VB-002 | Nested `ttsBegin`/`ttsCommit` commit nothing until the outermost `ttsCommit`                                                         | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | "nothing is committed until a successful exit from the final **ttsCommit** statement occurs"                                               |
| VB-003 | A record may only be updated or deleted if it was first selected for update (`forUpdate` check)                                      | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | Enforced in Phase 3; the buffer's `selectedForUpdate` flag exists in the runtime types for it                                              |
| VB-004 | A record may only be updated or deleted in the same transaction scope in which it was selected for update (`ttsLevel` check)         | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | Enforced in Phase 3. Phase 1 supplies the `ttsLevel` the check reads                                                                       |

[1]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-data/xpp-transaction

### On VB-001 and PLAN.md's Phase 1 acceptance criterion

PLAN.md asks for "a test that opens nested transactions, aborts the inner one, and asserts
the outer state is intact". That is SQLite savepoint behaviour, not X++ behaviour — in X++
an abort at any depth discards everything (VB-001).

Both are implemented and both are tested, at the layer where each is true:

- `SavepointStack` (`src/core/savepoints.ts`) is the raw SQLite mechanism. Rolling back to
  an inner savepoint there does leave the outer work intact, and
  `test/savepoints.test.ts` asserts exactly that. This is the criterion as written.
- `TransactionManager` (`src/core/transactions.ts`) implements X++ on top of it, so
  `ttsabort` rolls back to the outermost savepoint and sets `ttsLevel` to 0.
  `test/transactions.test.ts` asserts that, citing VB-001.

Shipping only the savepoint reading would have taught the wrong thing in the lesson where
it matters most (Phase 6, lesson 3). See CLAUDE.md > Fidelity rule.
