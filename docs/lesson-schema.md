# docs/lesson-schema.md — content and validator contract

Freeze this before Phase 6 so lessons can be authored without touching engine code.

The TypeScript counterpart lives in `packages/validators/src/index.ts`, and
`packages/validators/test/contract.test.ts` types the worked example below. If the doc
and the types drift, that test stops compiling.

## File layout

```
content/
  tracks/
    xpp-fundamentals/
      track.json
      lessons.ts          data-only registry: frontmatter + steps + tasks, no React
      index.ts            adds the compiled MDX component to each lesson
      01-hello-infolog.mdx
      02-buffers-and-select.mdx
      ...
```

`lessons.ts` is split from `index.ts` on purpose: the validators package imports it to run
every authored solution through its own validators, and an engine package has no business
depending on app-level component types to do that.

## track.json

```json
{
  "slug": "xpp-fundamentals",
  "title": "X++ fundamentals",
  "summary": "Write X++ that reads, writes and queries a real database — and see exactly what it did.",
  "level": "beginner",
  "estimatedMinutes": 230,
  "lessons": ["01-hello-infolog", "02-buffers-and-select"],
  "requiresEngine": ["db", "runtime", "aot", "forms", "reports"]
}
```

`requiresEngine` gates a lesson from publishing before its engine capability exists.
Valid values: `db`, `runtime`, `aot`, `forms`, `classes`, `reports`, `odata`.

`db`, `runtime`, `aot`, `forms` and `reports` exist today. `classes` and `odata` do not,
and `lesson.test.ts` fails any lesson that claims them.

## Lesson frontmatter

```yaml
---
slug: 02-buffers-and-select
title: Reading from the database
minutes: 20
objectives:
  - Declare a table buffer and read one record into it
  - Loop a whole result set with while select
  - Tell a read-only buffer from a writable one
requiresEngine: [db, runtime]
seed: default # or a named seed variant in virtual-db
---
```

## Body

The body is a sequence of `<Step>` blocks. The workspace renders the whole document on
every step and each `<Step>` shows itself only when it is the active one, so authoring
stays ordinary MDX rather than prose chopped into a JavaScript array.

Standard MDX prose inside a step, plus these components:

- `<Snippet lang="xpp">` — read-only illustrative code, not runnable.
- `<Aside title="...">` — a box for a caveat or a surprise. The title is authored per use.
- `<KeyPoints>` — a short recap list.

```mdx
<Step id="buffers">

## A table buffer is a variable

<Snippet lang="xpp">{`InventTable inventTable;`}</Snippet>

</Step>
```

**Assume nothing about the reader's background.** Learners arrive from C#, Java, SQL, other
ERP platforms, or from nothing at all. Framing a concept as "what X is called here" excludes
everyone who has not used X, and dates the content to one migration wave. Explain the thing
itself. (This reverses decision #4 in `docs/decisions.md`, which is recorded there.)

## Step definition

Steps live in a `steps` export and give the workspace its running order.

```ts
export const steps = [
  // A reading step: prose plus an example the learner can run and poke at.
  { id: "buffers", title: "A table buffer is a variable", example: "InventTable inventTable;\n" },
  // An exercise step: the editor loads the task's starter, and the arrow is locked
  // until the task's validators pass.
  { id: "select-one-item", title: "Read one record", taskId: "select-one-item" },
];
```

A step may also declare a **view**, for when the point is what the code produced rather
than what it logged:

```ts
// Renders a form from AOT metadata over the data as the run left it.
{ id: "see-your-change", title: "...", taskId: "...",
  view: { kind: "form", form: "InventTableListPage" } }

// Groups and totals the rows a data provider wrote, the way a design would.
{ id: "fill-the-table", title: "...", taskId: "...",
  view: { kind: "report", table: "TmpItemSales", title: "Item sales by group",
          groupBy: ["ItemGroupId"], totals: [{ column: "LineAmount", aggregate: "sum" }] } }
```

Views are built in the worker, inside `runTask`'s `observe` hook — the only moment the
learner's changes are still in the database, since the runner restores its snapshot
immediately afterwards.

Rules, enforced in `packages/validators/test/lesson.test.ts`:

- every step has either a `taskId` or an `example` — never neither
- step ids are unique within a lesson
- every task in the lesson is reached from exactly one step

## Task definition

Tasks live in a `tasks` export at the bottom of the same MDX file, so authors edit one file.

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

### `metadata` (not implemented)

Assertions on the virtual AOT: field exists on table, EDT assigned, property value,
relation defined. The AOT model exists, but nothing needs to assert on it yet — the forms
lesson checks behaviour (`validateWrite` outcomes) rather than metadata shape.

### `odata` (not implemented)

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

- [ ] Nothing assumes a specific prior platform
- [ ] 400–800 words of prose, split across 5–8 steps
- [ ] Every step has a task or a runnable example
- [ ] 2–4 tasks, each solvable in under five minutes
- [ ] Every task has three hints, escalating from nudge to near-solution
- [ ] Every validator has an authored failure message
- [ ] Solution passes; three plausible wrong answers fail with the right message
- [ ] Behaviour verified against a real F&O environment and logged in
      `docs/verified-behaviour.md`
