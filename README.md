# X++Lab

A browser-based training platform for Dynamics 365 Finance & Operations developers.
Learners write X++, hit Run, and immediately see the Infolog, the rows that changed, and
the SQL the code generated.

X++ only executes on a Microsoft AOS, so this does not run X++ — it **simulates** a
teaching subset against a virtual AOS built in TypeScript and SQLite-WASM, entirely
client-side. Read [CLAUDE.md](CLAUDE.md) before touching anything; the constraints there
explain every architectural decision in this repo.

## Getting started

```bash
pnpm install
pnpm dev
```

## Commands

| Command          | What it does                                |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | Next dev server                             |
| `pnpm build`     | Production build                            |
| `pnpm test`      | Vitest across the engine packages           |
| `pnpm test:e2e`  | Playwright                                  |
| `pnpm typecheck` | `tsc --noEmit` for the app and each package |
| `pnpm lint`      | ESLint                                      |
| `pnpm format`    | Prettier, write                             |
| `pnpm ci`        | What CI runs: typecheck + lint + test       |

## Layout

| Path          | Contents                                                                           |
| ------------- | ---------------------------------------------------------------------------------- |
| `app/`        | Next.js App Router routes                                                          |
| `components/` | React components — the only place React may be imported                            |
| `content/`    | Lessons as MDX plus their task definitions                                         |
| `packages/`   | The engine: lexer, parser, runtime, virtual DB, virtual AOT, renderers, validators |
| `docs/`       | Architecture notes, the language subset, the verified-behaviour log                |
| `e2e/`        | Playwright specs                                                                   |

## Status

**Phase 0 (scaffold)** — every engine package exports its typed public interface, and CI
runs typecheck, lint, format, tests and build.

**Phase 1 (virtual database)** — sql.js in a Web Worker over 13 tables across three
fictional legal entities, with real savepoint-backed nested transactions, X++ `ttsabort`
semantics, company scoping, a SQL trace and snapshot/reset.

**Phase 2 (lexer and parser)** — hand-written tokenizer and recursive-descent parser over
a 66-snippet fixture corpus, with error recovery and teaching-grade diagnostics. X++
operator precedence is implemented and pinned, and it is not C's — see VB-005 in
[docs/verified-behaviour.md](docs/verified-behaviour.md).

**Phase 3 (interpreter)** — tree-walking evaluator with real transaction semantics, the
`forUpdate` and `ttsLevel` integrity checks, X++ exception rules, and a `select`→SQL
compiler whose output is a learner-facing feature. 55 golden cases pin the Infolog, the
SQL trace and the resulting database state.

**Phase 4 (playground UI)** — the sandbox at `/playground`: Monaco with X++ highlighting
and schema-aware completions, inline parse markers, and four result panels (Infolog,
Data, SQL trace, Errors). The whole engine runs in a Web Worker, so an infinite loop
cannot freeze the tab. Shareable permalinks keep the code in the URL fragment, so nothing
is ever sent to a server.

**Phase 5 (lesson engine)** — lessons authored as MDX with `steps` and `tasks` exports,
served at `/learn/[track]/[lesson]` as a two-pane workspace: editor on the left,
instructions on the right, one step at a time. Four validator kinds (ast, state, output,
sql), progressive hints, solution reveal after three attempts, and progress in
localStorage. Every task's solution is run through its own validators in CI, so a broken
lesson fails the build rather than a learner.

**Phase 6 (first guided track)** — _X++ fundamentals_, at `/learn/xpp-fundamentals`. Ten
lessons, 29 validated tasks; every solution and 27 plausible wrong answers are checked in
CI.

**Phase 7 / 9 (metadata, forms and reports)** — `@xpplab/virtual-aot` holds a metadata
model derived from the database schema, so the two cannot drift. `validateWrite()` is real
and enforces mandatory fields and EDT string sizes — and, as in a real environment,
`insert()` does not call it for you. `@xpplab/renderers` builds form and report view models
from that metadata, and lessons 9 and 10 teach against them.

Phase 6's acceptance criterion is **not** met: it asks that a developer with no F&O
experience completes the track in under three hours, and nobody has tried it yet. That is
the next thing to do, and it needs a person rather than a commit. See [PLAN.md](PLAN.md)
for the full sequence and [docs/decisions.md](docs/decisions.md) for what still needs
deciding.
