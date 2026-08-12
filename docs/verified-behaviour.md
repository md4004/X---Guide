# docs/verified-behaviour.md

One entry per behaviour the engine simulates, with the source that confirmed it and the
date it was confirmed. This log is the defence against fidelity drift.

**Rule:** no behaviour ships in the engine without an entry here. If you cannot verify
it, it goes in `docs/unverified.md` and stays out of the engine — explain it in prose
instead. See CLAUDE.md > Fidelity rule.

## Format

| ID  | Behaviour | Verified against | Date | Notes |
| --- | --------- | ---------------- | ---- | ----- |

- **ID** — `VB-nnn`, referenced from the test that asserts it.
- **Verified against** — a named F&O environment and version, or a specific Microsoft
  Learn page with its URL. "I'm pretty sure" is not a source.
- **Date** — when it was checked. Behaviour changes between releases; a five-year-old
  verification is a claim, not a fact.

## Entries

| ID     | Behaviour                                                                                                                                 | Verified against                           | Date       | Notes                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VB-001 | `ttsAbort` discards **all** changes in the transaction and returns `ttsLevel` to 0, regardless of the nesting depth it was called at      | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | "explicitly discards all changes in the current transaction … the database is rolled back to the original state, where nothing is changed"                                                                                                                                                                             |
| VB-002 | Nested `ttsBegin`/`ttsCommit` commit nothing until the outermost `ttsCommit`                                                              | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | "nothing is committed until a successful exit from the final **ttsCommit** statement occurs"                                                                                                                                                                                                                           |
| VB-003 | A record may only be updated or deleted if it was first selected for update (`forUpdate` check)                                           | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | Enforced in Phase 3; the buffer's `selectedForUpdate` flag exists in the runtime types for it                                                                                                                                                                                                                          |
| VB-004 | A record may only be updated or deleted in the same transaction scope in which it was selected for update (`ttsLevel` check)              | [MS Learn, X++ transactional integrity][1] | 2026-08-10 | Enforced in Phase 3 by scope identity, not depth — two sibling transactions are both at depth 1                                                                                                                                                                                                                        |
| VB-005 | X++ operator precedence has six levels, and `&&` and `\|\|` sit at the **same** level, evaluated left to right                            | [MS Learn, X++ operators][2]               | 2026-08-10 | The page states outright that "the operator precedence of X++ isn't the same as the operator precedence of other languages, such as C# and Java", and gives `0 && 0 \|\| 1` == 1 and `1 \|\| 0 && 0` == 0 as worked examples                                                                                           |
| VB-006 | Variables may be declared anywhere in a code block, not only at the top of a method                                                       | [MS Learn, X++ variables][3]               | 2026-08-10 | "You can declare variables anywhere in a code block in a method. You don't have to declare them at the beginning of a method."                                                                                                                                                                                         |
| VB-007 | An exception thrown inside a transaction automatically aborts it — a `ttsAbort` occurs                                                    | [MS Learn, X++ exception handling][4]      | 2026-08-10 | "If an exception is thrown inside a transaction, the transaction is automatically canceled (that is, a **ttsAbort** operation occurs)."                                                                                                                                                                                |
| VB-008 | A `catch` **inside** a transaction block cannot catch an exception thrown in that block. The innermost `catch` outside it is tested first | [MS Learn, X++ exception handling][4]      | 2026-08-10 | Exceptions are `UpdateConflict` and `DuplicateKeyException`, which must be named explicitly — a bare `catch{}` still cannot catch them inside a transaction                                                                                                                                                            |
| VB-009 | `retry` erases every Infolog message written since control entered the `try` block                                                        | [MS Learn, X++ exception handling][4]      | 2026-08-10 | "The **retry** statement erases all messages that have been written to the Infolog since program control entered the **try** block."                                                                                                                                                                                   |
| VB-010 | `throw Exception::Error` writes nothing to the Infolog; `throw error("…")` writes the text first, because `error()` is what logs it       | [MS Learn, X++ exception handling][4]      | 2026-08-10 | `error()` returns `Exception::Error` and writes to the Infolog. It does not itself throw                                                                                                                                                                                                                               |
| VB-011 | `retry` is valid only inside a `catch` block, and jumps to the first line of the associated `try` block                                   | [MS Learn, X++ exception handling][4]      | 2026-08-10 | "The **retry** statement can appear only in a **catch** block."                                                                                                                                                                                                                                                        |
| VB-012 | `validateWrite()` returns a `boolean` — it reports whether the record may be written, it does not write and does not throw by itself      | [MS Learn, xRecord.validateWrite][5]       | 2026-08-11 | "Determines whether the current record is valid and ready to be written." Returns "true if the current record can be written; otherwise, false."                                                                                                                                                                       |
| VB-013 | A plain `buffer.insert()` in X++ does **not** call `validateWrite()`. The form engine and data-entity paths call it; your own code must   | [MS Learn, entity validations][6]          | 2026-08-11 | The doc's caller column reads "Is called by the form engine when a record is saved" and "Isn't called automatically if an insert or update is fired from X++ code". Table-level validations fire automatically on data-entity CUD, "true for all paths (X++, OData, and so on)" — a bare buffer insert is neither path |
| VB-014 | Field-level validation runs before record-level `validateWrite()`, and a field-level failure means `validateWrite()` is never reached     | [MS Learn, entity validations][6]          | 2026-08-11 | "If there was an error, the process errors out at this point, and table-level **validateWrite()** isn't called."                                                                                                                                                                                                       |

