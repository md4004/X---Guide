/**
 * Schema to SQL.
 *
 * Column *order* matters here: `RECID` and `DATAAREAID` come last, after the authored
 * fields, so a `SELECT *` in the Data panel reads the way an F&O table browser does —
 * business fields first, system fields at the end.
 */

import { DATAAREAID_FIELD, RECID_FIELD, SCHEMA, type FieldType, type TableSchema } from "../schema";

/** SQLite storage class for each X++ base type. */
function storageClass(type: FieldType): string {
  switch (type) {
    case "int":
    case "int64":
    case "enum":
      return "INTEGER";
    case "real":
      return "REAL";
    case "container":
      return "BLOB";
    case "str":
    case "date":
    case "utcdatetime":
    case "guid":
      return "TEXT";
  }
}

/**
 * `INTEGER PRIMARY KEY AUTOINCREMENT` rather than a plain rowid alias, because
 * AUTOINCREMENT guarantees a deleted RECID is never handed out again — which is how
 * RecId behaves in F&O.
 */
export function createTableStatement(table: TableSchema): string {
  // A view has no storage of its own — it is the select, saved. Creating it for real is
  // what makes reading one show the join in the SQL trace.
  if (table.isView === true) {
    if (table.viewSql === undefined) {
      throw new Error(`${table.name} is a view but declares no viewSql.`);
    }
    return `CREATE VIEW ${table.name} AS ${table.viewSql}`;
  }

  const columns = [
    ...table.fields.map((field) => `  ${field.name} ${storageClass(field.type)}`),
    `  ${RECID_FIELD} INTEGER PRIMARY KEY AUTOINCREMENT`,
    `  ${DATAAREAID_FIELD} TEXT NOT NULL`,
  ];
  return `CREATE TABLE ${table.name} (\n${columns.join(",\n")}\n)`;
}

/**
 * Indexes are created for real so the SQL trace and any future `EXPLAIN` reflect
 * something true. A company-scoped table's indexes lead with `DATAAREAID`, exactly as
 * F&O prefixes its indexes, so per-company lookups are the ones that are cheap.
 */
export function createIndexStatements(table: TableSchema): string[] {
  // Nothing to index on a view: the indexes that matter are on the tables underneath it.
  if (table.isView === true) return [];

  return table.indexes.map((index) => {
    const fields = table.saveDataPerCompany ? [DATAAREAID_FIELD, ...index.fields] : index.fields;
    const unique = index.unique ? "UNIQUE " : "";
    return `CREATE ${unique}INDEX ${table.name}_${index.name} ON ${table.name} (${fields.join(", ")})`;
  });
}

/** Every statement needed to build an empty database, in execution order. */
export function createSchemaStatements(tables: readonly TableSchema[] = SCHEMA): string[] {
  return tables.flatMap((table) => [createTableStatement(table), ...createIndexStatements(table)]);
}

export function dropSchemaStatements(tables: readonly TableSchema[] = SCHEMA): string[] {
  // Views first. Dropping a table out from under a view is legal in SQLite but leaves a
  // broken view behind, and the next create would then fail on the name.
  const views = tables.filter((table) => table.isView === true);
  const rest = tables.filter((table) => table.isView !== true);

  return [
    ...views.map((view) => `DROP VIEW IF EXISTS ${view.name}`),
    ...rest.map((table) => `DROP TABLE IF EXISTS ${table.name}`),
  ];
}
