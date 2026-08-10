import type { SqlValue } from "@xpplab/xpp-core";
import type { TableName } from "../schema";

/**
 * Named dataset variants. A lesson picks one via `seed:` in its frontmatter, so a lesson
 * about empty-result handling can start from an empty table without every other lesson
 * paying for it.
 */
export type SeedName = "default" | "empty" | (string & {});

export interface SeedDefinition {
  name: SeedName;
  description: string;
  /**
   * `rows[tableName][i]` is one record, keyed by field name. `DATAAREAID` is required on
   * every row. `RECID` may be given explicitly when other rows reference it — otherwise
   * it is assigned by the database.
   */
  rows: Partial<Record<TableName, ReadonlyArray<Record<string, SqlValue>>>>;
}
