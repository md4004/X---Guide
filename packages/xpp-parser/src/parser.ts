/**
 * Recursive descent over the token stream.
 *
 * Two things matter more here than they would in a compiler:
 *
 * 1. **Error messages teach.** Every failure names what was expected, in the learner's
 *    terms, with a hint. A construct that is real X++ but outside our subset gets
 *    `XP100` and an explanation, never a bare syntax error.
 * 2. **Recovery.** On a failure the parser skips to the next statement boundary and
 *    keeps going, so three mistakes produce three markers rather than one.
 *
 * Operator precedence follows X++, which is not C's — see VB-005. That is encoded in
 * `BINARY_PRECEDENCE` below and pinned by test/precedence.test.ts.
 */

import {
  XppErrorCodes,
  createError,
  type SourcePosition,
  type SourceSpan,
  type XppError,
} from "@xpplab/xpp-core";
import { tokenize, type Token, type XppKeyword, type XppPunctuator } from "@xpplab/xpp-lexer";
import type {
  Attribute,
  BinaryOperator,
  BlockStatement,
  CatchClause,
  ClassDeclaration,
  Expression,
  FieldAssignment,
  FieldDeclaration,
  MemberModifier,
  MethodDeclaration,
  OrderByClause,
  OrderByEntry,
  ParameterDeclaration,
  SelectClauses,
  SelectField,
  SelectFieldList,
  SelectJoin,
  SelectModifier,
  SelectSource,
  SourceUnit,
  Statement,
  SwitchCase,
  TypeReference,
  VariableDeclarator,
} from "./ast.js";

export interface ParserOptions {
  maxErrors?: number;
}

export interface ParseResult {
  ast: SourceUnit | null;
  errors: XppError[];
  tokens: Token[];
}

// ---------------------------------------------------------------------------
// Precedence — VB-005
// ---------------------------------------------------------------------------

/**
 * Higher binds tighter. Deliberately NOT C's table:
 *   - `&` and `^` sit with `*`, not far below equality.
 *   - `|` sits with `+`.
 *   - `&&` and `||` share one level and associate left to right, so
 *     `a || b && c` is `(a || b) && c`.
 *
 * Source: MS Learn, "X++ operators", operator precedence table.
 */
const BINARY_PRECEDENCE: Partial<Record<string, number>> = {
  "*": 5,
  "/": 5,
  div: 5,
  mod: 5,
  "<<": 5,
  ">>": 5,
  "&": 5,
  "^": 5,

  "+": 4,
  "-": 4,
  "|": 4,

  "<": 3,
  "<=": 3,
  "==": 3,
  "!=": 3,
  ">": 3,
  ">=": 3,
  like: 3,
  as: 3,
  is: 3,

  "&&": 2,
  "||": 2,
};

const LOWEST_BINARY_PRECEDENCE = 2;

/** Select modifiers that are real X++ but deliberately out of subset. */
const REJECTED_SELECT_MODIFIERS: Record<string, string> = {
  forceliterals:
    "This simulator always parameterises its SQL, so query-plan hints have nothing to act on. Remove it — the SQL trace shows you the statement either way.",
  forceplaceholders:
    "This simulator always parameterises its SQL, so this hint is already the behaviour. Remove it.",
  forceselectorder:
    "Join-order hints depend on a real SQL Server optimiser, which this simulator does not have. Remove it.",
  validtimestate:
    "Date-effective tables are out of scope for v1. Filter on the date fields yourself instead.",
  optimisticlock: "Lock hints are out of scope for v1. Use `forupdate` and a transaction.",
  pessimisticlock: "Lock hints are out of scope for v1. Use `forupdate` and a transaction.",
};

/** Types that exist in X++ but that the v1 subset does not model. */
const REJECTED_TYPES: Record<string, string> = {
  query:
    "The Query/QueryRun object model is out of subset. Write the same thing as a `select` statement — that is what the lessons teach.",
  queryrun:
    "The Query/QueryRun object model is out of subset. Write the same thing as a `select` statement.",
  querybuilddatasource: "The Query object model is out of subset. Use a `select` statement.",
  querybuildrange: "The Query object model is out of subset. Use a `where` clause.",
  recordsortedlist: "RecordSortedList is out of subset. Use a `List` or a `while select`.",
  recordlinklist: "RecordLinkList is out of subset. Use a `List` or a `while select`.",
};

export function parse(source: string, options: ParserOptions = {}): ParseResult {
  const { tokens, errors: lexErrors } = tokenize(source);
  const parser = new Parser(tokens, lexErrors, options);
  return parser.parseSourceUnit();
}

export function parseExpression(source: string, options: ParserOptions = {}): Expression | null {
  const { tokens, errors } = tokenize(source);
  const parser = new Parser(tokens, errors, options);
  return parser.parseStandaloneExpression();
}

class BailOut extends Error {}

class Parser {
  readonly #tokens: Token[];
  readonly #errors: XppError[];
  readonly #maxErrors: number;
  #index = 0;

  constructor(tokens: Token[], lexErrors: XppError[], options: ParserOptions) {
    this.#tokens = tokens;
    this.#errors = [...lexErrors];
    this.#maxErrors = options.maxErrors ?? 25;
  }

  // -- token cursor --------------------------------------------------------

