/**
 * Schema and seed invariants.
 *
 * These are the rules that hold for every table and every seeded row, checked
 * generically so a table added in a later phase cannot quietly break them.
 */

import { describe, expect, it } from "vitest";
import {
  COMPANIES,
  DATAAREAID_FIELD,
  RECID_FIELD,
  SEEDS,
  TABLES,
  VIEWS,
  SHARED_DATAAREAID,
  TABLE_NAMES,
  createIndexStatements,
  createSchemaStatements,
  createTableStatement,
  dropSchemaStatements,
  getBaseEnum,
  getTableSchema,
} from "../src/index.js";

describe("table set", () => {
  it("defines every table named in the Phase 1 plan, and no others", () => {
    expect(TABLES.map((table) => table.name).sort()).toEqual([...TABLE_NAMES].sort());
  });

  it("has unique table names", () => {
    expect(new Set(TABLE_NAMES).size).toBe(TABLE_NAMES.length);
  });

  it("resolves table names case-insensitively, as X++ identifiers are", () => {
    expect(getTableSchema("custtable")?.name).toBe("CustTable");
    expect(getTableSchema("CUSTTABLE")?.name).toBe("CustTable");
    expect(getTableSchema("NoSuchTable")).toBeUndefined();
  });
});

describe("every table", () => {
  it.each(TABLES.map((table) => [table.name, table] as const))(
    "%s carries RECID and DATAAREAID without declaring them as ordinary fields",
    (_name, table) => {
      const fieldNames = table.fields.map((field) => field.name);
      expect(fieldNames).not.toContain(RECID_FIELD);
      expect(fieldNames).not.toContain(DATAAREAID_FIELD);

      const ddl = createTableStatement(table);
      expect(ddl).toContain(`${RECID_FIELD} INTEGER PRIMARY KEY AUTOINCREMENT`);
      expect(ddl).toContain(`${DATAAREAID_FIELD} TEXT NOT NULL`);
    },
  );

  it.each(TABLES.map((table) => [table.name, table] as const))(
    "%s has unique field names and at least one field",
    (_name, table) => {
      const fieldNames = table.fields.map((field) => field.name);
      expect(fieldNames.length).toBeGreaterThan(0);
      expect(new Set(fieldNames).size).toBe(fieldNames.length);
    },
  );

  it.each(TABLES.map((table) => [table.name, table] as const))(
    "%s indexes and relations only reference fields that exist",
    (_name, table) => {
      const known = new Set([...table.fields.map((f) => f.name), RECID_FIELD, DATAAREAID_FIELD]);

      for (const index of table.indexes) {
        for (const field of index.fields) expect(known).toContain(field);
      }

      for (const relation of table.relations) {
        const related = getTableSchema(relation.relatedTable);
        expect(related).toBeDefined();
        const relatedFields = new Set([
          ...related!.fields.map((f) => f.name),
          RECID_FIELD,
          DATAAREAID_FIELD,
        ]);
        for (const [own, foreign] of relation.fields) {
          expect(known).toContain(own);
          expect(relatedFields).toContain(foreign);
        }
      }
    },
  );

  it.each(TABLES.map((table) => [table.name, table] as const))(
    "%s names a base enum that exists for each enum field",
    (_name, table) => {
      for (const field of table.fields) {
        if (field.type !== "enum") continue;
        expect(field.enumName).toBeDefined();
        expect(getBaseEnum(field.enumName!)).toBeDefined();
      }
    },
  );

  it("has exactly one primary index per table", () => {
    for (const table of TABLES) {
      expect(table.indexes.filter((index) => index.primary)).toHaveLength(1);
    }
  });
});

describe("every view", () => {
  it("declares the select behind it", () => {
    for (const view of VIEWS) {
      expect(view.viewSql, `${view.name} is a view with no viewSql`).toBeDefined();
    }
  });

  it("is created as a view rather than a table", () => {
    for (const view of VIEWS) {
      expect(createTableStatement(view)).toContain(`CREATE VIEW ${view.name} AS`);
    }
  });

  /**
   * The one that matters.
   *
   * A company-scoped view that forgets to select `DATAAREAID` still works, still returns
   * rows, and quietly returns *every company's* rows — because the scoping predicate the
   * select compiler adds has nothing to bind to. That is how a convenience becomes a data
   * leak, and it is invisible in a one-company test environment.
   */
  it("selects RECID and DATAAREAID so company scoping still applies", () => {
    for (const view of VIEWS) {
      expect(view.viewSql, `${view.name} does not select RECID`).toContain(`AS ${RECID_FIELD}`);

      if (view.saveDataPerCompany) {
        expect(
          view.viewSql,
          `${view.name} is company-scoped but does not select DATAAREAID`,
        ).toContain(`AS ${DATAAREAID_FIELD}`);
      }
    }
  });

  it("declares no indexes of its own", () => {
    for (const view of VIEWS) {
      expect(view.indexes).toEqual([]);
      expect(createIndexStatements(view)).toEqual([]);
    }
  });

  it("is dropped before the tables underneath it", () => {
    const statements = dropSchemaStatements();
    const firstTable = statements.findIndex((statement) => statement.startsWith("DROP TABLE"));

    for (const view of VIEWS) {
      const index = statements.indexOf(`DROP VIEW IF EXISTS ${view.name}`);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(firstTable);
    }
  });
});

