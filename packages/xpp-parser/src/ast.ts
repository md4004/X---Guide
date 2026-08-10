/**
 * The X++ v1 AST.
 *
 * Node `kind` strings are part of the public contract: `ast` validators in
 * docs/lesson-schema.md name them directly (`usesStatement: "whileSelect"`). Renaming a
 * kind breaks authored lessons, so treat these as frozen once Phase 5 ships.
 */

import type { SourceSpan } from "@xpplab/xpp-core";
import type { XppKeyword } from "@xpplab/xpp-lexer";

export interface NodeBase {
  kind: NodeKind;
  span: SourceSpan;
}

export type Node = SourceUnit | Declaration | Statement | Expression | AstFragment;

export type NodeKind = Node["kind"];

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

/**
 * A parsed unit of learner code. The playground normally produces a "job": a bare list
 * of statements with no enclosing class. Lessons from Phase 8 onward also declare
 * classes, so both live side by side.
 */
export interface SourceUnit extends NodeBase {
  kind: "sourceUnit";
  declarations: ClassDeclaration[];
  statements: Statement[];
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export type Declaration =
  ClassDeclaration | MethodDeclaration | ParameterDeclaration | FieldDeclaration;

export interface Attribute extends NodeBase {
  kind: "attribute";
  name: string;
  arguments: Expression[];
}

export interface ClassDeclaration extends NodeBase {
  kind: "classDeclaration";
  name: string;
  attributes: Attribute[];
  modifiers: MemberModifier[];
  extendsClass?: string;
  implementsInterfaces: string[];
  fields: FieldDeclaration[];
  methods: MethodDeclaration[];
}

export type MemberModifier = Extract<
  XppKeyword,
  "public" | "protected" | "private" | "static" | "final" | "abstract"
>;

export interface FieldDeclaration extends NodeBase {
  kind: "fieldDeclaration";
  modifiers: MemberModifier[];
  type: TypeReference;
  names: string[];
}

export interface MethodDeclaration extends NodeBase {
  kind: "methodDeclaration";
  name: string;
  attributes: Attribute[];
  modifiers: MemberModifier[];
  returnType: TypeReference;
  parameters: ParameterDeclaration[];
  body: BlockStatement;
}

export interface ParameterDeclaration extends NodeBase {
  kind: "parameterDeclaration";
  type: TypeReference;
  name: string;
  defaultValue?: Expression;
}

/**
 * A type in source position. `name` is the written name — `int`, `str`, `CustTable`,
 * `NoYes`, `List`. Resolving it to a primitive, a table buffer, an enum or a class is
 * the runtime's job, not the parser's.
 */
export interface TypeReference extends NodeBase {
  kind: "typeReference";
  name: string;
  /** `str 30` — the declared string length, when written. */
  length?: number;
  /** `int myArray[10]` — the declared array bound. */
  arrayBound?: number;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type Statement =
  | BlockStatement
  | VariableDeclarationStatement
  | ExpressionStatement
  | IfStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | SwitchStatement
  | BreakStatement
  | ContinueStatement
  | ReturnStatement
  | ThrowStatement
  | TryCatchStatement
  | TtsBeginStatement
  | TtsCommitStatement
  | TtsAbortStatement
  | ChangeCompanyStatement
  | SelectStatement
  | WhileSelectStatement
  | InsertRecordsetStatement
  | UpdateRecordsetStatement
  | DeleteFromStatement
  | EmptyStatement;

export interface BlockStatement extends NodeBase {
  kind: "block";
  statements: Statement[];
}

export interface VariableDeclarationStatement extends NodeBase {
  kind: "variableDeclaration";
  type: TypeReference;
  declarators: VariableDeclarator[];
}

export interface VariableDeclarator extends NodeBase {
  kind: "variableDeclarator";
  name: string;
  initializer?: Expression;
}

export interface ExpressionStatement extends NodeBase {
  kind: "expressionStatement";
  expression: Expression;
}

export interface IfStatement extends NodeBase {
  kind: "if";
  test: Expression;
  consequent: Statement;
  alternate?: Statement;
}

export interface WhileStatement extends NodeBase {
  kind: "while";
  test: Expression;
  body: Statement;
}

export interface DoWhileStatement extends NodeBase {
  kind: "doWhile";
  body: Statement;
  test: Expression;
}

export interface ForStatement extends NodeBase {
  kind: "for";
  init?: Expression;
  test?: Expression;
  update?: Expression;
  body: Statement;
}

export interface SwitchStatement extends NodeBase {
  kind: "switch";
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface SwitchCase extends NodeBase {
  kind: "switchCase";
  /** `undefined` for `default`. X++ allows `case 1, 2:` — hence a list. */
  tests?: Expression[];
  statements: Statement[];
}

export interface BreakStatement extends NodeBase {
  kind: "break";
}

export interface ContinueStatement extends NodeBase {
  kind: "continue";
}

export interface ReturnStatement extends NodeBase {
  kind: "return";
  argument?: Expression;
}

export interface ThrowStatement extends NodeBase {
  kind: "throw";
  argument: Expression;
}

export interface TryCatchStatement extends NodeBase {
  kind: "tryCatch";
  block: BlockStatement;
  handlers: CatchClause[];
}

export interface CatchClause extends NodeBase {
  kind: "catchClause";
  /** `catch` with no qualifier catches everything. */
  exception?: Expression;
  body: BlockStatement;
}

export interface TtsBeginStatement extends NodeBase {
  kind: "ttsBegin";
}

export interface TtsCommitStatement extends NodeBase {
  kind: "ttsCommit";
}

export interface TtsAbortStatement extends NodeBase {
  kind: "ttsAbort";
}

export interface ChangeCompanyStatement extends NodeBase {
  kind: "changeCompany";
  company: Expression;
  body: Statement;
}

export interface EmptyStatement extends NodeBase {
  kind: "emptyStatement";
}

// ---------------------------------------------------------------------------
// Select and DML
// ---------------------------------------------------------------------------

export type SelectModifier = Extract<
  XppKeyword,
  | "crosscompany"
  | "firstonly"
  | "firstonly10"
  | "firstonly100"
  | "firstonly1000"
  | "forupdate"
  | "reverse"
>;

export type AggregateFunction = Extract<XppKeyword, "avg" | "count" | "maxof" | "minof" | "sum">;

export interface SelectFieldList extends NodeBase {
  kind: "selectFieldList";
  /** `true` for `select *` or an omitted field list. */
  all: boolean;
  fields: SelectField[];
}

export interface SelectField extends NodeBase {
  kind: "selectField";
  name: string;
  aggregate?: AggregateFunction;
}

export type JoinKind = "inner" | "outer" | "exists" | "notexists";

export interface SelectSource extends NodeBase {
  kind: "selectSource";
  /** The buffer variable being selected into, e.g. `inventTable`. */
  buffer: string;
  fieldList?: SelectFieldList;
  joins: SelectJoin[];
}

export interface SelectJoin extends NodeBase {
  kind: "selectJoin";
  joinKind: JoinKind;
  source: SelectSource;
  /** The `where` that binds this join to its parent. */
  on?: Expression;
}

export interface OrderByClause extends NodeBase {
  kind: "orderBy";
  entries: OrderByEntry[];
  /** `group by` reuses the same shape. */
  grouping: boolean;
}

export interface OrderByEntry extends NodeBase {
  kind: "orderByEntry";
  field: string;
  direction: "asc" | "desc";
}

/**
 * The clause bundle shared by `select`, `while select` and the set-based statements.
 * Keeping it in one node means `selectToSql` has exactly one input shape.
 */
export interface SelectClauses extends NodeBase {
  kind: "selectClauses";
  modifiers: SelectModifier[];
  source: SelectSource;
  where?: Expression;
  orderBy?: OrderByClause;
}

export interface SelectStatement extends NodeBase {
  kind: "select";
  clauses: SelectClauses;
}

export interface WhileSelectStatement extends NodeBase {
  kind: "whileSelect";
  clauses: SelectClauses;
  body: Statement;
}

/** `insert_recordset target (fields) select fields from source ...` */
export interface InsertRecordsetStatement extends NodeBase {
  kind: "insertRecordset";
  targetBuffer: string;
  targetFields: string[];
  source: SelectClauses;
}

/** `update_recordset target setting f = v where ...` */
export interface UpdateRecordsetStatement extends NodeBase {
  kind: "updateRecordset";
  clauses: SelectClauses;
  assignments: FieldAssignment[];
}

export interface FieldAssignment extends NodeBase {
  kind: "fieldAssignment";
  field: string;
  value: Expression;
}

/** `delete_from target where ...` */
export interface DeleteFromStatement extends NodeBase {
  kind: "deleteFrom";
  clauses: SelectClauses;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expression =
  | Identifier
  | Literal
  | BinaryExpression
  | UnaryExpression
  | AssignmentExpression
  | ConditionalExpression
  | CallExpression
  | MemberExpression
  | IndexExpression
  | NewExpression
  | EnumAccessExpression
  | ContainerExpression
  | UpdateExpression;

export interface Identifier extends NodeBase {
  kind: "identifier";
  name: string;
}

export type LiteralType = "int" | "real" | "str" | "date" | "boolean" | "null";

export interface Literal extends NodeBase {
  kind: "literal";
  literalType: LiteralType;
  value: string | number | boolean | null;
  /** The source text, so the SQL trace can echo what the learner wrote. */
  raw: string;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "mod"
  | "div"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "like"
  | "is"
  | "as";

export interface BinaryExpression extends NodeBase {
  kind: "binary";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export type UnaryOperator = "-" | "+" | "!" | "~" | "not";

export interface UnaryExpression extends NodeBase {
  kind: "unary";
  operator: UnaryOperator;
  argument: Expression;
}

export type AssignmentOperator = "=" | "+=" | "-=" | "*=" | "/=";

export interface AssignmentExpression extends NodeBase {
  kind: "assignment";
  operator: AssignmentOperator;
  target: Expression;
  value: Expression;
}

export interface ConditionalExpression extends NodeBase {
  kind: "conditional";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression extends NodeBase {
  kind: "call";
  callee: Expression;
  arguments: Expression[];
}

export interface MemberExpression extends NodeBase {
  kind: "memberAccess";
  object: Expression;
  member: string;
}

export interface IndexExpression extends NodeBase {
  kind: "index";
  object: Expression;
  index: Expression;
}

export interface NewExpression extends NodeBase {
  kind: "new";
  className: string;
  arguments: Expression[];
}

/** `NoYes::Yes` */
export interface EnumAccessExpression extends NodeBase {
  kind: "enumAccess";
  enumName: string;
  valueName: string;
}

/** `[1, "two", 3.0]` */
export interface ContainerExpression extends NodeBase {
  kind: "container";
  elements: Expression[];
}

/** `counter++` / `++counter` */
export interface UpdateExpression extends NodeBase {
  kind: "update";
  operator: "++" | "--";
  prefix: boolean;
  argument: Expression;
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/** Nodes that are neither statements nor expressions but still appear in the tree. */
export type AstFragment =
  | Attribute
  | TypeReference
  | VariableDeclarator
  | SwitchCase
  | CatchClause
  | SelectClauses
  | SelectSource
  | SelectJoin
  | SelectFieldList
  | SelectField
  | OrderByClause
  | OrderByEntry
  | FieldAssignment;
