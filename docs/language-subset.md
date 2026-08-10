# docs/language-subset.md

> **Status: DRAFT — not frozen.** Derived from the in/out lists in CLAUDE.md and from the
> token set already declared in `packages/xpp-lexer/src/index.ts`. PLAN.md says the owner
> writes and freezes this before Phase 2. Read it, change what's wrong, then delete this
> banner. Once the banner is gone this file is immutable for v1 and widening it requires
> an explicit subset-extension task with tests.

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

> X++ traditionally requires all declarations at the top of a method. The parser accepts
> declarations anywhere and does **not** enforce the top-of-method rule — deliberately, so
> a learner's first lesson is not a style violation. Lesson 1 mentions the real rule in
> prose. **Owner: confirm this is the call you want.**

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

**Precedence** follows X++, not C. Notably `&&` and `||` bind tighter than comparison in
some legacy X++ readings — the parser uses the modern documented precedence and the
lexer's fixture corpus pins it. **Owner: verify against a real compiler before freeze.**

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

## Rejection behaviour

Anything outside this subset must produce `XP100` with:

- the construct's name,
- one sentence on why it is out of scope for the simulator,
- what to use instead, or a pointer to the prose lesson that covers it.

A bare "syntax error" for an in-language construct we chose not to support is a bug.
