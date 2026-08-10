/**
 * The tokenizer.
 *
 * Hand-written, single pass, maximal munch. It never throws and never gives up: an
 * unrecognised character produces an error and the scan resumes at the next one, so the
 * parser still receives a usable stream and a learner sees more than one problem per run.
 */

import { XppErrorCodes, createError, type SourcePosition, type XppError } from "@xpplab/xpp-core";
import {
  XPP_PUNCTUATORS,
  isKeyword,
  type LexResult,
  type LexerOptions,
  type Token,
  type TriviaKind,
  type XppKeyword,
  type XppPunctuator,
} from "./index";

export function tokenize(source: string, options: LexerOptions = {}): LexResult {
  return new Lexer(source, options).run();
}

class Lexer {
  readonly #source: string;
  readonly #includeTrivia: boolean;
  readonly #tokens: Token[] = [];
  readonly #errors: XppError[] = [];

  #offset = 0;
  #line = 1;
  #column = 1;

  constructor(source: string, options: LexerOptions) {
    this.#source = source;
    this.#includeTrivia = options.includeTrivia ?? false;
  }

  run(): LexResult {
    while (this.#offset < this.#source.length) {
      this.#scan();
    }
    const end = this.#position();
    this.#tokens.push({ kind: "eof", text: "", span: { start: end, end } });
    return { tokens: this.#tokens, errors: this.#errors };
  }

  // -- cursor --------------------------------------------------------------

  #position(): SourcePosition {
    return { line: this.#line, column: this.#column, offset: this.#offset };
  }

  #peek(ahead = 0): string {
    return this.#source[this.#offset + ahead] ?? "";
  }

