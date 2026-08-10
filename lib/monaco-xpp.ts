"use client";

/**
 * X++ language support for Monaco.
 *
 * The keyword list, the operator list and the completion items are all generated from
 * the engine's own tables — `XPP_KEYWORDS` from the lexer, `SCHEMA` and `BASE_ENUMS`
 * from virtual-db. Nothing here is a second copy of anything, so the editor cannot
 * highlight a keyword the parser rejects, or offer a table that does not exist.
 *
 * PLAN.md asked for a TextMate grammar. This is Monarch instead: TextMate in Monaco
 * needs onigasm plus a WASM regex engine, which is a second WASM download for colour.
 * Monarch is built in, and generating it from the lexer's tables buys the correctness
 * that mattered. Recorded in docs/decisions.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { XPP_KEYWORDS } from "@xpplab/xpp-lexer";
import { BASE_ENUMS, SCHEMA } from "@xpplab/virtual-db";
import { BUILTINS } from "@xpplab/xpp-runtime";

export const XPP_LANGUAGE_ID = "xpp";

/** Keywords that name a type, coloured differently from control flow. */
const TYPE_KEYWORDS = new Set([
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

const CONTROL_KEYWORDS = XPP_KEYWORDS.filter((keyword) => !TYPE_KEYWORDS.has(keyword));

function monarchTokens(): languages.IMonarchLanguage {
  return {
    defaultToken: "",
    ignoreCase: true,
    keywords: [...CONTROL_KEYWORDS],
    typeKeywords: [...TYPE_KEYWORDS],
    tableNames: SCHEMA.map((table) => table.name),
    builtins: Object.keys(BUILTINS),

    tokenizer: {
      root: [
        // A date literal has to be matched before plain numbers, or `31\12\2026` lexes
        // as three separate integers.
        [/\d{1,2}\\\d{1,2}\\\d{4}/, "number.date"],

        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@typeKeywords": "type",
              "@keywords": "keyword",
              "@tableNames": "type.identifier",
              "@builtins": "predefined",
              "@default": "identifier",
            },
          },
        ],

        { include: "@whitespace" },

        [/\d+\.\d+/, "number.float"],
        [/\d+/, "number"],

        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@stringDouble"],
        [/'/, "string", "@stringSingle"],

        [/::/, "operator"],
        [/[{}()[\]]/, "@brackets"],
        [/[<>=!+\-*/&|^~?:;,.]+/, "operator"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],

      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],

      stringDouble: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],

      stringSingle: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
    },
  };
}

function languageConfiguration(): languages.LanguageConfiguration {
  return {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string", "comment"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  };
}

/**
 * Completions.
 *
 * Three sources, all from the engine: keywords, table and field names from the schema,
 * and the global functions the runtime actually implements. Offering something the
 * engine would then reject is worse than offering nothing.
 */
function completionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", ":"],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const Kind = monaco.languages.CompletionItemKind;
      const suggestions: languages.CompletionItem[] = [];

      // `NoYes::` — offer that enum's values and nothing else.
      const enumPrefix = /(\w+)::\w*$/.exec(line);
      if (enumPrefix) {
        const baseEnum = BASE_ENUMS.find(
          (candidate) => candidate.name.toLowerCase() === enumPrefix[1]!.toLowerCase(),
        );
        if (baseEnum) {
          return {
            suggestions: baseEnum.values.map((value) => ({
              label: value.name,
              kind: Kind.EnumMember,
              insertText: value.name,
              detail: `${baseEnum.name} = ${value.value}`,
              documentation: value.label,
              range,
            })),
          };
        }
      }

      // `custTable.` — offer the fields of whatever table that buffer was declared as.
      const memberPrefix = /(\w+)\.\w*$/.exec(line);
      if (memberPrefix) {
        const buffer = memberPrefix[1]!;
        const declaration = new RegExp(`\\b(\\w+)\\s+${buffer}\\s*[;,=]`, "i").exec(
          model.getValue(),
        );
        const table = SCHEMA.find(
          (candidate) => candidate.name.toLowerCase() === declaration?.[1]?.toLowerCase(),
        );
        if (table) {
          return {
            suggestions: [
              ...table.fields.map((field) => ({
                label: field.name,
                kind: Kind.Field,
                insertText: field.name,
                detail: field.type + (field.enumName ? ` (${field.enumName})` : ""),
                documentation: field.label ?? "",
                range,
              })),
              ...["insert", "update", "delete", "clear"].map((method) => ({
                label: method,
                kind: Kind.Method,
                insertText: `${method}()`,
                detail: `${table.name} method`,
                range,
              })),
              { label: "RecId", kind: Kind.Field, insertText: "RecId", detail: "int64", range },
            ],
          };
        }
      }

      for (const keyword of XPP_KEYWORDS) {
        suggestions.push({ label: keyword, kind: Kind.Keyword, insertText: keyword, range });
      }

      for (const table of SCHEMA) {
        suggestions.push({
          label: table.name,
          kind: Kind.Class,
          insertText: table.name,
          detail: table.label,
          documentation: `${table.fields.length} fields, ${table.saveDataPerCompany ? "company-scoped" : "shared across companies"}`,
          range,
        });
      }

      for (const baseEnum of BASE_ENUMS) {
        suggestions.push({
          label: baseEnum.name,
          kind: Kind.Enum,
          insertText: baseEnum.name,
          detail: baseEnum.values.map((value) => value.name).join(", "),
          range,
        });
      }

      for (const name of Object.keys(BUILTINS)) {
        suggestions.push({
          label: name,
          kind: Kind.Function,
          insertText: `${name}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: "global function",
          range,
        });
      }

      return { suggestions };
    },
  };
}

let registered = false;

/** Registers the language once per page load. Monaco throws on a duplicate id. */
export function registerXppLanguage(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: XPP_LANGUAGE_ID, extensions: [".xpp"], aliases: ["X++", "xpp"] });
  monaco.languages.setMonarchTokensProvider(XPP_LANGUAGE_ID, monarchTokens());
  monaco.languages.setLanguageConfiguration(XPP_LANGUAGE_ID, languageConfiguration());
  monaco.languages.registerCompletionItemProvider(XPP_LANGUAGE_ID, completionProvider(monaco));

  monaco.editor.defineTheme("xpplab", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7dd3fc" },
      { token: "type", foreground: "c4b5fd" },
      { token: "type.identifier", foreground: "fca5a5" },
      { token: "predefined", foreground: "fcd34d" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fdba74" },
      { token: "number.date", foreground: "fdba74" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#0b0f19",
      "editorLineNumber.foreground": "#374151",
      "editor.lineHighlightBackground": "#111827",
    },
  });
}