### The development environment (VB-015 to VB-026)

The simulated Visual Studio is held to the same standard as the language. A learner who
memorises a menu path that does not exist has been taught something false, and will look
incompetent the first time they sit in front of the real tool. Every command name, node
name and shortcut in `/studio` traces to a row here.

| ID     | Behaviour                                                                                                                                                                           | Verified against                    | Date       | Notes                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VB-015 | Application Explorer is **read-only** for model elements. Viewing, finding references and adding to a project is all it does — editing needs a project                              | [MS Learn, Application Explorer][7] | 2026-08-12 | "you don't use Application Explorer to add or edit model elements. Instead, use it to view elements, view code, find references … To create, design, edit, and build model elements, you must use a finance and operations project."                                                  |
| VB-016 | The AOT classic view groups every model's elements by type under **Data Model**, **Data Types**, **Code**, **User Interface** and **Analytics**                                     | [MS Learn, dev tools tutorial][8]   | 2026-08-12 | "Items that you previously found in the **Data Dictionary** node are now under **Data Model** or **Data Types**. Classes and macros are under **Code**. Forms, menus, and other GUI elements are under **User Interface**. Business intelligence components are under **Analytics**." |
| VB-017 | Application Explorer opens in classic view; right-clicking the **AOT** node switches between **Model view** and **Classic view**                                                    | [MS Learn, Application Explorer][7] | 2026-08-12 | Model view lists each model separately, with elements grouped inside it as in classic view                                                                                                                                                                                            |
| VB-018 | A designer is opened by right-clicking the element: **Open designer** in Application Explorer, **Open** in a project                                                                | [MS Learn, element designers][9]    | 2026-08-12 | The **Properties** pane follows the selected node, and can be ordered **Alphabetical**, **Categorized**, **Changed** or **Frequency**                                                                                                                                                 |
| VB-019 | A field is added by right-clicking the table's **Fields** node, pointing to **New**, and choosing the field type                                                                    | [MS Learn, element designers][9]    | 2026-08-12 | Fields join a field group by being dragged onto it; a method is added by right-clicking **Methods** and selecting **New Method** ([create data model elements][10])                                                                                                                   |
| VB-020 | **Build** and **Rebuild** act on a project, from the **Build** menu or the project's context menu in Solution Explorer                                                              | [MS Learn, build operations][11]    | 2026-08-12 | Build performs metadata validation, X++ validation, best practice checks, report RDL generation, compilation and IL generation, label assembly generation, and database synchronization                                                                                               |
| VB-021 | Synchronising is three separate things: the project's context menu, the **Dynamics 365 > Synchronize database** command, and the project property **Synchronize database on build** | [MS Learn, build operations][11]    | 2026-08-12 | "right-click the project in Solution Explorer and then select **Synchronize &lt;project name&gt; with database**. To synchronize the entire database … on the **Dynamics 365** menu, select **Synchronize database**."                                                                |
| VB-022 | **F9** toggles a breakpoint on the current line; **F5** starts debugging and continues from a break; **F10** steps a line at a time                                                 | [MS Learn, build and debug][12]     | 2026-08-12 | "click anywhere in the line of code, and then press F9" — the breakpoint shows as a red-filled circle in the margin. Debug menu carries **Start Debugging**, **Stop Debugging**, **Delete All Breakpoints**                                                                           |
| VB-023 | The **Autos** window shows the current company, the partition, the transaction level, and the current user ID                                                                       | [MS Learn, debug X++][13]           | 2026-08-12 | This is the F&O-specific part of the debugger, and the reason the Autos window is worth teaching at all                                                                                                                                                                               |
| VB-024 | In the **Locals** window a table buffer expands to its fields, and fields left out of a `select` field list display as `null`                                                       | [MS Learn, debug X++][13]           | 2026-08-12 | "The fields that are selected … appear with their selected values, while the unselected fields appear as `null`." The doc calls this "a debugging artifact" — the real value is the type's default                                                                                    |
| VB-025 | A breakpoint can carry a **Condition**, a **Hit count**, or an **Action**; an action that prints instead of breaking is a trace point                                               | [MS Learn, debug X++][13]           | 2026-08-12 | Reached through the breakpoint's own context menu                                                                                                                                                                                                                                     |
| VB-026 | A startup object must be a form, a class with a `main` method, or a menu item, and is set per project                                                                               | [MS Learn, debug X++][13]           | 2026-08-12 | Set in the project's property pages, or by right-clicking the element and selecting **Set as Startup Object**                                                                                                                                                                         |

