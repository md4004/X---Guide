# PLAN.md — X++Lab build plan

Read `CLAUDE.md` first. Phases are ordered by dependency. Each has a hard acceptance
criterion — do not advance until it passes.

**MVP = Phases 0–6.** That is a launchable product with a real audience. Phases 7–12 are
the expansion. Resist building 7+ before 6 ships.

---

## Phase 0 — Scaffold ✅

Next.js + TypeScript strict + Tailwind + shadcn. Monorepo workspaces for `/packages`.
Vitest, Playwright, ESLint, Prettier, GitHub Actions running typecheck + tests on PR.
Empty package stubs with their public interfaces declared.

**Accept:** `pnpm test` and `pnpm build` green on CI; every package exports a typed
interface even if unimplemented.

---

## Phase 1 — Virtual database ✅

`packages/virtual-db`. sql.js in a Web Worker. Schema for a starter table set, each with
`RECID` (autoincrement) and `DATAAREAID`:

`CustTable`, `CustTrans`, `VendTable`, `InventTable`, `InventSum`, `SalesTable`,
`SalesLine`, `MainAccount`, `LedgerJournalTable`, `LedgerJournalTrans`, `WMSLocation`,
`InventLocation`, plus `DirPartyTable`.

Hand-authored fictional seed data across three legal entities so cross-company lessons
have something to show. Savepoint-based transaction manager with nesting depth. Snapshot
and reset so every lesson run starts from a known state.

**Accept:** a test seeds, opens nested transactions, aborts the inner one, and asserts the
outer state is intact; company filtering returns only the active `DATAAREAID`.

> **Amended during Phase 1.** "Abort the inner one, outer state intact" is SQLite
> savepoint behaviour, not X++ behaviour — `ttsabort` discards the whole transaction from
> any depth (VB-001). Both are implemented and tested at the layer where each is true:
> `test/savepoints.test.ts` for the criterion as written, `test/transactions.test.ts` for
> the X++ semantics. See the note in `docs/verified-behaviour.md`.

---

## Phase 2 — Lexer and parser ✅

`packages/xpp-lexer`, `packages/xpp-parser`. Hand-written, no parser generator — you need
error messages good enough to teach with. Full AST for the v1 subset in
`docs/language-subset.md`. Errors carry line, column, and a hint.

**Accept:** a corpus of 40+ snippets in `packages/xpp-parser/fixtures/` parses to expected
ASTs, including 10 deliberately broken snippets that produce the expected error codes.

> **Delivered:** 66 valid snippets and 14 broken ones. Valid ASTs are committed as golden
> files under `fixtures/expected/`; error expectations are hand-written in
> `test/errors.test.ts` with exact codes and lines, because "whatever the parser happened
> to say" is not a specification. Precedence is asserted directly rather than
> snapshotted — see VB-005.

---

## Phase 3 — Interpreter ✅

`packages/xpp-runtime`. Tree-walking evaluator over the AST. Scope chain, table buffers as
first-class values, method dispatch, Infolog sink, transaction integration with Phase 1.

`select` statements compile to parameterised SQL — build the compiler as a separate,
independently tested module (`selectToSql`) because its output is a user-visible feature.

Runtime errors must mirror real ones, especially: update outside a transaction, uncommitted
data at end of run, unhandled `Deadlock`/`UpdateConflict` shapes, buffer not selected for
update.

**Accept:** a golden-file suite where each `.xpp` input has an expected Infolog output, an
expected SQL trace, and an expected final DB state. 30+ cases minimum.

> **Delivered:** 55 golden cases in `packages/xpp-runtime/fixtures/`. Three of them —
> VB-008, VB-009, VB-010 — reproduce worked examples whose expected Infolog output
> Microsoft publishes, so their expectation is not ours. One of those caught a real
> inversion in the VB-008 logic that a self-authored expectation would have blessed;
> they are re-asserted explicitly in `test/sourced.test.ts` for that reason.

---

## Phase 4 — Playground UI ✅

Monaco with an X++ TextMate grammar, completions fed from the virtual AOT, inline error
markers from the parser. Run button executes in the worker. Four result panels:

1. **Infolog** — styled like the real one.
2. **Data** — browsable virtual tables with rows changed by this run highlighted.
3. **SQL trace** — the generated statements, in order, with row counts.
4. **Errors** — clickable, jumps to the line.

Reset-environment control. Shareable permalink encoding code + environment state.

**Accept:** paste a `while select` loop that updates rows, hit Run, and see all four panels
populate correctly in under 500ms.

