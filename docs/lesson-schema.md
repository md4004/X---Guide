# docs/lesson-schema.md — content and validator contract

Freeze this before Phase 6 so lessons can be authored without touching engine code.

The TypeScript counterpart lives in `packages/validators/src/index.ts`, and
`packages/validators/test/contract.test.ts` types the worked example below. If the doc
and the types drift, that test stops compiling.

## File layout

```
content/
  tracks/
    xpp-for-nav-devs/
      track.json
      01-hello-infolog.mdx
      02-buffers-and-select.mdx
      ...
```

## track.json

```json
{
  "slug": "xpp-for-nav-devs",
  "title": "X++ for NAV and BC developers",
  "summary": "Everything you already know from C/AL, remapped — plus the things that will bite you.",
  "level": "beginner",
  "estimatedMinutes": 180,
  "lessons": ["01-hello-infolog", "02-buffers-and-select"],
  "requiresEngine": ["db", "runtime"]
}
```

`requiresEngine` gates a lesson from publishing before its engine capability exists.
Valid values: `db`, `runtime`, `aot`, `forms`, `classes`, `reports`, `odata`.

## Lesson frontmatter

```yaml
---
slug: 02-buffers-and-select
title: Buffers and select
minutes: 20
objectives:
  - Declare a table buffer and select a single record
  - Loop a result set with while select
  - Explain why FINDSET has no direct equivalent
requiresEngine: [db, runtime]
seed: default # or a named seed variant in virtual-db
---
```

## Body

Standard MDX prose, plus these components:

- `<NavCallout>` — the "how this differs from C/AL" box. Every lesson has exactly one.
- `<Snippet lang="xpp">` — read-only illustrative code, not runnable.
- `<Compare cal={...} xpp={...} />` — side-by-side C/AL and X++.
- `<Task id="..." />` — an interactive task, defined below.

## Task definition

Tasks live in a `tasks` export at the bottom of the MDX file so authors edit one file.

```ts
export const tasks = [
  {
    id: "loop-blocked-items",
    prompt: "Block every item in the FURNITURE group, then log how many you changed.",
    starter: `InventTable inventTable;\nint counter;\n\n// your code here`,
    solution: `InventTable inventTable;
int counter;

ttsbegin;
while select forupdate inventTable
    where inventTable.ItemGroupId == 'FURNITURE'
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
ttscommit;

info(strFmt("Blocked %1 items", counter));`,
    hints: [
      "A buffer is declared like any other variable — type first, then name.",
      "Reading and writing in the same pass needs forupdate.",
      "Nothing is written until ttscommit.",
    ],
    validators: [
      {
        kind: "ast",
        rule: "usesStatement",
        value: "whileSelect",
        message:
          "You got the right rows, but not with a `while select`. This lesson is about looping a result set.",
      },
      {
        kind: "ast",
        rule: "usesModifier",
        value: "forupdate",
        message:
          "Your loop reads the records but can't write to them — a buffer selected without `forupdate` is read-only.",
      },
      {
        kind: "ast",
        rule: "wrappedIn",
        value: "transaction",
        message:
          "F&O will not let you write outside a transaction. Wrap the loop in `ttsbegin` and `ttscommit`.",
      },
      {
        kind: "state",
        table: "InventTable",
        where: { ItemGroupId: "FURNITURE" },
        expect: { Blocked: 1 },
        all: true,
        message: "Some FURNITURE items are still unblocked. Check your `where` clause.",
      },
      {
        kind: "state",
        table: "InventTable",
        where: { ItemGroupId: "RAWMAT" },
        expect: { Blocked: 0 },
        all: true,
        message:
          "You blocked items outside the FURNITURE group. Your `where` clause is matching too much.",
      },
      {
        kind: "output",
        match: "^Blocked \\d+ items$",
        type: "info",
        message: 'Nothing was logged. Finish with `info(strFmt("Blocked %1 items", counter));`.',
      },
      {
        kind: "sql",
        rule: "maxStatements",
        value: 12,
        message:
          "The rows are right, but look at the SQL trace: one UPDATE per record. This is the row-by-row habit F&O punishes.",
      },
    ],
  },
];
```

**`message` is required on every validator.** It is a field, not a convention, because a
generated message teaches nothing (see Failure messages below).

## Validator kinds

### `ast`

Structural assertions on the learner's parse tree. Proves _how_ they solved it, not just
that the numbers came out right.

| rule                | value            | meaning                                           |
| ------------------- | ---------------- | ------------------------------------------------- |
| `usesStatement`     | node type        | e.g. `whileSelect`, `insertRecordset`, `tryCatch` |
| `usesModifier`      | keyword          | `forupdate`, `firstonly`, `crosscompany`          |
| `wrappedIn`         | `transaction`    | the mutation sits inside ttsbegin/ttscommit       |
| `callsMethod`       | method name      | e.g. `validateWrite`, `next`                      |
| `forbids`           | node type        | fails if present — use to block the lazy path     |
| `declaresExtension` | table/class name | `[ExtensionOf(...)]` targets the right object     |

Node type values are the AST `kind` strings from `packages/xpp-parser/src/ast.ts`. Those
strings are a frozen contract — renaming one breaks every lesson that names it.

### `state`

Assertions on the virtual DB after the run. `all: true` requires every matching row to
satisfy `expect`; `all: false` requires at least one. `count` asserts a row count instead
of field values.

### `output`

Regex against Infolog entries, filtered by `type` (`info`, `warning`, `error`). `negate`
inverts the check, for "don't just dump the whole table".

### `sql`

Assertions on the generated SQL trace. `maxStatements` is how you force set-based
solutions: the loop passes the state check but fails the SQL check, and the learner sees
exactly why in the trace panel. This is the single highest-value validator on the site —
use it deliberately.

### `metadata` (Phase 7+)

Assertions on the virtual AOT: field exists on table, EDT assigned, property value,
relation defined.

### `odata` (Phase 10+)

Assertions on a request/response pair from the mock endpoint.

## Runner contract

1. Snapshot the virtual environment for the lesson's `seed`.
2. Parse learner code. Parse failure → return errors, run no validators.
3. Execute in the worker with a 3-second ceiling and a 100k-statement cap.
4. Run validators in declaration order. **Stop at the first failure** and surface only that
   one — a wall of red teaches nothing.
5. Restore the snapshot.

The ceiling and the cap are declared once, in `EXECUTION_LIMITS` in `@xpplab/xpp-core`.

## Failure messages

Every validator needs a learner-facing message, authored not generated. Bad: "Assertion
failed: usesModifier forupdate." Good: "Your loop reads the records but can't write to
them — a buffer selected without `forupdate` is read-only."

Write these as you write the validator. If a validator has no good message, it's the wrong
validator.

## Authoring checklist

- [ ] Exactly one `<NavCallout>`
- [ ] 400–800 words of prose
- [ ] 2–4 tasks, each solvable in under five minutes
- [ ] Every task has three hints, escalating from nudge to near-solution
- [ ] Every validator has an authored failure message
- [ ] Solution passes; three plausible wrong answers fail with the right message
- [ ] Behaviour verified against a real F&O environment and logged in
      `docs/verified-behaviour.md`
