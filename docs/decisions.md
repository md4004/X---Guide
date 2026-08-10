# docs/decisions.md

The four decisions PLAN.md says to make before Phase 2, and their current state.

## 1. Name and domain — **open**

`XppLab` is hardcoded throughout: `package.json` names, the `@xpplab/*` package scope,
the landing page, `app/layout.tsx` metadata. Phase 0 shipped with it as the working name.

Renaming is a find-and-replace on `xpplab` / `XppLab` plus the workspace package scope. It
gets more expensive once content exists, so decide before Phase 6, not after.

## 2. Subset freeze — **draft, needs sign-off**

`docs/language-subset.md` exists as a draft derived from the in/out lists already in
CLAUDE.md. It is **not** frozen. Phase 2 is written against it, so read it and sign it off
first — the whole point of the freeze is that it stops being negotiable once the parser
exists.

## 3. Verification source — **open, blocking Phase 1**

Phase 1 needs one real F&O environment to check behaviour against, and every golden-file
test from Phase 3 onward is supposed to be one you confirmed there.

Until that exists, the honest position is: the engine implements what
`docs/verified-behaviour.md` can justify, and everything else waits. This is the decision
most likely to be quietly skipped and most damaging if it is — a simulator nobody checked
is a simulator that teaches wrong habits confidently.

Options worth costing: a Microsoft-provided Tier-1 sandbox, a partner CSP dev box, or a
colleague with an existing environment willing to run verification snippets.

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
| Fictional company ids (`NRTH` etc.), never `USMF`/`DAT`      | Contoso demo data is Microsoft IP. See CLAUDE.md > Legal rule.                                                                                                                                                                                                       |
