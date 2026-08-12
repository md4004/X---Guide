# docs/language-subset.md

> **Status: DRAFT — not frozen.** Derived from the in/out lists in CLAUDE.md, from the
> token set in `packages/xpp-lexer/src/index.ts`, and from the Microsoft Learn X++
> language reference. PLAN.md says the owner writes and freezes this. Read it, change
> what's wrong, then delete this banner. Once the banner is gone this file is immutable
> for v1 and widening it requires an explicit subset-extension task with tests.
>
> Phase 2 was built against this draft. The two questions previously flagged for the owner
> — declaration placement and operator precedence — have since been **resolved against
> documented sources** and are logged as VB-005 and VB-006 in `docs/verified-behaviour.md`.
> What remains open is scope, not correctness: which constructs earn their place, not how
> the ones listed here behave.

This is a contract, not documentation. The parser accepts exactly what is listed here and
rejects the rest with a teaching error (`XP100 ConstructOutsideSubset`) that says what to
use instead — never a bare syntax error.

## Types

**In:** `boolean`, `int`, `int64`, `real`, `str` (with optional length), `date`,
`utcdatetime`, `timeOfDay`, `guid`, `anytype`, `container`, `void`.

**In:** table buffers (any table in `virtual-db`'s schema), base enums, `List`, `Map`,
`Set`, class instances.

**Out:** `Array`, `Struct`, `Binary`, `RecordSortedList`, `RecordLinkList`, `System.*`
beyond a stubbed handful.

## Declarations

**In:** local variable declarations with optional initialiser; single-dimension array
bounds (`int values[10]`); class declarations with `extends`, `implements`, fields, and
methods; `public`/`protected`/`private`/`static`/`final`/`abstract`; `new`/`finalize`;
attributes including `[ExtensionOf(...)]` and event handler attributes.

**Out:** `#macro` and every preprocessor directive; nested classes; `interface` bodies
beyond method signatures; delegates.

> **Resolved (VB-006).** Declarations may appear anywhere in a code block — Microsoft's
> own reference says so explicitly: "You can declare variables anywhere in a code block in
> a method. You don't have to declare them at the beginning of a method." The parser
> accepts them anywhere, and there is no top-of-method rule to enforce. The older AX
> convention is worth a sentence of prose in lesson 1, not a compiler error.

## Statements

**In:** `if`/`else`, `while`, `do`/`while`, `for`, `switch`/`case`/`default`, `break`,
`continue`, `return`, blocks, expression statements.

**In:** `try`/`catch`/`retry`, `throw`.

**In:** `ttsbegin`, `ttscommit`, `ttsabort`.

**In:** `changecompany (expr) { ... }`.

**Out:** `goto`, labels, `pragma`.

## Select and DML

**In:** `select` and `while select` with:

- field lists and `select *`
- aggregates `sum`, `count`, `avg`, `minof`, `maxof`
- modifiers `firstonly`, `firstonly10`/`100`/`1000`, `forupdate`, `crosscompany`,
  `reverse`
- `join`, `outer join`, `exists join`, `notexists join`
- `where` with the full expression grammar
- `order by` and `group by`, `asc`/`desc`
- `index` hints parsed and ignored, with a warning that they are advisory

**In:** `insert_recordset`, `update_recordset ... setting`, `delete_from`.

**In:** buffer methods `.insert()`, `.update()`, `.delete()`, `.validateWrite()`,
`.validateDelete()`, `.next()`, `.clear()`, `.RecId`.

**Out:** `Query`/`QueryRun` object model, `validtimestate`, `forceliterals`/
`forceplaceholders`/`forceselectorder` (parsed and rejected with a hint), `optimisticlock`/
`pessimisticlock`.

## Expressions

**In:** the usual arithmetic, comparison and logical operators; `mod`, `div`, `like`,
`is`, `as`; bitwise `& | ^ << >>`; `!`/`not`; `++`/`--`; compound assignment
`+= -= *= /=`; ternary `?:`; `::` enum access; member access; indexing; container literals
`[a, b, c]`; `new ClassName(...)`.

**Precedence follows X++, not C** (VB-005), and the difference is not cosmetic:

| Level | Operators                                    |
| ----- | -------------------------------------------- |
| 1     | `-` `~` `!` (unary)                          |
| 2     | `*` `/` `div` `mod` `<<` `>>` `&` `^`        |
| 3     | `+` `-` `\|`                                 |
| 4     | `<` `<=` `==` `!=` `>` `>=` `like` `as` `is` |
| 5     | `&&` `\|\|` — same level, left to right      |
| 6     | `?:`                                         |

`&&` does **not** bind tighter than `||`, `&` and `^` bind as tightly as `*`, and `|`
binds as tightly as `+`. All three trip up anyone arriving from C#, JavaScript or C/AL.
Pinned by `packages/xpp-parser/test/precedence.test.ts`.

## Built-in functions

**In:** `info`, `warning`, `error`, `strFmt`, `strLen`, `strUpr`, `strLwr`, `subStr`,
`strFind`, `strRep`, `strRTrim`, `strLTrim`, `int2Str`, `str2Int`, `real2Str`,
`str2Real`, `date2Str`, `str2Date`, `today`, `systemDateGet`, `dayOfMth`, `mthOfYr`,
`year`, `abs`, `round`, `min`, `max`, `conPeek`, `conPoke`, `conIns`, `conDel`, `conLen`,
`conNull`, `curExt`, `curUserId`, `enum2Str`, `str2Enum`, `any2Str`, `any2Int`,
`typeName`, `classStr`, `tableStr`, `fieldStr`, `methodStr`, `literalStr`.

**Out:** everything else. An unknown global is `XR005 MethodNotFound` with a hint listing
near matches.

## Chain of Command

**In:** `[ExtensionOf(classStr(X))]` / `[ExtensionOf(tableStr(X))]` on a `final class`,
method wrappers calling `next`, `[PostHandlerFor]`, `[PreHandlerFor]`,
`[DataEventHandler]`.

**Out:** delegates, `SysPlugin`, `SysExtension` framework, metadata-driven event
subscription.

## Subset extension 1 — the Query object model

**Status: accepted, 2026-08-12.** CLAUDE.md's original out-list named
`Query`/`QueryRun` as out of scope for v1. This is the explicit extension task that
reverses that, recorded here rather than made silently, as scope discipline requires.

**In:** `Query`, `QueryRun`, `QueryBuildDataSource`, `QueryBuildRange`, and the methods
`addDataSource`, `dataSourceTable`, `addRange`, `findRange`, `value`, `addSortField`,
`next`, `get`; the enum `SortOrder`; the globals `tableNum`, `fieldNum`, `queryValue`.

**In:** the documented advanced range syntax — `>2`, `<=10`, `A..M`, and `*` wildcards.
A range with no value restricts nothing, which is the framework's behaviour and a common
surprise.

**Out:** **joined data sources** — `qbds.addDataSource(...)`, `joinMode`, `relations`. One
data source per query. A query with a second one is refused with a message pointing at
`while select ... join ...`, rather than being compiled with half of itself missing.

**Out:** `QueryFilter`, date-effective queries, `QueryBuildFieldList` beyond field
selection, computed columns, and the SysDa classes.

**Why the reversal.** Two reasons, and neither is "a lesson wanted it".

The first is that it is _cheap and exact_ here. A query object is a `select` assembled at
runtime, and this engine already owns a `select`-to-SQL compiler that lessons are built
around. A `Query` compiles through the same path, which means the SQL trace shows what the
query actually produced. That is the single most useful thing anyone can be shown about
query objects, and it falls out of code that already exists rather than needing a second
implementation that could disagree with the first.

The second is that refusing it distorts the curriculum. Query objects are how forms,
reports and views get their data — Microsoft's own guidance is to prefer them over naming
tables directly — so a simulator that teaches `while select` and nothing else leaves a
learner unable to read the report they have just been taught to write.

**The cost, stated plainly.** This is engine surface, and engine surface is the thing most
likely to sink this project. The mitigation is the boundary above: the object model is in,
the framework built on top of it is out.

## Subset extension 2 — executing classes

**Status: accepted, 2026-08-12.** Classes were always _in_ the subset for the parser —
`docs/language-subset.md` has listed class declarations, modifiers and `new`/`finalize`
since Phase 2 — but the interpreter refused them at runtime, so nothing could actually
run. This records making them execute.

**In:** class declarations with fields and methods; `public` / `protected` / `private`
access with the real defaults (VB-034, VB-035) and the real enforcement (VB-038, VB-039);
`static` fields and methods with `ClassName::method()` calls; `new` with optional
parameters; `this`; `extends` with method and field inheritance, `super()`, and `final`.

**Out:** `abstract` enforcement beyond refusing to instantiate an abstract class,
`implements` checking, `internal` (it is a _model_ boundary, and this simulator has one
model), nested classes, local functions, and extension methods.

## Rejection behaviour

Anything outside this subset must produce `XP100` with:

- the construct's name,
- one sentence on why it is out of scope for the simulator,
- what to use instead, or a pointer to the prose lesson that covers it.

A bare "syntax error" for an in-language construct we chose not to support is a bug.
