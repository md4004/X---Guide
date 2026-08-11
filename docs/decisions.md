# docs/decisions.md

The four decisions PLAN.md says to make before Phase 2, and their current state.

## 1. Name — **decided: X++Lab**

The brand is **X++Lab**, written that way wherever a human reads it: page titles, the
landing page, the playground chrome, the README.

`+` is not legal in an npm package name, a domain label, or a CSS identifier, so the
technical spellings stay ASCII and do not track the brand:

| Where                | Value          |
| -------------------- | -------------- |
| Brand, UI, docs      | `X++Lab`       |
| Root package name    | `xpplab`       |
| Workspace scope      | `@xpplab/*`    |
| Monaco theme id      | `xpplab`       |
| Domain (when chosen) | must avoid `+` |

Two details worth knowing. The brand must not be rendered through `text-transform:
uppercase` — it comes out as `X++LAB` — so the two places that display it set tracking
without uppercasing. And `curUserId()` in the simulated environment returns `LEARNER`
rather than the product name, because it is a user id in a fictional company, not a
brand.

**Domain is still open.** It is the only part of this decision that remains.

## 2. Subset freeze — **draft, needs sign-off**

`docs/language-subset.md` exists as a draft derived from the in/out lists already in
CLAUDE.md. It is **not** frozen. Phase 2 is written against it, so read it and sign it off
first — the whole point of the freeze is that it stops being negotiable once the parser
exists.

## 3. Verification source — **open, and it bit in Phase 1**

Phase 1 needs one real F&O environment to check behaviour against, and every golden-file
test from Phase 3 onward is supposed to be one you confirmed there.

Until that exists, the honest position is: the engine implements what
`docs/verified-behaviour.md` can justify, and everything else waits. This is the decision
most likely to be quietly skipped and most damaging if it is — a simulator nobody checked
is a simulator that teaches wrong habits confidently.

Options worth costing: a Microsoft-provided Tier-1 sandbox, a partner CSP dev box, or a
colleague with an existing environment willing to run verification snippets.

Phase 1 got by on Microsoft Learn documentation as the source for VB-001 to VB-004, which
is an acceptable source per the format in `docs/verified-behaviour.md`. It will not
stretch to Phase 3: golden-file tests for update conflicts, deadlock shapes and
uncommitted-data errors need a real AOS, because the docs do not spell out the exact
message text and the whole point is to mirror it.

## 4. Content voice — **decided: own the NAV→F&O angle**