> **Delivered** at `/playground`, asserted in `e2e/playground.spec.ts` including the
> 500ms budget. The grammar is Monarch rather than TextMate — see docs/decisions.md — but
> it and the completions are generated from the engine's own keyword and schema tables,
> so the editor cannot disagree with the parser.

---

## Phase 5 — Lesson engine ✅

Implement `docs/lesson-schema.md`. MDX lesson content with embedded task blocks. A task
declares its validators; the runner executes learner code in an isolated environment
snapshot and evaluates assertions of four kinds:

- **AST assertions** — did they actually use `while select` rather than a nested loop; is
  there a `next` call in the CoC method.
- **State assertions** — expected rows/values after the run.
- **Output assertions** — expected Infolog messages.
- **SQL assertions** — expected statement count or shape (proves set-based vs. row-by-row).

Progressive hints, solution reveal after N attempts, per-lesson progress in localStorage
for now.

**Accept:** one lesson authored end to end in MDX with three tasks, passing and failing
paths both correct, with zero engine changes required to author it.

> **Delivered** as `content/tracks/xpp-fundamentals/02-buffers-and-select.mdx`, served at
> `/learn/[track]/[lesson]`. `packages/validators/test/lesson.test.ts` imports that real
> file and runs every task's solution through its own validators, plus twelve plausible
> wrong answers each asserted against the _specific_ message it should produce — not
> merely that they fail. Two authoring defects surfaced that way and were fixed in the
> content, not the engine, which is the criterion working as intended.

---

## Phase 6 — First guided track (MVP content) — built, not yet user-tested

Track: **X++ fundamentals** — teaches the language from zero, assuming no prior platform.
(This reverses the original "X++ for NAV/BC developers" framing; see decision #4 in
`docs/decisions.md` for what changed and why.)

1. Output and variables — `info`, `strFmt`, primitives and their starting values
2. Reading from the database — `firstonly`, `while select`, read-only vs `forupdate`
3. Transactions — `ttsbegin`/`ttscommit`, nesting, and what `ttsabort` discards
4. Insert, update, delete — `.insert()`, `clear()`, and what is not simulated
5. Joins — `join`, `exists join`, `notexists join`
6. Set-based operations — `update_recordset` vs a loop, with the SQL trace as the proof
7. Companies — `changecompany`, `crosscompany`, and why F&O has one table not N
8. Exceptions — `try`/`catch`/`retry`, `throw`, transaction interaction

Each lesson: 400–800 words of prose split across 5–8 steps, 2–4 validated tasks. Plus the
sandbox mode surfaced as its own route.

**Accept:** a developer with no F&O experience completes all eight in under three hours and
every task validates correctly. Test this on a real person, not on yourself.

> **Half done, and the half that is done is the half a machine can do.** All eight lessons
> exist at `/learn/xpp-fundamentals` — plus lessons 9 and 10 on forms and reports, added
> once the metadata layer landed — with 29 validated tasks. Every solution is run through
> its own validators in CI, and 27 plausible wrong answers are each asserted against the
> specific message they should produce.
>
> **The acceptance criterion is not met and cannot be met from here.** "A developer with no
> F&O experience completes all eight in under three hours" is a claim about a person, and
> nobody has sat down with this yet. What the tests prove is that the tasks are solvable
> and the feedback is specific — not that the explanations land, that the difficulty curve
> is right, or that three hours is the real number. Find one developer and watch them.

---

## Phase 7 — Metadata layer and form renderer — partly built

`packages/virtual-aot`: JSON model for tables, fields, EDTs, base enums, relations, forms.
An AOT tree explorer and a property grid UI. `packages/renderers/form`: renders an
F&O-shaped form (action pane, fast tabs, grid) from metadata bound to a virtual-db query.

Unlocks lessons on table extensions, field properties, EDT reuse, display methods,
computed columns — where "see the result" means the form visibly changes.

**Accept:** a learner adds a field via a table extension in the editor and the rendered
form shows the new field in the right fast tab without a page reload.

---

## Phase 8 — Classes, extensions, Chain of Command

Class declarations, inheritance, static members, attributes. `[ExtensionOf]` resolution
building a CoC chain over our teaching stubs, with `next` calling down the chain. Event
handler attributes (`[PostHandlerFor]`, `[DataEventHandler]`) wired to stub events.

A **chain visualiser** showing the resolved call order — pre-handlers, CoC wrappers, base,
post-handlers. This is the killer diagram for the customisation track; nobody explains it
well and it is exactly what people get wrong.

