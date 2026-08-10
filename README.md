# XppLab

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

Phase 4 (playground UI) is next. See [PLAN.md](PLAN.md) for the full sequence and
[docs/decisions.md](docs/decisions.md) for what still needs deciding.
