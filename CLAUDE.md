# CLAUDE.md — XppLab

> Working name. Rename everywhere before Phase 1 if you pick a different one.

## What this is

A browser-based training platform for Dynamics 365 Finance & Operations developers.
Learners write real X++ in the browser, hit Run, and immediately see what it did:
Infolog output, changed table rows, the generated SQL, the rendered form, the report
output, or the OData response. Two modes:

- **Guided** — ordered lessons with objectives, starter code, hints, and automated
  validation of the learner's solution.
- **Sandbox** — free playground with the same engine, no objectives, persistent scratch
  projects.

## The central constraint (read this first)

**X++ cannot execute anywhere except a Microsoft AOS.** There is no compiler, no
container, no local runtime. We are not going to get one.

Therefore this product does **not** run X++. It **simulates** a teaching subset of X++
against a virtual AOS built in TypeScript + SQLite-WASM. Every architectural decision
follows from that:

- The engine is a **parser + tree-walking interpreter** for a deliberately limited
  subset of the language, not a compiler.
- The database is **sql.js** (SQLite compiled to WASM) running in a Web Worker, seeded
  with a small hand-authored dataset that mimics the shape of standard F&O tables.
- The AOT is a **JSON metadata model** (tables, fields, EDTs, enums, forms, entities)
  that the UI renders. "Deploying" is instant because nothing is deployed.
- Everything runs **client-side**. Zero per-learner compute cost. This is the business
  model, not just an implementation detail — protect it.

### Fidelity rule

The simulation may be incomplete. It must never be **wrong**. If the engine cannot
faithfully reproduce a real F&O behaviour, the correct move is to refuse to cover that
topic in an interactive lesson and explain it in prose instead. A learner who internalises
false behaviour from this site is worse off than one who never used it.

Every behaviour the engine simulates must be traceable to a documented, verified source.
When in doubt, add it to `docs/unverified.md` and leave it out of the engine.

### Legal rule

Do **not** ship Microsoft intellectual property. Specifically:

- No extracted AOT metadata, standard X++ source, or Contoso demo data from a real
  environment — not in seeds, not in fixtures, not in test data.
- Table and API **names** (`CustTable`, `LedgerJournalTrans`, `SysOperationServiceController`)
  are fine to reference — they're the public API surface.
- All seed data is fictional and hand-authored in this repo.
- "Standard code" that lessons extend via Chain of Command is **our own minimal stub**
  written to behave like the real thing, clearly labelled as a teaching stub in the UI.

## Stack

| Layer           | Choice                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Framework       | Next.js (App Router), TypeScript strict                                                      |
| Styling         | Tailwind + shadcn/ui                                                                         |
| Editor          | Monaco, custom X++ TextMate grammar + completion provider                                    |
| Engine          | Hand-written lexer + recursive-descent parser + tree-walking interpreter, pure TS, zero deps |
| Virtual DB      | sql.js (SQLite WASM) in a Web Worker                                                         |
| State           | Zustand for session/editor, TanStack Query for server data                                   |
| Content         | MDX in `content/`, compiled at build time                                                    |
| Auth + progress | Supabase (Postgres + Auth)                                                                   |
| Hosting         | Vercel                                                                                       |
| Tests           | Vitest for engine, Playwright for lesson flows                                               |

## Repo layout

```
/app                  Next.js routes
/components           UI components
/content              Lessons as MDX + task definitions
/e2e                  Playwright specs
/packages
  /xpp-core           Shared types: SourceSpan, XppError, InfologEntry, SqlTraceEntry
  /xpp-lexer          Tokenizer
  /xpp-parser         AST
  /xpp-runtime        Interpreter, Infolog, transaction manager
  /virtual-db         sql.js wrapper, schema, seeds, select→SQL compiler
  /virtual-aot        Metadata model, extension resolution, CoC chain builder
  /renderers          Form renderer, report renderer, OData console
  /validators         Task assertion runners
/docs                 Architecture notes, verified-behaviour log, unverified list
```

`xpp-core` is types only, no logic, and depends on nothing. It exists so that the lexer,
the runtime and the validators can all speak `XppError` without the validators having to
depend on the lexer.

Packages ship raw TypeScript from `src/` with no build step — Next transpiles them via
`transpilePackages`, Vitest aliases them to source. One less pipeline, and stack traces
point at the file you edited.

## Engine conventions

- **Every package is pure and testable in isolation.** No React imports below `/components`
  (enforced by an ESLint rule, not by good intentions).
- **The interpreter never throws raw JS errors to the UI.** All learner-facing failures
  are `XppError` objects with `{ code, message, line, column, hint }`, modelled on real
  compiler and runtime error text.
- **Transactions are real.** `ttsbegin`/`ttscommit` map to SQLite savepoints with nesting
  depth tracked. Calling `.insert()` outside a transaction must produce the same class of
  error a learner would hit in a real environment — this is a lesson, not an edge case.
- **Company scoping is real.** Every simulated table carries `DATAAREAID` and `RECID`.
  `changecompany` and `crosscompany` must work, because that is one of the highest-value
  concepts for the target audience (people coming from NAV, where companies are separate
  table sets).
- **Every run emits a SQL trace.** Learners see the SQL their `while select` generated.
  This is a headline feature, not debug output — it teaches set-based thinking.

## Scope discipline

The subset is defined in `docs/language-subset.md` and is a contract. Do not silently
widen it. If a lesson needs a construct outside the subset, either rewrite the lesson or
open an explicit subset-extension task with tests.

**In subset (v1):** primitives, `container`, `List`/`Map`/`Set`, enums, classes with
inheritance and static methods, `new`/`finalize`, control flow, `select`/`while select`
with `join`/`firstonly`/`forupdate`/`order by`, `insert_recordset`, `update_recordset`,
`delete_from`, `ttsbegin`/`ttscommit`/`ttsabort`, `try`/`catch`/`retry`, `throw`,
`info`/`warning`/`error`, `strFmt`, common `str`/`date`/`real` globals, attributes,
`[ExtensionOf]` + `next`, event handler attributes, `changecompany`, `crosscompany`.

**Out of subset (v1):** `#macros`, `Query`/`QueryRun` object model, `SysOperation`
scheduling internals (simulate the shape only), `AifDocumentService`, kernel classes not
listed above, threading, `System.*` .NET interop beyond a stubbed handful.

## Working style for this repo

- Ship phase by phase per `PLAN.md`. Each phase has acceptance criteria — meet them
  before starting the next.
- Engine work is TDD. Write the failing Vitest case from a real-behaviour example first.
- Content work is parallelisable: once `docs/lesson-schema.md` is stable, lessons can be
  authored without touching engine code. Prefer adding lessons over adding engine surface.
- Prefer explicit, readable implementations over clever generic ones. This codebase will
  be read by a solo maintainer months later.

## Commands

```
pnpm dev            # Next dev server
pnpm test           # Vitest, engine packages
pnpm test:e2e       # Playwright
pnpm typecheck      # app + every package
pnpm lint           # ESLint
pnpm format         # Prettier, write
pnpm ci             # typecheck + lint + test, what CI runs
```