  #advance(count = 1): void {
    for (let i = 0; i < count && this.#offset < this.#source.length; i++) {
      if (this.#source[this.#offset] === "\n") {
        this.#line += 1;
        this.#column = 1;
      } else {
        this.#column += 1;
      }
      this.#offset += 1;
    }
  }

  #emit(
    kind: Token["kind"],
    start: SourcePosition,
    extra: Omit<Partial<Token>, "kind" | "text" | "span"> = {},
  ): void {
    const token: Token = {
      kind,
      text: this.#source.slice(start.offset, this.#offset),
      span: { start, end: this.#position() },
      ...extra,
    };
    if (kind === "trivia" && !this.#includeTrivia) return;
    this.#tokens.push(token);
  }

  // -- scanning ------------------------------------------------------------

  #scan(): void {
    const start = this.#position();
    const char = this.#peek();

    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      while (/[ \t\r\n]/.test(this.#peek())) this.#advance();
      this.#emit("trivia", start, { trivia: "whitespace" });
      return;
    }

    if (char === "/" && this.#peek(1) === "/") {
      while (this.#offset < this.#source.length && this.#peek() !== "\n") this.#advance();
      this.#emit("trivia", start, { trivia: "lineComment" });
      return;
    }

    if (char === "/" && this.#peek(1) === "*") {
      this.#blockComment(start);
      return;
    }

    if (char === '"' || char === "'") {
      this.#stringLiteral(start, char);
      return;
    }

    if (isDigit(char)) {
      this.#numericOrDate(start);
      return;
    }

    if (isIdentifierStart(char)) {
      this.#identifierOrKeyword(start);
      return;
    }

    // Macros are out of subset, and `#` would otherwise be a bare unexpected character.
    // A learner who pastes real F&O code hits this constantly, so it is worth naming the
    // construct and saying why rather than pointing at a symbol.
    if (char === "#") {
      while (this.#offset < this.#source.length && this.#peek() !== "\n") this.#advance();
      this.#errors.push(
        createError(
          XppErrorCodes.ConstructOutsideSubset,
          "Macros and preprocessor directives are not supported.",
          { start, end: this.#position() },
          "This simulator has no preprocessor. Replace the macro with a `const` or write the value inline — see the language subset for what is covered.",
        ),
      );
      this.#emit("trivia", start, { trivia: "lineComment" });
      return;
    }

    if (this.#punctuator(start)) return;

    // Nothing matched. Report it and step over the character so the scan continues —
    // one stray `@` should not cost the learner every later diagnostic.
    this.#advance();
    this.#errors.push(
      createError(
        XppErrorCodes.UnexpectedCharacter,
        `Unexpected character '${char}'.`,
        { start, end: this.#position() },
        "X++ has no operator spelled like this. Check for a stray key press, or a symbol copied from another language.",
      ),
    );
  }

  #blockComment(start: SourcePosition): void {
    this.#advance(2);
    while (this.#offset < this.#source.length) {
      if (this.#peek() === "*" && this.#peek(1) === "/") {
        this.#advance(2);
        this.#emit("trivia", start, { trivia: "blockComment" });
        return;
      }
      this.#advance();
    }
    this.#errors.push(
      createError(
        XppErrorCodes.UnterminatedComment,
        "Unterminated block comment.",
        { start, end: this.#position() },
        "This `/*` is never closed. Add `*/` where the comment should end — everything after it has been swallowed.",
      ),
    );
    this.#emit("trivia", start, { trivia: "blockComment" });
  }

  #stringLiteral(start: SourcePosition, quote: string): void {
    this.#advance();
    let value = "";

    while (this.#offset < this.#source.length) {
      const char = this.#peek();

      // A newline before the closing quote is a missing quote, not a multi-line string.
      // Reporting it here points at the opening quote rather than at whatever the
      // parser chokes on three lines later.
      if (char === "\n") break;

      if (char === "\\") {
        const escaped = this.#peek(1);
        // X++ uses `\\` for path separators and `\"` inside strings. Anything else is
        // kept verbatim, which is what the real compiler does.
        value += escaped === "\\" || escaped === quote ? escaped : `\\${escaped}`;
        this.#advance(2);
        continue;
      }

      if (char === quote) {
        this.#advance();
        this.#emit("strLiteral", start, { value });
        return;
      }

      value += char;
      this.#advance();
    }

    this.#errors.push(
      createError(
        XppErrorCodes.UnterminatedString,
        "Unterminated string literal.",
        { start, end: this.#position() },
        `This string opens with ${quote} but never closes. X++ strings cannot span lines.`,
      ),
    );
    this.#emit("strLiteral", start, { value });
  }

  /**
   * Numbers and date literals share a prefix. `31\12\2026` is a date; `12.34` is a real;
   * `42` is an int.
   */
  #numericOrDate(start: SourcePosition): void {
    while (isDigit(this.#peek())) this.#advance();

    if (this.#peek() === "\\") {
      this.#dateLiteral(start);
      return;
    }

    let isReal = false;
    if (this.#peek() === "." && isDigit(this.#peek(1))) {
      isReal = true;
      this.#advance();
      while (isDigit(this.#peek())) this.#advance();
    }

    // A second decimal point is a typo, not a new token. Consume it so the parser is not
    // handed `12.34` `.56` and forced to invent an explanation.
    if (this.#peek() === "." && isDigit(this.#peek(1))) {
      const errorStart = this.#position();
      this.#advance();
      while (isDigit(this.#peek())) this.#advance();
      this.#errors.push(
        createError(
          XppErrorCodes.InvalidNumericLiteral,
          "A number cannot contain more than one decimal point.",
          { start: errorStart, end: this.#position() },
          "Remove the extra `.`. If you meant a date, X++ writes those as `31\\12\\2026`.",
        ),
      );
      this.#emit("realLiteral", start, { value: Number.NaN });
      return;
    }

    const text = this.#source.slice(start.offset, this.#offset);
    this.#emit(isReal ? "realLiteral" : "intLiteral", start, { value: Number(text) });
  }

  /**
   * `31\12\2026`.
   *
   * The component order is not confirmed against a real compiler, so the token keeps the
   * literal text as its value and Phase 3 decides what it means. See docs/unverified.md.
   */
  #dateLiteral(start: SourcePosition): void {
    this.#advance();
    while (isDigit(this.#peek())) this.#advance();
    if (this.#peek() === "\\") {
      this.#advance();
      while (isDigit(this.#peek())) this.#advance();
    }
    this.#emit("dateLiteral", start, {
      value: this.#source.slice(start.offset, this.#offset),
    });
  }

  #identifierOrKeyword(start: SourcePosition): void {
    while (isIdentifierPart(this.#peek())) this.#advance();
    const text = this.#source.slice(start.offset, this.#offset);
    const lowered = text.toLowerCase();

    if (isKeyword(lowered)) {
      this.#emit("keyword", start, { keyword: lowered as XppKeyword });
      return;
    }
    this.#emit("identifier", start, {});
  }

  #punctuator(start: SourcePosition): boolean {
    for (const candidate of XPP_PUNCTUATORS) {
      if (this.#source.startsWith(candidate, this.#offset)) {
        this.#advance(candidate.length);
        this.#emit("punctuator", start, { punctuator: candidate as XppPunctuator });
        return true;
      }
    }
    return false;
  }
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

export type { TriviaKind };