Reflected in the Phase 0 landing copy ("Built for developers arriving from Dynamics NAV
and Business Central") and in the lesson schema's mandatory `<NavCallout>`. Every lesson
explains the delta from C/AL rather than teaching X++ from zero.

---

## Structural decisions taken during Phase 0

| Decision                                                     | Why                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added `packages/xpp-core` beyond CLAUDE.md's original layout | Shared types (`XppError`, `InfologEntry`, `SqlTraceEntry`, `SourceSpan`) are needed by the lexer, the runtime and the validators alike. Without it, `validators` would depend on `xpp-lexer` purely to name an error type. Types only, no logic, depends on nothing. |
| Packages ship raw TypeScript, no build step                  | Next transpiles via `transpilePackages`, Vitest aliases to source. Removes a whole pipeline and keeps stack traces pointing at real files. Costs nothing while everything is internal.                                                                               |
| `message` is a required field on every validator             | docs/lesson-schema.md already mandates an authored failure message for every validator. Making it required in the type means the rule is enforced by the compiler rather than by the authoring checklist.                                                            |
| ESLint rule banning React/Next imports under `packages/`     | CLAUDE.md's "no React below /components" is load-bearing for testability. Enforced, not trusted.                                                                                                                                                                     |
| Fictional company ids, never `USMF`/`DAT`                    | Contoso demo data is Microsoft IP. See CLAUDE.md > Legal rule. Phase 1 settled on `HVND`, `KELT` and `MRDA`.                                                                                                                                                         |

---

## Structural decisions taken during Phase 1

| Decision                                                                          | Why                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ttsabort` discards the whole transaction, not just the innermost savepoint       | PLAN.md's acceptance criterion described savepoint behaviour, but X++ aborts everything from any depth (VB-001). Both readings are implemented and tested at the layer where each is true — see the note at the bottom of `docs/verified-behaviour.md`. Shipping only the savepoint reading would have taught the wrong thing in lesson 3. |
| Split `SavepointStack` (SQLite) from `TransactionManager` (X++)                   | Two genuinely different behaviours. Keeping them apart lets each be tested for what it actually does, and makes the difference legible instead of buried in a conditional.                                                                                                                                                                 |
| All logic lives in `createRequestHandler`; `worker.ts` is postMessage wiring only | The worker cannot run under Vitest in Node, so putting behaviour in the worker file would make it untestable. Both transports drive the same handler, so the tested path is the shipped path.                                                                                                                                              |
| Client-side mirroring of the company and the SQL trace                            | `VirtualDb.getCompany()` and `getTrace()` are synchronous in the Phase 0 interface, and a worker cannot answer synchronously. Each response carries the trace entries it produced and the client accumulates them.                                                                                                                         |
| `PRAGMA foreign_keys = OFF` despite the schema declaring relations                | An orphan row must fail the way F&O fails — our own validation error with a teaching message in Phase 3 — not with an opaque SQLite constraint error.                                                                                                                                                                                      |
| Base enums live in `virtual-db/src/enums.ts`, not `virtual-aot`                   | The schema and the seed data need them, and `virtual-aot` is not populated until Phase 7. When it lands it should import from here rather than redeclare.                                                                                                                                                                                  |
| `RECID` uses `AUTOINCREMENT` rather than a plain rowid alias                      | AUTOINCREMENT never reissues a deleted id, which is how RecId behaves in F&O. A plain rowid alias would reuse the highest deleted value.                                                                                                                                                                                                   |

---

## Structural decisions taken during Phase 4

| Decision                                                             | Why                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monarch grammar, not the TextMate grammar PLAN.md asked for          | TextMate in Monaco needs onigasm — a second WASM download, purely for syntax colour, on top of the SQLite one. Monarch is built in. The correctness that mattered is bought instead by generating the grammar and the completions from the engine's own tables, so the editor cannot highlight a keyword the parser rejects or offer a table that does not exist. |
| The whole engine runs in the worker, not just the database           | A tree-walking interpreter spinning on `while (n >= 0) n++;` has no `await` to yield on. With only the DB in a worker, the first infinite loop a learner writes would freeze the tab until the statement budget tripped.                                                                                                                                          |
| Packages import relative paths without a `.js` extension             | Turbopack does not map `.js` → `.ts` when transpiling raw package source, so the extension broke `pnpm build` while tsc and Vitest were happy. `moduleResolution: "bundler"` makes extensionless correct, and these packages are never published.                                                                                                                 |
| The app's `tsconfig` target matches `tsconfig.base.json`             | The app's config also governs the engine packages it pulls in through `paths`. Leaving it at create-next-app's ES2017 rejected syntax those packages legitimately use.                                                                                                                                                                                            |
| Permalinks live in the URL fragment, and are validated on the way in | The fragment is never sent to a server, which the "everything runs client-side" claim depends on. And a permalink is untrusted input — someone else wrote it — so the decoder validates the shape rather than trusting it into the editor and the engine.                                                                                                         |
| `useEngine` exposes no `ready` flag                                  | Setting one from inside the mount effect is a synchronous setState in an effect. The caller infers readiness from the first reply instead, so the flag was removed rather than the lint rule suppressed.                                                                                                                                                          |

---

## Structural decisions taken during Phase 5

| Decision                                                           | Why                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content/**/*.mdx` is excluded from Prettier                       | Prettier's MDX formatter rewrites the inside of template literals. It stripped the spaces around inline backticks in authored messages and flattened the indentation of every task solution — silent corruption of authored content, which is worse than inconsistent whitespace. Lessons are formatted by hand.     |
| Validator order is part of authoring, not an implementation detail | `wrappedIn: "transaction"` is vacuously false when a learner made no writes at all, so it must run _after_ `callsMethod: "update"`. Otherwise someone who forgot `update()` is told they wrote outside a transaction. The acceptance test asserts a specific message per wrong answer, which is what caught it.      |
| The runtime's own error wins over an authored message              | Code that fails at runtime never reaches the validators. Writing outside a transaction produces F&O's own message with its own hint, which beats anything an author would write. `runTask` returns runtime errors rather than a validator failure, and the UI renders them.                                          |
| Progress uses `useSyncExternalStore`, not a mount effect           | The lesson page is prerendered, so reading localStorage during render breaks hydration and reading it in an effect flashes "0 of 3" before correcting itself. `lib/progress.ts` supplies a server snapshot and a client snapshot. Phase 11 swaps the backing store for an account without touching either component. |
| MDX takes its components as a prop, not through `MDXProvider`      | The provider evaluates `createContext` at module scope, which Next runs while collecting page data on the server — where it is not a function. Passing the map directly also dropped a dependency.                                                                                                                   |
| The lesson route resolves the lesson on the client                 | MDX content is a function component, and a server component cannot pass a function to a client one. The server page passes two strings and keeps `generateStaticParams` and metadata.                                                                                                                                |
