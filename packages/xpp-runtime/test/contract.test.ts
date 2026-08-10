/**
 * Runtime units that are worth testing away from the golden suite.
 *
 * The golden files prove end-to-end behaviour; these prove the pieces, so a failure
 * points at a function rather than at a diff.
 */

import { describe, expect, it } from "vitest";
import { Scope, closestName, createInfolog, formatString, isBuiltin } from "../src/index.js";
import { int, str, toDisplayString, valuesEqual } from "../src/index.js";

describe("strFmt", () => {
  it("substitutes %1-based placeholders", () => {
    expect(formatString("Blocked %1 items", [int(4)])).toBe("Blocked 4 items");
  });

  it("repeats an argument used twice", () => {
    expect(formatString("%1 and %1", [str("x")])).toBe("x and x");
  });

  it("leaves a placeholder with no argument as written, so the gap is visible", () => {
    expect(formatString("%1 %2", [str("only")])).toBe("only %2");
  });

  it("renders an enum as its value name, not its ordinal", () => {
    const value = { type: "enum", enumName: "NoYes", valueName: "Yes", value: 1 } as const;
    expect(formatString("%1", [value])).toBe("Yes");
  });

  it("renders a boolean the way the Infolog does", () => {
    expect(toDisplayString({ type: "boolean", value: true })).toBe("Yes");
    expect(toDisplayString({ type: "boolean", value: false })).toBe("No");
  });

  it("renders a real to two decimals", () => {
    expect(toDisplayString({ type: "real", value: 4188.5 })).toBe("4188.50");
  });
});

describe("scope", () => {
  it("resolves names case-insensitively, as X++ identifiers are", () => {
    const scope = new Scope();
    scope.declare("custTable", int(1));
    expect(scope.get("CUSTTABLE")).toBeDefined();
    expect(scope.get("CustTable")).toBeDefined();
  });

  it("finds a binding declared in an outer scope", () => {
    const outer = new Scope();
    outer.declare("counter", int(1));
    expect(outer.child().child().get("counter")).toBeDefined();
  });

  it("assigns through to the scope that owns the binding", () => {
    const outer = new Scope();
    outer.declare("counter", int(1));
    const inner = outer.child();

    expect(inner.set("counter", int(9))).toBe(true);
    expect(outer.get("counter")).toEqual(int(9));
  });

  it("refuses to assign to a name that was never declared", () => {
    expect(new Scope().set("nothing", int(1))).toBe(false);
  });

  it("shadows an outer binding without disturbing it", () => {
    const outer = new Scope();
    outer.declare("value", int(1));
    const inner = outer.child();
    inner.declare("value", int(2));

    expect(inner.get("value")).toEqual(int(2));
    expect(outer.get("value")).toEqual(int(1));
  });
});

describe("closestName", () => {
  it("suggests a near miss", () => {
    expect(closestName("custTabel", ["custTable", "inventTable"])).toBe("custTable");
  });

  it("suggests nothing when nothing is close", () => {
    expect(closestName("zzz", ["custTable", "inventTable"])).toBeUndefined();
  });

  it("never suggests an exact match, which would read as nonsense", () => {
    expect(closestName("custTable", ["custTable"])).toBeUndefined();
  });
});

describe("infolog", () => {
  it("numbers entries in emission order", () => {
    const infolog = createInfolog();
    infolog.add("info", "first");
    infolog.add("warning", "second");
    expect(infolog.entries().map((entry) => entry.sequence)).toEqual([0, 1]);
  });

  it("rewinds to a mark, which is what retry needs (VB-009)", () => {
    const infolog = createInfolog();
    infolog.add("info", "kept");
    const mark = infolog.mark();
    infolog.add("info", "discarded");
    infolog.add("info", "also discarded");

    infolog.rewindTo(mark);

    expect(infolog.entries().map((entry) => entry.message)).toEqual(["kept"]);
  });

  it("keeps sequence numbers contiguous after a rewind", () => {
    const infolog = createInfolog();
    infolog.add("info", "a");
    const mark = infolog.mark();
    infolog.add("info", "b");
    infolog.rewindTo(mark);
    infolog.add("info", "c");

    expect(infolog.entries().map((entry) => entry.sequence)).toEqual([0, 1]);
  });
});

describe("equality", () => {
  it("compares strings by value", () => {
    expect(valuesEqual(str("a"), str("a"))).toBe(true);
    expect(valuesEqual(str("a"), str("b"))).toBe(false);
  });

  it("compares an enum against its ordinal", () => {
    const yes = { type: "enum", enumName: "NoYes", valueName: "Yes", value: 1 } as const;
    expect(valuesEqual(yes, int(1))).toBe(true);
  });
});

describe("builtins", () => {
  it("recognises the documented globals, case-insensitively", () => {
    for (const name of ["info", "strFmt", "STRLEN", "conPeek", "today", "curExt"]) {
      expect({ name, known: isBuiltin(name) }).toEqual({ name, known: true });
    }
  });

  it("does not recognise a C/AL name", () => {
    expect(isBuiltin("FORMAT")).toBe(false);
    expect(isBuiltin("MESSAGE")).toBe(false);
  });
});