describe("generated DDL", () => {
  it("produces a create statement and its indexes for every table", () => {
    const statements = createSchemaStatements();
    for (const table of TABLES) {
      expect(statements.some((s) => s.startsWith(`CREATE TABLE ${table.name} (`))).toBe(true);
    }
  });

  it("leads company-scoped indexes with DATAAREAID, the way F&O does", () => {
    const statements = createSchemaStatements();
    const custIndex = statements.find((s) => s.includes("CustTable_AccountIdx"));
    expect(custIndex).toContain(`(${DATAAREAID_FIELD}, AccountNum)`);
  });

  it("does not prefix shared-table indexes with DATAAREAID", () => {
    const statements = createSchemaStatements();
    const partyIndex = statements.find((s) => s.includes("DirPartyTable_PartyNumberIdx"));
    expect(partyIndex).toContain("(PartyNumber)");
  });
});

describe("seed data", () => {
  it("registers the seeds the app names", () => {
    expect(Object.keys(SEEDS).sort()).toEqual(["credit", "default", "empty"]);
  });

  const seededRows = Object.entries(SEEDS.default!.rows) as [
    string,
    ReadonlyArray<Record<string, unknown>>,
  ][];

  const rowsOf = (name: string): [string, ReadonlyArray<Record<string, unknown>>][] =>
    Object.entries(SEEDS[name]!.rows) as [string, ReadonlyArray<Record<string, unknown>>][];

  // The structural and legal checks run over *every* seed, not just the default one. A
  // scenario ships its own dataset, and a seed that names a column the schema does not
  // have fails at reset with a SQLite error rather than anything a learner can act on.
  describe.each(Object.keys(SEEDS))("%s", (seedName) => {
    const rows = rowsOf(seedName);

    it("only seeds tables that exist", () => {
      for (const [tableName] of rows) {
        expect(getTableSchema(tableName)).toBeDefined();
      }
    });

    it("only seeds columns that exist on the table", () => {
      for (const [tableName, tableRows] of rows) {
        const table = getTableSchema(tableName)!;
        const known = new Set([...table.fields.map((f) => f.name), RECID_FIELD, DATAAREAID_FIELD]);
        for (const row of tableRows) {
          for (const column of Object.keys(row)) {
            expect({ tableName, column, known: known.has(column) }).toEqual({
              tableName,
              column,
              known: true,
            });
          }
        }
      }
    });

    it("stamps every row with a real company, or the shared marker", () => {
      const valid = new Set<string>([...COMPANIES.map((c) => c.id), SHARED_DATAAREAID]);
      for (const [tableName, tableRows] of rows) {
        const shared = getTableSchema(tableName)!.saveDataPerCompany === false;
        for (const row of tableRows) {
          const company = row[DATAAREAID_FIELD];
          expect(valid.has(String(company))).toBe(true);
          // A shared table's rows must not claim a company, or filtering gets ambiguous.
          if (shared) expect(company).toBe(SHARED_DATAAREAID);
        }
      }
    });

    it("ships no Microsoft demo company names — CLAUDE.md > Legal rule", () => {
      const forbidden = ["Contoso", "Fabrikam", "Adventure Works", "Northwind", "Litware"];
      const serialised = JSON.stringify(SEEDS[seedName]);
      for (const name of forbidden) {
        expect(serialised).not.toContain(name);
      }
    });
  });

  it("puts data in all three legal entities", () => {
    const companies = new Set(
      seededRows.flatMap(([, rows]) => rows.map((row) => row[DATAAREAID_FIELD])),
    );
    for (const company of COMPANIES) {
      expect(companies).toContain(company.id);
    }
  });

  it("ships no Microsoft demo company identifiers", () => {
    // Contoso demo data is Microsoft IP — see CLAUDE.md > Legal rule.
    const forbiddenCompanies = new Set(["USMF", "USRT", "DEMF", "GBSI", "INMF", "DAT", "USPM"]);
    const used = new Set(
      seededRows.flatMap(([, rows]) => rows.map((row) => String(row[DATAAREAID_FIELD]))),
    );
    for (const company of used) {
      expect(forbiddenCompanies.has(company)).toBe(false);
    }
  });

});

// selectToSql is covered end to end in selectToSql.test.ts, against real parsed input.
