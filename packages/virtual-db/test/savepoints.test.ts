/**
 * The raw SQLite savepoint layer, underneath X++ semantics.
 *
 * This is PLAN.md's Phase 1 acceptance criterion as literally worded: open nested
 * transactions, abort the inner one, assert the outer state survived. That is true of
 * savepoints, and this is the layer where it is true.
 *
 * X++ does NOT behave this way — see test/transactions.test.ts and VB-001.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteHandle } from "../src/core/sqlite.js";
import { SavepointStack } from "../src/core/savepoints.js";

let sqlite: SqliteHandle;
let stack: SavepointStack;

const names = () =>
  sqlite.select("SELECT NAME FROM scratch ORDER BY NAME").rows.map((row) => row[0]);

beforeEach(async () => {
  sqlite = await openDatabase();
  sqlite.run("CREATE TABLE scratch (NAME TEXT)");
  stack = new SavepointStack(sqlite);
});

describe("SavepointStack", () => {
  it("starts at depth zero", () => {
    expect(stack.depth).toBe(0);
    expect(stack.savepoints).toEqual([]);
  });

  it("tracks nesting depth as savepoints open and release", () => {
    stack.begin();
    expect(stack.depth).toBe(1);
    stack.begin();
    expect(stack.depth).toBe(2);

    stack.release();
    expect(stack.depth).toBe(1);
    stack.release();
    expect(stack.depth).toBe(0);
  });

  it("names savepoints by depth so the SQL trace is readable", () => {
    stack.begin();
    stack.begin();
    expect(stack.savepoints).toEqual(["tts_1", "tts_2"]);
  });

  it("rolls back to the inner savepoint and leaves the outer work intact", () => {
    stack.begin();
    sqlite.run("INSERT INTO scratch (NAME) VALUES (?)", ["outer"]);

    stack.begin();
    sqlite.run("INSERT INTO scratch (NAME) VALUES (?)", ["inner"]);
    expect(names()).toEqual(["inner", "outer"]);

    stack.rollbackTo(2);

    // The inner insert is gone; the outer insert is not.
    expect(names()).toEqual(["outer"]);
    expect(stack.depth).toBe(1);
  });

  it("rolls back to the outermost savepoint and discards everything", () => {
    stack.begin();
    sqlite.run("INSERT INTO scratch (NAME) VALUES (?)", ["outer"]);
    stack.begin();
    sqlite.run("INSERT INTO scratch (NAME) VALUES (?)", ["inner"]);

    stack.rollbackTo(1);

    expect(names()).toEqual([]);
    expect(stack.depth).toBe(0);
  });

  it("refuses to release below zero rather than silently underflowing", () => {
    expect(() => stack.release()).toThrowError(/no open savepoint/i);
  });

  it("refuses to roll back to a level that was never opened", () => {
    stack.begin();
    expect(() => stack.rollbackTo(2)).toThrowError(/level 2/i);
  });

  it("resets to depth zero, discarding open savepoints", () => {
    stack.begin();
    stack.begin();
    stack.reset();
    expect(stack.depth).toBe(0);
  });
});