  #peek(ahead = 0): Token {
    return this.#tokens[Math.min(this.#index + ahead, this.#tokens.length - 1)]!;
  }

  #atEnd(): boolean {
    return this.#peek().kind === "eof";
  }

  #next(): Token {
    const token = this.#peek();
    if (!this.#atEnd()) this.#index += 1;
    return token;
  }

  #isKeyword(word: XppKeyword, ahead = 0): boolean {
    const token = this.#peek(ahead);
    return token.kind === "keyword" && token.keyword === word;
  }

  #isPunctuator(symbol: XppPunctuator, ahead = 0): boolean {
    const token = this.#peek(ahead);
    return token.kind === "punctuator" && token.punctuator === symbol;
  }

  #eatKeyword(word: XppKeyword): boolean {
    if (!this.#isKeyword(word)) return false;
    this.#next();
    return true;
  }

  #eatPunctuator(symbol: XppPunctuator): boolean {
    if (!this.#isPunctuator(symbol)) return false;
    this.#next();
    return true;
  }

  #expectPunctuator(symbol: XppPunctuator, context: string): Token {
    if (this.#isPunctuator(symbol)) return this.#next();
    this.#fail(
      XppErrorCodes.ExpectedToken,
      `Expected '${symbol}' ${context}, but found ${describe(this.#peek())}.`,
      hintForMissing(symbol, context),
    );
  }

  #expectKeyword(word: XppKeyword, context: string): Token {
    if (this.#isKeyword(word)) return this.#next();
    this.#fail(
      XppErrorCodes.ExpectedToken,
      `Expected '${word}' ${context}, but found ${describe(this.#peek())}.`,
    );
  }

  #expectIdentifier(context: string): string {
    const token = this.#peek();
    if (token.kind === "identifier") {
      this.#next();
      return token.text;
    }
    // A keyword where a name belongs is nearly always a reserved-word collision, and
    // saying so is more use than "expected identifier".
    const hint =
      token.kind === "keyword"
        ? `'${token.text}' is a reserved word in X++, so it cannot be used as a name here.`
        : undefined;
    this.#fail(
      XppErrorCodes.ExpectedToken,
      `Expected a name ${context}, but found ${describe(token)}.`,
      hint,
    );
  }

  // -- errors --------------------------------------------------------------

  #record(code: XppError["code"], message: string, span: SourceSpan, hint?: string): void {
    if (this.#errors.length >= this.#maxErrors) throw new BailOut();
    this.#errors.push(createError(code, message, span, hint));
  }

  /** Records an error at the current token and unwinds to the recovery point. */
  #fail(code: XppError["code"], message: string, hint?: string): never {
    this.#record(code, message, this.#peek().span, hint);
    throw new BailOut();
  }

  /** Records an error without unwinding — the parse can carry on from here. */
  #warn(code: XppError["code"], message: string, span: SourceSpan, hint?: string): void {
    this.#record(code, message, span, hint);
  }

  /**
   * Skips forward to somewhere a new statement plausibly starts, so one mistake costs
   * one diagnostic rather than every diagnostic after it.
   */
  #recover(): void {
    const startIndex = this.#index;
    let depth = 0;

    while (!this.#atEnd()) {
      if (this.#isPunctuator("{")) depth += 1;
      if (this.#isPunctuator("}")) {
        if (depth === 0) return;
        depth -= 1;
        this.#next();
        if (depth === 0) return;
        continue;
      }
      if (this.#isPunctuator(";") && depth === 0) {
        this.#next();
        return;
      }
      this.#next();
    }

    // Never leave the cursor where it started, or the caller loops forever.
    if (this.#index === startIndex && !this.#atEnd()) this.#next();
  }

  // -- entry points --------------------------------------------------------

  parseSourceUnit(): ParseResult {
    const start = this.#peek().span.start;
    const declarations: ClassDeclaration[] = [];
    const statements: Statement[] = [];

    try {
      while (!this.#atEnd()) {
        const before = this.#index;
        try {
          if (this.#startsClassDeclaration()) {
            declarations.push(this.#classDeclaration());
          } else {
            statements.push(this.#statement());
          }
        } catch (error) {
          if (!(error instanceof BailOut)) throw error;
          this.#recover();
        }
        if (this.#index === before && !this.#atEnd()) this.#next();
      }
    } catch (error) {
      if (!(error instanceof BailOut)) throw error;
    }

    const ast: SourceUnit = {
      kind: "sourceUnit",
      declarations,
      statements,
      span: { start, end: this.#peek().span.end },
    };

    return { ast, errors: this.#errors, tokens: this.#tokens };
  }

  parseStandaloneExpression(): Expression | null {
    try {
      return this.#expression();
    } catch (error) {
      if (!(error instanceof BailOut)) throw error;
      return null;
    }
  }

  // -- declarations --------------------------------------------------------

  #startsClassDeclaration(): boolean {
    if (this.#isPunctuator("[")) return true;
    let ahead = 0;
    while (isMemberModifier(this.#peek(ahead))) ahead += 1;
    return this.#isKeyword("class", ahead) || this.#isKeyword("interface", ahead);
  }

  #attributes(): Attribute[] {
    const attributes: Attribute[] = [];
    while (this.#isPunctuator("[")) {
      const start = this.#next().span.start;
      const name = this.#expectIdentifier("for the attribute name");
      const args: Expression[] = [];
      if (this.#eatPunctuator("(")) {
        if (!this.#isPunctuator(")")) {
          do {
            args.push(this.#expression());
          } while (this.#eatPunctuator(","));
        }
        this.#expectPunctuator(")", "to close the attribute arguments");
      }
      this.#expectPunctuator("]", "to close the attribute");
      attributes.push({
        kind: "attribute",
        name,
        arguments: args,
        span: { start, end: this.#previousEnd() },
      });
    }
    return attributes;
  }

  #modifiers(): MemberModifier[] {
    const modifiers: MemberModifier[] = [];
    while (isMemberModifier(this.#peek())) {
      modifiers.push(this.#next().keyword as MemberModifier);
    }
    return modifiers;
  }

  #classDeclaration(): ClassDeclaration {
    const start = this.#peek().span.start;
    const attributes = this.#attributes();
    const modifiers = this.#modifiers();

    if (this.#isKeyword("interface")) this.#next();
    else this.#expectKeyword("class", "to start a class declaration");

    const name = this.#expectIdentifier("for the class name");

    let extendsClass: string | undefined;
    if (this.#eatKeyword("extends")) extendsClass = this.#expectIdentifier("after 'extends'");

    const implementsInterfaces: string[] = [];
    if (this.#eatKeyword("implements")) {
      do {
        implementsInterfaces.push(this.#expectIdentifier("after 'implements'"));
      } while (this.#eatPunctuator(","));
    }

    this.#expectPunctuator("{", "to open the class body");

    const fields: FieldDeclaration[] = [];
    const methods: MethodDeclaration[] = [];

    while (!this.#isPunctuator("}") && !this.#atEnd()) {
      const before = this.#index;
      try {
        const member = this.#classMember();
        if (member.kind === "methodDeclaration") methods.push(member);
        else fields.push(member);
      } catch (error) {
        if (!(error instanceof BailOut)) throw error;
        this.#recover();
      }
      if (this.#index === before && !this.#atEnd()) this.#next();
    }

    this.#expectPunctuator("}", "to close the class body");

    return {
      kind: "classDeclaration",
      name,
      attributes,
      modifiers,
      ...(extendsClass === undefined ? {} : { extendsClass }),
      implementsInterfaces,
      fields,
      methods,
      span: { start, end: this.#previousEnd() },
    };
  }

  #classMember(): FieldDeclaration | MethodDeclaration {
    const start = this.#peek().span.start;
    const attributes = this.#attributes();
    const modifiers = this.#modifiers();
    const type = this.#typeReference();

    // `public void new(...)` — the constructor's name is a keyword.
    const isConstructor = this.#isKeyword("new");
    const name = isConstructor ? this.#next().text : this.#expectIdentifier("for the member name");

    if (this.#isPunctuator("(")) {
      const parameters = this.#parameterList();
      const body = this.#block();
      return {
        kind: "methodDeclaration",
        name,
        attributes,
        modifiers,
        returnType: type,
        parameters,
        body,
        span: { start, end: this.#previousEnd() },
      };
    }

    const names = [name];
    while (this.#eatPunctuator(",")) names.push(this.#expectIdentifier("for the field name"));
    this.#expectPunctuator(";", "after the field declaration");

    return {
      kind: "fieldDeclaration",
      modifiers,
      type,
      names,
      span: { start, end: this.#previousEnd() },
    };
  }

  #parameterList(): ParameterDeclaration[] {
    this.#expectPunctuator("(", "to open the parameter list");
    const parameters: ParameterDeclaration[] = [];

    if (!this.#isPunctuator(")")) {
      do {
        const start = this.#peek().span.start;
        const type = this.#typeReference();
        const name = this.#expectIdentifier("for the parameter name");
        let defaultValue: Expression | undefined;
        if (this.#eatPunctuator("=")) defaultValue = this.#expression();
        parameters.push({
          kind: "parameterDeclaration",
          type,
          name,
          ...(defaultValue === undefined ? {} : { defaultValue }),
          span: { start, end: this.#previousEnd() },
        });
      } while (this.#eatPunctuator(","));
    }

    this.#expectPunctuator(")", "to close the parameter list");
    return parameters;
  }

  #typeReference(): TypeReference {
    const token = this.#peek();
    const start = token.span.start;

    if (token.kind !== "identifier" && !isTypeKeyword(token)) {
      this.#fail(
        XppErrorCodes.ExpectedDeclaration,
        `Expected a type, but found ${describe(token)}.`,
        "X++ declarations name the type first, then the variable — `int counter;`, `CustTable custTable;`.",
      );
    }

    const name = this.#next().text;
    this.#rejectOutOfSubsetType(name, { start, end: this.#previousEnd() });

    let length: number | undefined;
    // `str 30 name` — the length sits between the type and the name.
    if (name.toLowerCase() === "str" && this.#peek().kind === "intLiteral") {
      length = Number(this.#next().value);
    }

    return {
      kind: "typeReference",
      name,
      ...(length === undefined ? {} : { length }),
      span: { start, end: this.#previousEnd() },
    };
  }

  #rejectOutOfSubsetType(name: string, span: SourceSpan): void {
    const hint = REJECTED_TYPES[name.toLowerCase()];
    if (hint === undefined) return;
    this.#warn(
      XppErrorCodes.ConstructOutsideSubset,
      `'${name}' is not part of the X++ subset this simulator covers.`,
      span,
      hint,
    );
  }

  // -- statements ----------------------------------------------------------

  #block(): BlockStatement {
    const start = this.#peek().span.start;
    this.#expectPunctuator("{", "to open the block");
    const statements: Statement[] = [];

    while (!this.#isPunctuator("}") && !this.#atEnd()) {
      const before = this.#index;
      try {
        statements.push(this.#statement());
      } catch (error) {
        if (!(error instanceof BailOut)) throw error;
        this.#recover();
      }
      if (this.#index === before && !this.#atEnd()) this.#next();
    }

    this.#expectPunctuator("}", "to close the block");
    return { kind: "block", statements, span: { start, end: this.#previousEnd() } };
  }

  #statement(): Statement {
    const token = this.#peek();
    const start = token.span.start;

    if (token.kind === "punctuator") {
      if (token.punctuator === "{") return this.#block();
      if (token.punctuator === ";") {
        this.#next();
        return { kind: "emptyStatement", span: { start, end: this.#previousEnd() } };
      }
    }

    if (token.kind === "keyword") {
      switch (token.keyword) {
        case "if":
          return this.#ifStatement();
        case "while":
          return this.#isKeyword("select", 1) ? this.#whileSelect() : this.#whileStatement();
        case "do":
          return this.#doWhile();
        case "for":
          return this.#forStatement();
        case "switch":
          return this.#switchStatement();
        case "break":
          this.#next();
          this.#expectPunctuator(";", "after 'break'");
          return { kind: "break", span: { start, end: this.#previousEnd() } };
        case "continue":
          this.#next();
          this.#expectPunctuator(";", "after 'continue'");
          return { kind: "continue", span: { start, end: this.#previousEnd() } };
        case "retry":
          this.#next();
          this.#expectPunctuator(";", "after 'retry'");
          return { kind: "retry", span: { start, end: this.#previousEnd() } };
        case "return":
          return this.#returnStatement();
        case "throw":
          return this.#throwStatement();
        case "try":
          return this.#tryCatch();
        case "ttsbegin":
          this.#next();
          this.#expectPunctuator(";", "after 'ttsbegin'");
          return { kind: "ttsBegin", span: { start, end: this.#previousEnd() } };
        case "ttscommit":
          this.#next();
          this.#expectPunctuator(";", "after 'ttscommit'");
          return { kind: "ttsCommit", span: { start, end: this.#previousEnd() } };
        case "ttsabort":
          this.#next();
          this.#expectPunctuator(";", "after 'ttsabort'");
          return { kind: "ttsAbort", span: { start, end: this.#previousEnd() } };
        case "changecompany":
          return this.#changeCompany();
        case "next":
          return this.#nextCall();
        case "select":
          return this.#selectStatement();
        case "insert_recordset":
          return this.#insertRecordset();
        case "update_recordset":
          return this.#updateRecordset();
        case "delete_from":
          return this.#deleteFrom();
        default:
          break;
      }
    }

    if (this.#startsDeclaration()) return this.#variableDeclaration();

    const expression = this.#expression();
    this.#expectPunctuator(";", "after the statement");
    return {
      kind: "expressionStatement",
      expression,
      span: { start, end: this.#previousEnd() },
    };
  }

  /**
   * Distinguishes `CustTable custTable;` from `custTable.update();`.
   *
   * X++ has no `var`, so a declaration is always two names in a row, or a type keyword.
   * `str 30 name` puts a literal between them.
   */
  #startsDeclaration(): boolean {
    const token = this.#peek();
    if (isTypeKeyword(token)) return true;
    if (token.kind !== "identifier") return false;

    const second = this.#peek(1);
    if (second.kind === "identifier") return true;
    // `str 30 name` is handled by the type-keyword branch; an identifier type with a
    // length is not a thing.
    return false;
  }

  #variableDeclaration(): Statement {
    const start = this.#peek().span.start;
    const type = this.#typeReference();
    const declarators: VariableDeclarator[] = [];

    do {
      const declaratorStart = this.#peek().span.start;
      const name = this.#expectIdentifier("for the variable name");

      // `int values[10];` — an array bound belongs to the declarator, not the type.
      if (this.#eatPunctuator("[")) {
        const bound = this.#peek();
        if (bound.kind === "intLiteral") {
          this.#next();
          type.arrayBound = Number(bound.value);
        }
        this.#expectPunctuator("]", "to close the array bound");
      }

      let initializer: Expression | undefined;
      if (this.#eatPunctuator("=")) initializer = this.#expression();

      declarators.push({
        kind: "variableDeclarator",
        name,
        ...(initializer === undefined ? {} : { initializer }),
        span: { start: declaratorStart, end: this.#previousEnd() },
      });
    } while (this.#eatPunctuator(","));

    this.#expectPunctuator(";", "after the declaration");
    return {
      kind: "variableDeclaration",
      type,
      declarators,
      span: { start, end: this.#previousEnd() },
    };
  }

  #ifStatement(): Statement {
    const start = this.#next().span.start;
    this.#expectPunctuator("(", "after 'if'");
    const test = this.#expression();
    this.#expectPunctuator(")", "to close the 'if' condition");
    const consequent = this.#statement();
    let alternate: Statement | undefined;
    if (this.#eatKeyword("else")) alternate = this.#statement();
    return {
      kind: "if",
      test,
      consequent,
      ...(alternate === undefined ? {} : { alternate }),
      span: { start, end: this.#previousEnd() },
    };
  }

  #whileStatement(): Statement {
    const start = this.#next().span.start;
    this.#expectPunctuator("(", "after 'while'");
    const test = this.#expression();
    this.#expectPunctuator(")", "to close the 'while' condition");
    const body = this.#statement();
    return { kind: "while", test, body, span: { start, end: this.#previousEnd() } };
  }

  #doWhile(): Statement {
    const start = this.#next().span.start;
    const body = this.#statement();
    this.#expectKeyword("while", "after the 'do' body");
    this.#expectPunctuator("(", "after 'while'");
    const test = this.#expression();
    this.#expectPunctuator(")", "to close the 'while' condition");
    this.#expectPunctuator(";", "after 'do ... while (...)'");
    return { kind: "doWhile", body, test, span: { start, end: this.#previousEnd() } };
  }

  #forStatement(): Statement {
    const start = this.#next().span.start;
    this.#expectPunctuator("(", "after 'for'");

    let init: Expression | undefined;
    if (!this.#isPunctuator(";")) init = this.#expression();
    this.#expectPunctuator(";", "after the 'for' initialiser");

    let test: Expression | undefined;
    if (!this.#isPunctuator(";")) test = this.#expression();
    this.#expectPunctuator(";", "after the 'for' condition");

    let update: Expression | undefined;
    if (!this.#isPunctuator(")")) update = this.#expression();
    this.#expectPunctuator(")", "to close the 'for' header");

    const body = this.#statement();
    return {
      kind: "for",
      ...(init === undefined ? {} : { init }),
      ...(test === undefined ? {} : { test }),
      ...(update === undefined ? {} : { update }),
      body,
      span: { start, end: this.#previousEnd() },
    };
  }

  #switchStatement(): Statement {
    const start = this.#next().span.start;
    this.#expectPunctuator("(", "after 'switch'");
    const discriminant = this.#expression();
    this.#expectPunctuator(")", "to close the 'switch' expression");
    this.#expectPunctuator("{", "to open the 'switch' body");

    const cases: SwitchCase[] = [];
    while (!this.#isPunctuator("}") && !this.#atEnd()) {
      const caseStart = this.#peek().span.start;
      let tests: Expression[] | undefined;

      if (this.#eatKeyword("case")) {
        tests = [];
        // X++ allows `case 1, 2, 3:`.
        do {
          tests.push(this.#expression());
        } while (this.#eatPunctuator(","));
      } else {
        this.#expectKeyword("default", "to start a 'default' branch");
      }

      this.#expectPunctuator(":", "after the case label");

      const statements: Statement[] = [];
      while (
        !this.#isPunctuator("}") &&
        !this.#isKeyword("case") &&
        !this.#isKeyword("default") &&
        !this.#atEnd()
      ) {
        statements.push(this.#statement());
      }

      cases.push({
        kind: "switchCase",
        ...(tests === undefined ? {} : { tests }),
        statements,
        span: { start: caseStart, end: this.#previousEnd() },
      });
    }

    this.#expectPunctuator("}", "to close the 'switch' body");
    return { kind: "switch", discriminant, cases, span: { start, end: this.#previousEnd() } };
  }

  #returnStatement(): Statement {
    const start = this.#next().span.start;
    let argument: Expression | undefined;
    if (!this.#isPunctuator(";")) argument = this.#expression();
    this.#expectPunctuator(";", "after 'return'");
    return {
      kind: "return",
      ...(argument === undefined ? {} : { argument }),
      span: { start, end: this.#previousEnd() },
    };
  }

  #throwStatement(): Statement {
    const start = this.#next().span.start;
    const argument = this.#expression();
    this.#expectPunctuator(";", "after 'throw'");
    return { kind: "throw", argument, span: { start, end: this.#previousEnd() } };
  }

  #tryCatch(): Statement {
    const start = this.#next().span.start;
    const block = this.#block();
    const handlers: CatchClause[] = [];

    while (this.#isKeyword("catch")) {
      const catchStart = this.#next().span.start;
      let exception: Expression | undefined;
      if (this.#eatPunctuator("(")) {
        exception = this.#expression();
        this.#expectPunctuator(")", "to close the catch qualifier");
      }
      const body = this.#block();
      handlers.push({
        kind: "catchClause",
        ...(exception === undefined ? {} : { exception }),
        body,
        span: { start: catchStart, end: this.#previousEnd() },
      });
    }

    if (handlers.length === 0) {
      this.#warn(
        XppErrorCodes.ExpectedStatement,
        "A 'try' block needs at least one 'catch'.",
        { start, end: this.#previousEnd() },
        "Add `catch (Exception::Error) { ... }`, or `catch { ... }` to catch everything.",
      );
    }

    return { kind: "tryCatch", block, handlers, span: { start, end: this.#previousEnd() } };
  }

  /** `next insert();` — continue down the Chain of Command. */
  #nextCall(): Statement {
    const start = this.#next().span.start;
    const methodName = this.#memberName();
    const args = this.#argumentList();
    this.#expectPunctuator(";", "after the 'next' call");
    return {
      kind: "nextCall",
      methodName,
      arguments: args,
      span: { start, end: this.#previousEnd() },
    };
  }

  #changeCompany(): Statement {
    const start = this.#next().span.start;
    this.#expectPunctuator("(", "after 'changecompany'");
    const company = this.#expression();
    this.#expectPunctuator(")", "to close the 'changecompany' company");
    const body = this.#statement();
    return { kind: "changeCompany", company, body, span: { start, end: this.#previousEnd() } };
  }

  // -- select and DML ------------------------------------------------------

  #selectStatement(): Statement {
    const start = this.#peek().span.start;
    const clauses = this.#selectClauses();
    this.#expectPunctuator(";", "after the select statement");
    return { kind: "select", clauses, span: { start, end: this.#previousEnd() } };
  }

  #whileSelect(): Statement {
    const start = this.#next().span.start;
    const clauses = this.#selectClauses();
    const body = this.#statement();
    return { kind: "whileSelect", clauses, body, span: { start, end: this.#previousEnd() } };
  }

  /**
   * The clause bundle shared by `select`, `while select` and the set-based statements.
   *
   * X++ lets the field list, the `from` and the buffer appear in several arrangements:
   *   select custTable
   *   select * from custTable
   *   select AccountNum, CreditMax from custTable
   *   select sum(AmountMST) from custTrans
   */
  #selectClauses(consumeSelect = true): SelectClauses {
    const start = this.#peek().span.start;
    if (consumeSelect) this.#expectKeyword("select", "to start a select statement");

    const modifiers = this.#selectModifiers();
    const fieldList = this.#selectFieldList();

    this.#eatKeyword("from");
    const bufferStart = this.#peek().span.start;
    const buffer = this.#expectIdentifier("for the table buffer to select into");

    const joins: SelectJoin[] = [];
    const source: SelectSource = {
      kind: "selectSource",
      buffer,
      ...(fieldList === undefined ? {} : { fieldList }),
      joins,
      span: { start: bufferStart, end: this.#previousEnd() },
    };

    let where: Expression | undefined;
    if (this.#eatKeyword("where")) where = this.#expression();

    // Joins come after the outer where in X++ source order, and each may carry its own.
    while (this.#startsJoin()) {
      joins.push(this.#selectJoin());
    }

    const orderBy = this.#orderByClause();

    return {
      kind: "selectClauses",
      modifiers,
      source,
      ...(where === undefined ? {} : { where }),
      ...(orderBy === undefined ? {} : { orderBy }),
      span: { start, end: this.#previousEnd() },
    };
  }

  #selectModifiers(): SelectModifier[] {
    const modifiers: SelectModifier[] = [];

    for (;;) {
      const token = this.#peek();

      // An out-of-subset hint is real X++, so it earns a named rejection rather than
      // "unexpected identifier".
      if (token.kind === "identifier") {
        const hint = REJECTED_SELECT_MODIFIERS[token.text.toLowerCase()];
        if (hint !== undefined) {
          this.#warn(
            XppErrorCodes.ConstructOutsideSubset,
            `'${token.text}' is not part of the X++ subset this simulator covers.`,
            token.span,
            hint,
          );
          this.#next();
          continue;
        }
      }

      if (token.kind !== "keyword" || !isSelectModifier(token.keyword)) break;
      modifiers.push(this.#next().keyword as SelectModifier);
    }

    return modifiers;
  }

  #selectFieldList(): SelectFieldList | undefined {
    const start = this.#peek().span.start;

    if (this.#isPunctuator("*")) {
      this.#next();
      return {
        kind: "selectFieldList",
        all: true,
        fields: [],
        span: { start, end: this.#previousEnd() },
      };
    }

    // A field list only exists when `from` follows it. `select custTable` has none, and
    // `select AccountNum from custTable` does — look ahead for the `from`.
    if (!this.#looksLikeFieldList()) return undefined;

    const fields: SelectField[] = [];
    do {
      fields.push(this.#selectField());
    } while (this.#eatPunctuator(","));

    return {
      kind: "selectFieldList",
      all: false,
      fields,
      span: { start, end: this.#previousEnd() },
    };
  }

  #looksLikeFieldList(): boolean {
    let ahead = 0;
    // Walk names, aggregates and commas until something else turns up.
    for (;;) {
      const token = this.#peek(ahead);
      if (token.kind === "keyword" && isAggregate(token.keyword)) {
        // sum ( name )
        if (!this.#isPunctuator("(", ahead + 1)) return false;
        ahead += 3;
        if (!this.#isPunctuator(")", ahead)) return false;
        ahead += 1;
      } else if (token.kind === "identifier") {
        ahead += 1;
      } else {
        return false;
      }

      if (this.#isPunctuator(",", ahead)) {
        ahead += 1;
        continue;
      }
      return this.#isKeyword("from", ahead);
    }
  }

  #selectField(): SelectField {
    const start = this.#peek().span.start;
    const token = this.#peek();

    if (token.kind === "keyword" && isAggregate(token.keyword)) {
      const aggregate = this.#next().keyword!;
      this.#expectPunctuator("(", `after '${aggregate}'`);
      const name = this.#expectIdentifier(`for the field to ${aggregate}`);
      this.#expectPunctuator(")", `to close '${aggregate}'`);
      return {
        kind: "selectField",
        name,
        aggregate: aggregate as SelectField["aggregate"],
        span: { start, end: this.#previousEnd() },
      };
    }

    const name = this.#expectIdentifier("for a field in the select list");
    return { kind: "selectField", name, span: { start, end: this.#previousEnd() } };
  }

  #startsJoin(): boolean {
    if (this.#isKeyword("join")) return true;
    if (this.#isKeyword("outer") || this.#isKeyword("exists") || this.#isKeyword("notexists")) {
      return this.#isKeyword("join", 1);
    }
    return false;
  }

  #selectJoin(): SelectJoin {
    const start = this.#peek().span.start;

    let joinKind: SelectJoin["joinKind"] = "inner";
    if (this.#eatKeyword("outer")) joinKind = "outer";
    else if (this.#eatKeyword("exists")) joinKind = "exists";
    else if (this.#eatKeyword("notexists")) joinKind = "notexists";

    this.#expectKeyword("join", "to start the join");

    const fieldList = this.#selectFieldList();
    this.#eatKeyword("from");

    const bufferStart = this.#peek().span.start;
    const buffer = this.#expectIdentifier("for the joined table buffer");

    const source: SelectSource = {
      kind: "selectSource",
      buffer,
      ...(fieldList === undefined ? {} : { fieldList }),
      joins: [],
      span: { start: bufferStart, end: this.#previousEnd() },
    };

    let on: Expression | undefined;
    if (this.#eatKeyword("where")) on = this.#expression();

    return {
      kind: "selectJoin",
      joinKind,
      source,
      ...(on === undefined ? {} : { on }),
      span: { start, end: this.#previousEnd() },
    };
  }

  #orderByClause(): OrderByClause | undefined {
    const grouping = this.#isKeyword("group");
    if (!grouping && !this.#isKeyword("order")) return undefined;

    const start = this.#next().span.start;
    this.#expectKeyword("by", grouping ? "after 'group'" : "after 'order'");

    const entries: OrderByEntry[] = [];
    do {
      const entryStart = this.#peek().span.start;
      let field = this.#expectIdentifier("for the field to sort by");
      // `order by custTrans.TransDate` — the buffer prefix is noise here, the field is
      // what matters.
      if (this.#eatPunctuator(".")) field = this.#expectIdentifier("for the field name");

      let direction: "asc" | "desc" = "asc";
      if (this.#eatKeyword("desc")) direction = "desc";
      else this.#eatKeyword("asc");

      entries.push({
        kind: "orderByEntry",
        field,
        direction,
        span: { start: entryStart, end: this.#previousEnd() },
      });
    } while (this.#eatPunctuator(","));

    return {
      kind: "orderBy",
      entries,
      grouping,
      span: { start, end: this.#previousEnd() },
    };
  }

  #insertRecordset(): Statement {
    const start = this.#next().span.start;
    const targetBuffer = this.#expectIdentifier("for the table to insert into");

    const targetFields: string[] = [];
    this.#expectPunctuator("(", "to list the fields being inserted");
    do {
      targetFields.push(this.#expectIdentifier("for a target field"));
    } while (this.#eatPunctuator(","));
    this.#expectPunctuator(")", "to close the target field list");

    const source = this.#selectClauses();
    this.#expectPunctuator(";", "after the insert_recordset statement");

    return {
      kind: "insertRecordset",
      targetBuffer,
      targetFields,
      source,
      span: { start, end: this.#previousEnd() },
    };
  }

  #updateRecordset(): Statement {
    const start = this.#next().span.start;
    const bufferStart = this.#peek().span.start;
    const buffer = this.#expectIdentifier("for the table to update");

    this.#expectKeyword("setting", "after the table name");

    const assignments: FieldAssignment[] = [];
    do {
      const assignStart = this.#peek().span.start;
      const field = this.#expectIdentifier("for the field being set");
      this.#expectPunctuator("=", `after '${field}'`);
      const value = this.#expression();
      assignments.push({
        kind: "fieldAssignment",
        field,
        value,
        span: { start: assignStart, end: this.#previousEnd() },
      });
    } while (this.#eatPunctuator(","));

    let where: Expression | undefined;
    if (this.#eatKeyword("where")) where = this.#expression();
    this.#expectPunctuator(";", "after the update_recordset statement");

    const clauses: SelectClauses = {
      kind: "selectClauses",
      modifiers: [],
      source: {
        kind: "selectSource",
        buffer,
        joins: [],
        span: { start: bufferStart, end: this.#previousEnd() },
      },
      ...(where === undefined ? {} : { where }),
      span: { start, end: this.#previousEnd() },
    };

    return {
      kind: "updateRecordset",
      clauses,
      assignments,
      span: { start, end: this.#previousEnd() },
    };
  }

  #deleteFrom(): Statement {
    const start = this.#next().span.start;
    const bufferStart = this.#peek().span.start;
    const buffer = this.#expectIdentifier("for the table to delete from");

    let where: Expression | undefined;
    if (this.#eatKeyword("where")) where = this.#expression();
    this.#expectPunctuator(";", "after the delete_from statement");

    const clauses: SelectClauses = {
      kind: "selectClauses",
      modifiers: [],
      source: {
        kind: "selectSource",
        buffer,
        joins: [],
        span: { start: bufferStart, end: this.#previousEnd() },
      },
      ...(where === undefined ? {} : { where }),
      span: { start, end: this.#previousEnd() },
    };

    return { kind: "deleteFrom", clauses, span: { start, end: this.#previousEnd() } };
  }

  // -- expressions ---------------------------------------------------------

  #expression(): Expression {
    return this.#assignment();
  }

  #assignment(): Expression {
    const left = this.#conditional();
    const token = this.#peek();

    if (token.kind === "punctuator" && isAssignmentOperator(token.punctuator)) {
      const operator = this.#next().punctuator!;
      // Assignment is right-associative.
      const value = this.#assignment();
      return {
        kind: "assignment",
        operator: operator as "=" | "+=" | "-=" | "*=" | "/=",
        target: left,
        value,
        span: { start: left.span.start, end: value.span.end },
      };
    }

    return left;
  }

  #conditional(): Expression {
    const test = this.#binary(LOWEST_BINARY_PRECEDENCE);
    if (!this.#eatPunctuator("?")) return test;

    const consequent = this.#assignment();
    this.#expectPunctuator(":", "in the conditional expression");
    const alternate = this.#assignment();

    return {
      kind: "conditional",
      test,
      consequent,
      alternate,
      span: { start: test.span.start, end: alternate.span.end },
    };
  }

  /**
   * Precedence climbing over BINARY_PRECEDENCE. All X++ binary operators are
   * left-associative, including `&&` and `||` against each other (VB-005).
   */
  #binary(minimumPrecedence: number): Expression {
    let left = this.#unary();

    for (;;) {
      const token = this.#peek();
      const operator = binaryOperatorOf(token);
      if (operator === undefined) break;

      const precedence = BINARY_PRECEDENCE[operator]!;
      if (precedence < minimumPrecedence) break;

      this.#next();
      const right = this.#binary(precedence + 1);
      left = {
        kind: "binary",
        operator: operator as BinaryOperator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }

    return left;
  }

  #unary(): Expression {
    const token = this.#peek();
    const start = token.span.start;

    if (
      (token.kind === "punctuator" && ["-", "+", "!", "~"].includes(token.punctuator ?? "")) ||
      (token.kind === "keyword" && token.keyword === "not")
    ) {
      const operator = this.#next();
      const argument = this.#unary();
      return {
        kind: "unary",
        operator: (operator.punctuator ?? operator.keyword) as "-" | "+" | "!" | "~" | "not",
        argument,
        span: { start, end: argument.span.end },
      };
    }

    if (this.#isPunctuator("++") || this.#isPunctuator("--")) {
      const operator = this.#next().punctuator as "++" | "--";
      const argument = this.#unary();
      return {
        kind: "update",
        operator,
        prefix: true,
        argument,
        span: { start, end: argument.span.end },
      };
    }

    return this.#postfix();
  }

  #postfix(): Expression {
    let expression = this.#primary();

    for (;;) {
      if (this.#isPunctuator(".")) {
        this.#next();
        // Method and field names can collide with keywords — `custTable.insert()`.
        const member = this.#memberName();
        expression = {
          kind: "memberAccess",
          object: expression,
          member,
          span: { start: expression.span.start, end: this.#previousEnd() },
        };
        continue;
      }

      if (this.#isPunctuator("(")) {
        const args = this.#argumentList();
        expression = {
          kind: "call",
          callee: expression,
          arguments: args,
          span: { start: expression.span.start, end: this.#previousEnd() },
        };
        continue;
      }

      if (this.#isPunctuator("[")) {
        this.#next();
        const index = this.#expression();
        this.#expectPunctuator("]", "to close the index");
        expression = {
          kind: "index",
          object: expression,
          index,
          span: { start: expression.span.start, end: this.#previousEnd() },
        };
        continue;
      }

      if (this.#isPunctuator("++") || this.#isPunctuator("--")) {
        const operator = this.#next().punctuator as "++" | "--";
        expression = {
          kind: "update",
          operator,
          prefix: false,
          argument: expression,
          span: { start: expression.span.start, end: this.#previousEnd() },
        };
        continue;
      }

      return expression;
    }
  }

  #memberName(): string {
    const token = this.#peek();
    if (token.kind === "identifier" || token.kind === "keyword") {
      this.#next();
      return token.text;
    }
    this.#fail(
      XppErrorCodes.ExpectedToken,
      `Expected a field or method name after '.', but found ${describe(token)}.`,
    );
  }

  #argumentList(): Expression[] {
    this.#expectPunctuator("(", "to open the argument list");
    const args: Expression[] = [];
    if (!this.#isPunctuator(")")) {
      do {
        args.push(this.#expression());
      } while (this.#eatPunctuator(","));
    }
    this.#expectPunctuator(")", "to close the argument list");
    return args;
  }

  #primary(): Expression {
    const token = this.#peek();
    const start = token.span.start;

    switch (token.kind) {
      case "intLiteral":
      case "realLiteral":
      case "strLiteral":
      case "dateLiteral": {
        this.#next();
        return {
          kind: "literal",
          literalType: literalTypeOf(token.kind),
          value: token.value ?? null,
          raw: token.text,
          span: { start, end: this.#previousEnd() },
        };
      }

      case "identifier": {
        this.#next();
        // `NoYes::Yes`
        if (this.#eatPunctuator("::")) {
          const valueName = this.#memberName();
          this.#rejectOutOfSubsetType(token.text, { start, end: this.#previousEnd() });
          return {
            kind: "enumAccess",
            enumName: token.text,
            valueName,
            span: { start, end: this.#previousEnd() },
          };
        }
        return { kind: "identifier", name: token.text, span: { start, end: this.#previousEnd() } };
      }

      case "keyword":
        return this.#keywordPrimary(token, start);

      case "punctuator": {
        if (token.punctuator === "(") {
          this.#next();
          const inner = this.#expression();
          this.#expectPunctuator(")", "to close the parenthesised expression");
          return inner;
        }
        if (token.punctuator === "[") {
          this.#next();
          const elements: Expression[] = [];
          if (!this.#isPunctuator("]")) {
            do {
              elements.push(this.#expression());
            } while (this.#eatPunctuator(","));
          }
          this.#expectPunctuator("]", "to close the container literal");
          return { kind: "container", elements, span: { start, end: this.#previousEnd() } };
        }
        break;
      }

      default:
        break;
    }

    this.#fail(
      XppErrorCodes.ExpectedExpression,
      `Expected an expression, but found ${describe(token)}.`,
      "Something is missing here — a value, a variable, or a call.",
    );
  }

  #keywordPrimary(token: Token, start: SourcePosition): Expression {
    switch (token.keyword) {
      case "true":
      case "false":
        this.#next();
        return {
          kind: "literal",
          literalType: "boolean",
          value: token.keyword === "true",
          raw: token.text,
          span: { start, end: this.#previousEnd() },
        };

      case "null":
        this.#next();
        return {
          kind: "literal",
          literalType: "null",
          value: null,
          raw: token.text,
          span: { start, end: this.#previousEnd() },
        };

      case "new": {
        this.#next();
        const className = this.#expectIdentifier("for the class being constructed");
        this.#rejectOutOfSubsetType(className, { start, end: this.#previousEnd() });
        const args = this.#argumentList();
        return {
          kind: "new",
          className,
          arguments: args,
          span: { start, end: this.#previousEnd() },
        };
      }

      case "this":
      case "super":
        this.#next();
        return { kind: "identifier", name: token.text, span: { start, end: this.#previousEnd() } };

      default:
        break;
    }

    // `next insert();` inside a Chain of Command wrapper. `next` is not reserved, so it
    // arrives as an identifier — this branch only catches genuine keyword misuse.
    this.#fail(
      XppErrorCodes.ExpectedExpression,
      `Expected an expression, but found the keyword '${token.text}'.`,
      `'${token.text}' starts a statement, so it cannot be used as a value here.`,
    );
  }

  #previousEnd(): SourcePosition {
    return this.#tokens[Math.max(0, this.#index - 1)]!.span.end;
  }
}

// ---------------------------------------------------------------------------
// Token classification
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS = new Set<string>([
  "anytype",
  "boolean",
  "container",
  "date",
  "guid",
  "int",
  "int64",
  "real",
  "str",
  "timeofday",
  "utcdatetime",
  "void",
  "enum",
]);

const MEMBER_MODIFIERS = new Set<string>([
  "public",
  "protected",
  "private",
  "static",
  "final",
  "abstract",
]);

const SELECT_MODIFIERS = new Set<string>([
  "crosscompany",
  "firstonly",
  "firstonly10",
  "firstonly100",
  "firstonly1000",
  "forupdate",
  "reverse",
]);

const AGGREGATES = new Set<string>(["avg", "count", "maxof", "minof", "sum"]);

function isTypeKeyword(token: Token): boolean {
  return token.kind === "keyword" && TYPE_KEYWORDS.has(token.keyword ?? "");
}

function isMemberModifier(token: Token): boolean {
  return token.kind === "keyword" && MEMBER_MODIFIERS.has(token.keyword ?? "");
}

function isSelectModifier(keyword: string | undefined): boolean {
  return keyword !== undefined && SELECT_MODIFIERS.has(keyword);
}

function isAggregate(keyword: string | undefined): boolean {
  return keyword !== undefined && AGGREGATES.has(keyword);
}

function isAssignmentOperator(symbol: string | undefined): boolean {
  return symbol !== undefined && ["=", "+=", "-=", "*=", "/="].includes(symbol);
}

function binaryOperatorOf(token: Token): string | undefined {
  if (token.kind === "punctuator" && BINARY_PRECEDENCE[token.punctuator ?? ""] !== undefined) {
    return token.punctuator;
  }
  if (token.kind === "keyword" && BINARY_PRECEDENCE[token.keyword ?? ""] !== undefined) {
    return token.keyword;
  }
  return undefined;
}

function literalTypeOf(kind: Token["kind"]): "int" | "real" | "str" | "date" {
  switch (kind) {
    case "intLiteral":
      return "int";
    case "realLiteral":
      return "real";
    case "dateLiteral":
      return "date";
    default:
      return "str";
  }
}

/** How a token is named in an error message. */
function describe(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "the end of the code";
    case "strLiteral":
      return `the text ${JSON.stringify(token.value ?? "")}`;
    case "intLiteral":
    case "realLiteral":
      return `the number ${token.text}`;
    case "dateLiteral":
      return `the date ${token.text}`;
    case "keyword":
      return `the keyword '${token.text}'`;
    default:
      return `'${token.text}'`;
  }
}

function hintForMissing(symbol: string, context: string): string | undefined {
  if (symbol === ";") {
    return "Every X++ statement ends with a semicolon — including the last one in a block.";
  }
  if (symbol === ")" || symbol === "]" || symbol === "}") {
    return `Something opened earlier is never closed. Check the ${context.replace(/^to close (the )?/, "")}.`;
  }
  return undefined;
}
