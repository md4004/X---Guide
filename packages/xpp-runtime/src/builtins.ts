/**
 * Global functions.
 *
 * Exactly the list in docs/language-subset.md, no more. An unknown global is an error
 * with a "did you mean" hint rather than a silent undefined — a learner who types
 * `strFmt` as `strfmt` should be told, and one who types `FORMAT` (a C/AL habit) should
 * be pointed at `strFmt`.
 */

import { XppErrorCodes } from "@xpplab/xpp-core";
import { RuntimeError } from "./errors";
import type { Infolog } from "./infolog";
import { NULL, VOID, int, real, str, toDisplayString, toNumber, type XppValue } from "./values";

export interface BuiltinContext {
  infolog: Infolog;
  line: number;
  company: string;
  /** Fixed so a run is reproducible; the golden suite depends on it. */
  today: string;
}

export type Builtin = (args: XppValue[], context: BuiltinContext) => XppValue;

const arg = (args: XppValue[], index: number): XppValue => args[index] ?? NULL;
const argStr = (args: XppValue[], index: number): string => toDisplayString(arg(args, index));
const argNum = (args: XppValue[], index: number): number => toNumber(arg(args, index));

/**
 * `strFmt("Blocked %1 items", counter)`.
 *
 * Placeholders are `%1`-based, not `{0}`-based, and they may repeat. Anything with no
 * matching argument is left as written, which is what the real implementation does and
 * is a useful signal that an argument is missing.
 */
export function formatString(template: string, args: XppValue[]): string {
  return template.replace(/%(\d+)/g, (whole, digits: string) => {
    const index = Number(digits) - 1;
    const value = args[index];
    return value === undefined ? whole : toDisplayString(value);
  });
}