### Financial dimensions (VB-027 to VB-033)

| ID     | Behaviour                                                                                                                                                                  | Verified against                     | Date       | Notes                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VB-027 | A `DefaultDimension` field holds a foreign key to **DimensionAttributeValueSet**; each individual value is a row in **DimensionAttributeValueSetItem** sharing that parent | [MS Learn, default dimensions][14]   | 2026-08-12 | "the LedgerJournalTable table has a **DimensionDefault** column that holds a foreign key reference to a record in the DimensionAttributeValueSet table … Each value is stored as a separate row in the DimensionAttributeValueSetItem table" |
| VB-028 | The framework stores **no row at all** for a dimension with no value, so a cleared value is indistinguishable from one never entered                                       | [MS Learn, default dimensions][14]   | 2026-08-12 | "the framework can't distinguish a dimension that didn't have a value from a dimension that did have a value, but it was cleared". The documented workaround is a real value named `empty`, `n/a` or `*blank*`                               |
| VB-029 | Dimension records are **immutable**. Adding or changing a value creates a **new** value set with new set items; the old set is left untouched                              | [MS Learn, default dimensions][14]   | 2026-08-12 | "You initially write them, but you never subsequently update or delete them … the dimension framework creates a new value set record and four additional value set item records … rather than changing the previous dimension set"           |
| VB-030 | Merging default dimensions: a value already set on the target wins and the source is skipped; a blank on the target takes the source's value                               | [MS Learn, default dimensions][14]   | 2026-08-12 | Worked example, quoted below. When nothing actually changes the merge reuses the existing set record rather than writing a new one                                                                                                           |
| VB-031 | Default dimensions supply every dimension **except MainAccount**. A ledger account combination is MainAccount plus dimension values, ordered by the account structure      | [MS Learn, default dimensions][14]   | 2026-08-12 | "Default dimensions provide all the dimensions, except MainAccount, that are required for a ledger account combination."                                                                                                                     |
| VB-032 | Two kinds of dimension exist: **custom** (values maintained by hand, always shared across legal entities) and **entity-backed** (values come from another table)           | [MS Learn, financial dimensions][15] | 2026-08-12 | Dimension values are at most 30 characters. Entity-backed values are not selectable until the source record is used in a transaction, journal or posting profile                                                                             |
| VB-033 | A dimension set as **Fixed** on a main account overrides the transaction's value at posting time, including when the fixed value is blank                                  | [MS Learn, default dimensions][14]   | 2026-08-12 | "A **Fixed** dimension always overwrites the dimension value at posting time, even if a user manually enters a different value."                                                                                                             |

