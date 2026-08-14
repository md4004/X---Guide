# docs/scenario-schema.md

The authoring contract for scenarios. The types are in `packages/scenarios/src/types.ts`;
this is why they are shaped the way they are.

## What a scenario is, and is not

A **lesson** teaches one construct. You know what you are being taught before you start,
and the exercise is a place to practise it.

A **scenario** is a job. Somebody asks you for something in the words they actually use,
and the work is to notice what those words do not say. The X++ in it is not harder than a
lesson's — the difficulty is entirely in the requirements and the pipeline.

Four phases, in order, none skippable:

| Phase     | What happens                                     | Judged by                             |
| --------- | ------------------------------------------------ | ------------------------------------- |
| `brief`   | A conversation, in bubbles, with reply choices   | Nothing. You cannot fail a meeting.   |
| `build`   | AOT work plus the editor                         | The task's validators, first failure  |
| `test`    | The same code, every acceptance check at once    | All checks must pass                  |
| `release` | dev → Asset library → UAT → sign-off → RC → prod | The pipeline's own gates              |

## The conversation

Turns belong to somebody in `cast`, or to `"you"`. A turn may carry `choices`; each choice
has `text` (what you say), `response` (what they say back), an optional `pins`, and a
required `note`.

Three rules, and they are not negotiable:

1. **Every choice advances.** No dead ends, no "try again". The cost of not asking the
   right question on a real project is never that you are stopped — it is that you build
   the wrong thing and find out in UAT. Model that, not a quiz.
2. **Every choice has a `note`, including the good one.** The note is the teaching. A
   choice with no note is a choice the learner learns nothing from taking.
3. **`pins` only ever adds information.** A requirement that no choice pins is fine —
   it is simply stated rather than askable. What must never happen is a requirement the
   learner cannot learn before `build`.

`learnedLate` is set only for requirements that *some* choice could have pinned. Marking a
requirement "you did not ask" when the conversation never offered the question is untrue
and makes the learner stop reading the panel.

## AOT work

Two kinds, because these are the two the metadata model can check honestly:

- `addToProject` — the gate that catches every newcomer. Application Explorer views the
  model; it cannot edit it.
- `inspect` — open a designer and select a node, with a `takeaway` naming what they should
  come away knowing.

**Do not author an `inspect` item the code does not need.** The bar is that the solution
cannot be written without what the property grid shows — `CustVendorBlocked` is not a name
anybody guesses. An inspect item that teaches nothing is a click the learner resents.

There is deliberately no "add a field" work item. The Studio can add one to the metadata
and print the `ALTER TABLE` a synchronisation would run, but the engine's table schemas are
static, so X++ could not then read or write it. See `docs/unverified.md`.

## Validators and acceptance checks

Both use the ordinary `Validator` union from `@xpplab/validators`. A scenario cannot assert
anything a lesson could not.

The difference is presentation. The build phase reports the **first** failure, so the
learner fixes one thing at a time. The test phase runs every check against **one**
execution and shows the whole list, the way a UAT report does.

**Validator order is content.** Order them so that each has a wrong answer that can reach
it. Put the check almost every incomplete solution fails first, and it becomes the only
message anybody ever sees — every other validator is then unreachable in practice, and a
learner never finds out what else they got wrong.

## The release phase

Do not author this. It is the same pipeline for every scenario, in
`packages/scenarios/src/release.ts`, and every gate in it is a documented platform rule
(VB-070 to VB-081 in `docs/verified-behaviour.md`). A scenario supplies only a package name
and a suggested update name.

The board deliberately offers the wrong move as well as the right one — "…or just apply the
package to production" is always visible, because reading the rule that replaced that route
*after trying it* is worth more than never seeing it.

## Data

A scenario names its own `seed`. Do not extend the `default` seed to make an exercise work:
its row counts and totals are what every existing lesson is checked against.

Author the dataset so that a solution which gets the rule **nearly** right still fails, and
write the table of traps into the seed file's header comment. `credit.ts` is the worked
example — one customer over on invoices alone, one over only once open orders count, one
over but inside the tolerance, and the same account number in a second company, healthy.

## Required tests

Both live in `packages/scenarios/test`:

- `content.test.ts` — the authored solution satisfies its own validators **and** every
  acceptance check; the starter does not pass; every choice pins a real requirement; every
  work item names an element that exists.
- `wrong-answers.test.ts` — **one wrong answer per validator**, asserting the learner gets
  the message written for that mistake. This is not optional. The repo has shipped two
  validators that could never fail — one named a select modifier as though it were a node
  kind, one named a node kind that did not exist — and both passed silently forever.