export const BUILTINS: Record<string, Builtin> = {
  // -- Infolog ------------------------------------------------------------
  //
  // These write to the Infolog and return an Exception enum value. They do NOT throw
  // (VB-010) — `throw error("...")` is two steps: error() logs and returns the enum,
  // throw raises it.
  info: (args, context) => {
    context.infolog.add("info", argStr(args, 0), context.line);
    return { type: "enum", enumName: "Exception", valueName: "Info", value: 1 };
  },
  warning: (args, context) => {
    context.infolog.add("warning", argStr(args, 0), context.line);
    return { type: "enum", enumName: "Exception", valueName: "Warning", value: 2 };
  },
  error: (args, context) => {
    context.infolog.add("error", argStr(args, 0), context.line);
    return { type: "enum", enumName: "Exception", valueName: "Error", value: 3 };
  },

  // -- Strings ------------------------------------------------------------
  strfmt: (args) => str(formatString(argStr(args, 0), args.slice(1))),
  strlen: (args) => int(argStr(args, 0).length),
  strupr: (args) => str(argStr(args, 0).toUpperCase()),
  strlwr: (args) => str(argStr(args, 0).toLowerCase()),
  // X++ substr is 1-based, and that off-by-one catches everyone.
  substr: (args) => {
    const start = Math.max(1, argNum(args, 1));
    const length = argNum(args, 2);
    return str(argStr(args, 0).substr(start - 1, length));
  },
  strfind: (args) => {
    const haystack = argStr(args, 0);
    const needle = argStr(args, 1);
    const from = Math.max(1, argNum(args, 2) || 1);
    return int(haystack.indexOf(needle, from - 1) + 1);
  },
  strrep: (args) => str(argStr(args, 0).repeat(Math.max(0, argNum(args, 1)))),
  strltrim: (args) => str(argStr(args, 0).replace(/^\s+/, "")),
  strrtrim: (args) => str(argStr(args, 0).replace(/\s+$/, "")),

  // -- Conversions --------------------------------------------------------
  int2str: (args) => str(String(Math.trunc(argNum(args, 0)))),
  str2int: (args) => {
    const parsed = Number.parseInt(argStr(args, 0), 10);
    if (Number.isNaN(parsed)) {
      // Exception::Numeric is what a real str2int failure raises.
      throw new RuntimeError(
        XppErrorCodes.TypeMismatch,
        `'${argStr(args, 0)}' is not a number.`,
        "str2int throws Exception::Numeric when the text is not numeric. Check the input, or catch (Exception::Numeric).",
        "Numeric",
      );
    }
    return int(parsed);
  },
  real2str: (args) => str(argNum(args, 0).toFixed(2)),
  str2real: (args) => real(Number(argStr(args, 0)) || 0),
  any2str: (args) => str(argStr(args, 0)),
  any2int: (args) => int(argNum(args, 0)),
  enum2str: (args) => str(argStr(args, 0)),

  // -- Numbers ------------------------------------------------------------
  abs: (args) => real(Math.abs(argNum(args, 0))),
  round: (args) => {
    const step = argNum(args, 1) || 1;
    return real(Math.round(argNum(args, 0) / step) * step);
  },
  min: (args) => real(Math.min(...args.map(toNumber))),
  max: (args) => real(Math.max(...args.map(toNumber))),

  // -- Dates --------------------------------------------------------------
  //
  // `today()` is fixed per run rather than reading the clock, so a golden file taken in
  // August still passes in September.
  today: (_args, context) => ({ type: "date", value: context.today }),
  systemdateget: (_args, context) => ({ type: "date", value: context.today }),

  // -- Containers ---------------------------------------------------------
  conlen: (args) => {
    const value = arg(args, 0);
    return int(value.type === "container" ? value.elements.length : 0);
  },
  conpeek: (args) => {
    const value = arg(args, 0);
    if (value.type !== "container") return NULL;
    // 1-based, like everything else in X++.
    return value.elements[argNum(args, 1) - 1] ?? NULL;
  },
  connull: () => ({ type: "container", elements: [] }),
  conins: (args) => {
    const value = arg(args, 0);
    if (value.type !== "container") return value;
    const elements = [...value.elements];
    elements.splice(Math.max(0, argNum(args, 1) - 1), 0, ...args.slice(2));
    return { type: "container", elements };
  },
  condel: (args) => {
    const value = arg(args, 0);
    if (value.type !== "container") return value;
    const elements = [...value.elements];
    elements.splice(Math.max(0, argNum(args, 1) - 1), Math.max(1, argNum(args, 2)));
    return { type: "container", elements };
  },
  conpoke: (args) => {
    const value = arg(args, 0);
    if (value.type !== "container") return value;
    const elements = [...value.elements];
    elements[Math.max(0, argNum(args, 1) - 1)] = arg(args, 2);
    return { type: "container", elements };
  },

  // -- Session ------------------------------------------------------------
  curext: (_args, context) => str(context.company),
  // Fixed, because a golden file cannot depend on who is logged in.
  curuserid: () => str("LEARNER"),

  // -- Compile-time reflection -------------------------------------------
  //
  // These take a name and return it as a string. The compiler validates the name for
  // real; we accept whatever is written, and Phase 7 will check it against the AOT.
  classstr: (args) => str(argStr(args, 0)),
  tablestr: (args) => str(argStr(args, 0)),
  fieldstr: (args) => str(argStr(args, 1) || argStr(args, 0)),
  methodstr: (args) => str(argStr(args, 1) || argStr(args, 0)),
  tablemethodstr: (args) => str(argStr(args, 1) || argStr(args, 0)),
  literalstr: (args) => str(argStr(args, 0)),
  typename: (args) => str(arg(args, 0).type),

  // -- No-ops -------------------------------------------------------------
  //
  // Documented as doing nothing but satisfying the compiler about an empty catch.
  exceptiontextfallthrough: () => VOID,
  // `print` writes to a window this simulator does not have. Accepted so pasted code
  // runs, but routed to the Infolog so the output is not silently lost.
  print: (args, context) => {
    context.infolog.add("info", argStr(args, 0), context.line);
    return VOID;
  },
};

/** C/AL habits, mapped to the X++ equivalent. Recognised only to produce a better error. */
const CAL_EQUIVALENTS: Record<string, string> = {
  format: "strFmt",
  message: "info",
  strsubstno: "strFmt",
  copystr: "subStr",
  strpos: "strFind",
  uppercase: "strUpr",
  lowercase: "strLwr",
  increment: "the ++ operator",
  round: "round",
  today: "today",
};

export function isBuiltin(name: string): boolean {
  return Object.hasOwn(BUILTINS, name.toLowerCase());
}

export function callBuiltin(name: string, args: XppValue[], context: BuiltinContext): XppValue {
  const builtin = BUILTINS[name.toLowerCase()];
  if (builtin === undefined) {
    throw new RuntimeError(
      XppErrorCodes.MethodNotFound,
      `There is no function called '${name}'.`,
      hintForUnknownFunction(name),
    );
  }
  return builtin(args, context);
}

function hintForUnknownFunction(name: string): string {
  const equivalent = CAL_EQUIVALENTS[name.toLowerCase()];
  if (equivalent !== undefined) {
    return `That is the C/AL name. In X++ it is \`${equivalent}\`.`;
  }

  const close = Object.keys(BUILTINS).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase().replace(/[_\s]/g, ""),
  );
  if (close !== undefined) return `Did you mean \`${close}\`?`;

  return "Check the spelling. The language subset lists every global function this simulator provides.";
}