### Classes and methods (VB-034 to VB-046)

The access modifiers are where this language quietly differs from the ones people arrive
from. Two of the defaults are the opposite of C#'s, and getting them wrong produces code
that compiles and then fails review.

| ID     | Behaviour                                                                                                                                   | Verified against                    | Date       | Notes                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| VB-034 | A method with **no access modifier is implicitly public**                                                                                   | [MS Learn, classes and methods][16] | 2026-08-12 | "Methods without an access modifier are implicitly public." The opposite of C#, where an unmarked member is private             |
| VB-035 | An instance **field is `protected` by default**                                                                                             | [MS Learn, classes and methods][16] | 2026-08-12 | "Instance fields are **protected** by default … you can access these fields only within the same class or a derived class"      |
| VB-036 | Every class is **public**. Removing the `public` modifier changes nothing                                                                   | [MS Learn, classes and methods][16] | 2026-08-12 | "All classes are public by default. If you remove the **public** modifier, the system still treats the class as public."        |
| VB-037 | Every method requires a return type, and `void` is the one for a method that returns nothing                                                | [MS Learn, classes and methods][16] | 2026-08-12 | A bare `return;` is legal in a `void` method, and "There's an implicit return when the method flow reaches the end."            |
| VB-038 | `private` is callable only from the declaring class and **cannot be overridden**; `protected` reaches subclasses; `public` reaches anywhere | [MS Learn, classes and methods][16] | 2026-08-12 | "You can't override private methods in a subclass."                                                                             |
| VB-039 | Access modifiers **never** restrict calls between two methods of the same class, whichever of them is static                                | [MS Learn, classes and methods][16] | 2026-08-12 | Including `new`: a static method may call a `private` constructor of its own class                                              |
| VB-040 | A `static` method cannot refer to instance fields, and is called as `ClassName::methodName()`                                               | [MS Learn, classes and methods][16] | 2026-08-12 | "They aren't invoked on an instance of the class."                                                                              |
| VB-041 | `this` qualifies instance methods and is **not** usable in a static method, nor to qualify a static method                                  | [MS Learn, classes and methods][16] | 2026-08-12 | "All calls to instance methods must be qualified by either the **this** reference or a variable."                               |
| VB-042 | A class may define only one `new`. With none defined, a parameterless default constructor exists                                            | [MS Learn, classes and methods][16] | 2026-08-12 | Optional parameters are how a constructor simulates several signatures                                                          |
| VB-043 | `finalize` is a **naming convention with no special semantics** — nothing ever calls it for you                                             | [MS Learn, classes and methods][16] | 2026-08-12 | "The managed runtime doesn't make implicit calls to the **finalize** method … You must call the method to explicitly clean up." |
| VB-044 | An overriding method must be **at least as accessible** as the one it overrides                                                             | [MS Learn, classes and methods][16] | 2026-08-12 | "In a subclass, a private method can't override a protected method of the superclass."                                          |
| VB-045 | A parameter with a default becomes optional; required parameters come first, and a call cannot skip one                                     | [MS Learn, classes and methods][16] | 2026-08-12 | The doc's own example shows `AddThreeInts(1, , 99)` failing to compile                                                          |
| VB-046 | A `display` method's return value is shown on a page or report and cannot be edited there; `edit` is the modifiable counterpart             | [MS Learn, classes and methods][16] | 2026-08-12 | The modifier grammar is `[edit \| display] [public \| protected \| private] [static \| abstract \| final]`                      |

