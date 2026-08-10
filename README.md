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

Phase 0 (scaffold) is complete: every engine package exports its typed public interface
with unimplemented bodies, and CI runs typecheck, lint and tests.

Phase 1 (virtual database) is next. See [PLAN.md](PLAN.md) for the full sequence and
[docs/decisions.md](docs/decisions.md) for what still needs deciding.
