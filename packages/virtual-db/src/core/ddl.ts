/**
 * Schema to SQL.
 *
 * Column *order* matters here: `RECID` and `DATAAREAID` come last, after the authored
 * fields, so a `SELECT *` in the Data panel reads the way an F&O table browser does —
 * business fields first, system fields at the end.
 */

import {
  DATAAREAID_FIELD,
  RECID_FIELD,
  SCHEMA,
  type FieldType,
  type TableSchema,
} from "../schema.js";

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
  return tables.map((table) => `DROP TABLE IF EXISTS ${table.name}`);
}