**Accept:** a lesson where omitting `next` produces the correct silently-broken behaviour
and the visualiser makes the cause obvious.

---

## Phase 9 — Reports

Report data provider classes (`RDPContract`, `processReport`, temp table population) and
`packages/renderers/report` producing an SSRS-shaped rendering — header, grouping, totals,
paging — from the DP output. Design view is metadata-driven, not code.

**Accept:** learner writes a DP class, runs it, sees a rendered report; changing a grouping
property in the designer re-renders correctly.

---

## Phase 10 — Integrations

Data entity metadata over virtual tables. A mock OData endpoint (`/data/{Entity}`) served
from the worker, supporting `$select`, `$filter`, `$top`, `$expand`, and POST/PATCH. A
request console — a lean Postman — so learners fire calls and see JSON alongside the
resulting DB state change.

Also: an inbound-integration lesson where they parse a JSON payload in X++ and post it to
a journal, which is the shape of most real integration work.

**Accept:** learner defines an entity in metadata, queries it over the mock OData with a
`$filter`, and sees both the JSON response and the SQL it generated.

---

## Phase 11 — Accounts, persistence, sandbox

Supabase auth (GitHub + email). Server-side progress, streaks, per-track completion.
Named sandbox projects with saved environment snapshots. Public permalinks.

**Accept:** progress survives logout, device change, and a browser cache clear.

---

## Phase 12 — Scale and monetise

Content pipeline for contributed lessons. Analytics on where learners stall (this tells you
which lessons are wrong). Tracks for reports, customisation, integration, performance.
Free tier = first track + sandbox; paid = full tracks, certificates, team seats.

---

## Decisions to make before Phase 2, not during

1. ~~**Name and domain.**~~ Decided: the brand is **X++Lab**; identifiers stay `xpplab`
   because `+` is not legal in a package name or a domain. Domain still to pick. See
   `docs/decisions.md`.
2. **Subset freeze.** Write `docs/language-subset.md` yourself and treat it as immutable
   for v1. Scope creep in the engine is the single most likely way this project dies.
3. **Verification source.** You need one real F&O environment to check engine behaviour
   against. Not for the product — for the truth. Every golden-file test should be one you
   confirmed against a real AOS.
4. **Content voice.** The NAV→F&O angle is your differentiator and your credibility. Own
   it in the copy rather than being a generic X++ site.

Status of these is tracked in `docs/decisions.md`.

## Known risks

- **Engine scope creep.** Mitigation: the frozen subset, and a bias toward writing lessons
  instead of features.
- **Content cost.** The engine is maybe 40% of the work. Eight good lessons is weeks, not
  days. Budget accordingly and build the authoring path (Phase 5) before mass content.
- **Fidelity drift.** Mitigation: `docs/verified-behaviour.md`, one entry per simulated
  behaviour with its verification source and date.
- **Solo bandwidth.** Phases 0–6 are the only ones that must exist for this to be real.
  Everything after is optional and can wait for signal.

---

## Kickoff prompts for Claude Code

Run these one at a time, in order, in a fresh repo containing `CLAUDE.md`, `PLAN.md`, and
`docs/lesson-schema.md`.

**Phase 0**

> Read CLAUDE.md and PLAN.md. Scaffold Phase 0 exactly as specified: Next.js App Router
> with TypeScript strict, Tailwind, shadcn/ui, pnpm workspaces for every package listed in
> the repo layout, Vitest, Playwright, ESLint, Prettier, and a GitHub Actions workflow
> running typecheck plus tests. Each package exports its typed public interface with
> `throw new Error("not implemented")` bodies. Do not implement any engine logic yet. Stop
> when Phase 0 acceptance criteria pass and show me the interfaces you defined.

**Phase 1**

> Implement Phase 1 (virtual database) per PLAN.md. sql.js in a Web Worker, the table
> schemas listed, RECID and DATAAREAID on every table, savepoint-based nested transactions,
> snapshot/reset. Write the fictional seed data yourself across three legal entities — no
> Microsoft demo data. TDD: write the nested-transaction and company-filtering tests first.

**Phase 2**

> Implement Phase 2 (lexer and parser) for exactly the subset in docs/language-subset.md.
> Hand-written recursive descent, no parser generator. Errors carry line, column, code, and
> a teaching hint. Build the 40-snippet fixture corpus including 10 error cases before
> implementing, and drive the implementation from it.

Continue this pattern per phase. At the start of each, tell it to re-read `CLAUDE.md`,
implement only that phase, and stop at the acceptance criterion.