### Reports and queries (VB-047 to VB-051)

| ID     | Behaviour                                                                                                                                                                                                               | Verified against                         | Date       | Notes                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VB-047 | An RDP report is **four elements**: a temporary table, a data contract, an RDP class, and a design bound to the RDP's data set                                                                                          | [MS Learn, RDP walkthrough][17]          | 2026-08-12 | "Temporary table … Data contract class – defines the parameters in the report. Report data provider class – processes business logic … and then returns the tables as a dataset" |
| VB-048 | The contract is `[DataContractAttribute]` on the class and `[DataMemberAttribute("Name")]` on `parm` methods of the form `parmX(T _x = x)`                                                                              | [MS Learn, RDP walkthrough][17]          | 2026-08-12 | The name in the attribute is the parameter name the report design sees                                                                                                           |
| VB-049 | The RDP extends `SRSReportDataProviderBase`, carries `[SRSReportQueryAttribute]` and `[SRSReportParameterAttribute]`, overrides `processReport()`, and exposes the table through a `[SRSReportDataSetAttribute]` getter | [MS Learn, RDP walkthrough][17]          | 2026-08-12 | Inside `processReport`, `this.parmQuery()` and `this.parmDataContract()` are the base-class methods that read those two attributes                                               |
| VB-050 | Reports follow **Model–View–Controller**. `SrsReportRunController` is given the report name, builds the parameter UI, validates, and runs it                                                                            | [MS Learn, report programming model][18] | 2026-08-12 | The controller is what a menu item points at — the entry point of a report, not the RDP                                                                                          |
| VB-051 | A query is built as `new Query()` → `addDataSource(tableNum(…))` → `addRange(fieldNum(…))` → `.value(queryValue(…))`, then walked with `new QueryRun(query)` and `queryRun.next()` / `queryRun.get(tableNum(…))`        | [MS Learn, query objects][19]            | 2026-08-12 | Joins come from `qbds1.addDataSource(...)` plus `relations(true)` and `joinMode(JoinMode::ExistsJoin)`. Ranges take an advanced syntax — `">2"`, wildcards                       |

> **Source age.** VB-047 to VB-050 rest on pages Microsoft has **archived** — they carry
> the AX 2012 moniker and a "this content is archived" banner. The pattern itself is not
> archived: `SRSReportDataProviderBase`, `SrsReportRunController` and the attributes are
> what F&O reports are still written with today, and the current documentation references
> those classes. But the walkthroughs are old, so the _shape_ is what we teach and the
> exact current wording is logged in `docs/unverified.md` as needing a live check.

[1]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-data/xpp-transaction
[2]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-operators
[3]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-variables-data-types
[4]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-exceptions
[5]: https://learn.microsoft.com/en-us/dotnet/api/dynamics.ax.application.xrecord.validatewrite?view=dyn-finops-dotnet
[6]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/validations-defaults-unmapped-fields
[7]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/application-explorer
[8]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/introduction-visual-studio
[9]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/element-designers
[10]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/create-data-model-elements
[11]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/build-operations
[12]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/build-debug-project
[13]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/debug-xpp
[14]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/financial/dimension-defaulting
[15]: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-dimensions
[16]: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-classes-methods
[17]: https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/walkthrough-creating-a-report-bound-to-a-report-data-provider-class-x-business-logic
[18]: https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/report-programming-model
[19]: https://learn.microsoft.com/en-us/training/modules/build-reports-finance-operations/query-objects-query-builder

### On VB-030: the merge table is Microsoft's, not ours

The default-dimensions article publishes a worked merge with its expected result. Like the
three exception golden files, this makes the expectation sourced rather than self-authored,
so it is reproduced verbatim as the fixture behind the dimension-merge lesson:

| Dimension    | Merged result 1 | Item    | Merged result 2 | Why                                                |
| ------------ | --------------- | ------- | --------------- | -------------------------------------------------- |
| BusinessUnit |                 |         |                 | Blank in both sources                              |
| CostCenter   |                 | 008     | 008             | Blank on the target, so the item's value is copied |
| Department   | 027             | 023     | 027             | Already set on the target, so the item is skipped  |
| ItemGroup    |                 | AudioRM | AudioRM         | Blank on the target, so the item's value is copied |
| Project      | 000003          |         | 000003          | Already set on the target                          |

`Department` is the row that teaches the rule: the item carried `023` and it lost. Merging
is not "last writer wins", and a developer who assumes it is will ship a defaulting bug
that only shows up on the documents where both sources happen to be populated.

### On VB-008 and VB-010: three golden files come straight from the source

The exception-handling reference publishes worked examples together with their **actual
Infolog output**. Three are reproduced verbatim as golden files in
`packages/xpp-runtime/fixtures/`, which makes them the most strongly-sourced tests in the
engine — the expected output is Microsoft's, not ours:

| Golden file                    | What it pins                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `throw-inside-transaction.xpp` | VB-008 — the inner `catch` is skipped, the outer one runs            |
| `throw-enum-vs-error.xpp`      | VB-010 — `throw Exception::Error` logs nothing, `throw error()` does |
| `retry-erases-infolog.xpp`     | VB-009 — earlier Infolog lines vanish on `retry`                     |

VB-008 is the single most surprising rule in X++ exception handling, and it is invisible
until it bites: a developer wraps a transaction in `try`/`catch`, watches the catch never
fire, and has no idea why. It belongs in lesson 8.

### On VB-005

The precedence table, highest binding first:

| Level | Operators                                    | Note                                                   |
| ----- | -------------------------------------------- | ------------------------------------------------------ |
| 1     | `-` `~` `!` (unary)                          |                                                        |
| 2     | `*` `/` `div` `mod` `<<` `>>` `&` `^`        | Shifts and bitwise AND/XOR share a level with multiply |
| 3     | `+` `-` `\|`                                 | Bitwise OR shares a level with addition                |
| 4     | `<` `<=` `==` `!=` `>` `>=` `like` `as` `is` |                                                        |
| 5     | `&&` `\|\|`                                  | **Same level**, left to right                          |
| 6     | `?:`                                         |                                                        |

Three of these differ from C, C#, JavaScript and TypeScript, and every one of them is a
trap for the audience this site is for:

- `&&` does not bind tighter than `||`. `a || b && c` parses as `(a || b) && c`.
- `&` and `^` bind as tightly as `*`, not far below equality.
- `|` binds as tightly as `+`.

`packages/xpp-parser/test/precedence.test.ts` asserts each of these directly, including
both worked examples from the source page. This is prime lesson material — a NAV or C#
developer will read `a || b && c` wrongly, and the parse tree proves it.

### On VB-001 and PLAN.md's Phase 1 acceptance criterion

PLAN.md asks for "a test that opens nested transactions, aborts the inner one, and asserts
the outer state is intact". That is SQLite savepoint behaviour, not X++ behaviour — in X++
an abort at any depth discards everything (VB-001).

Both are implemented and both are tested, at the layer where each is true:

- `SavepointStack` (`src/core/savepoints.ts`) is the raw SQLite mechanism. Rolling back to
  an inner savepoint there does leave the outer work intact, and
  `test/savepoints.test.ts` asserts exactly that. This is the criterion as written.
- `TransactionManager` (`src/core/transactions.ts`) implements X++ on top of it, so
  `ttsabort` rolls back to the outermost savepoint and sets `ttsLevel` to 0.
  `test/transactions.test.ts` asserts that, citing VB-001.

Shipping only the savepoint reading would have taught the wrong thing in the lesson where
it matters most (Phase 6, lesson 3). See CLAUDE.md > Fidelity rule.
