/**
 * `validateField` and `validateWrite`, driven by metadata.
 *
 * This is the reason the metadata layer exists. Until it did, the runtime refused to run
 * `validateWrite()` at all, because returning `true` unconditionally would have taught a
 * learner that their record was valid when nothing had looked at it.
 *
 * Two verified behaviours shape this (see docs/verified-behaviour.md):
 *
 *   VB-012  validateWrite returns a boolean. It reports; it does not write, and it does
 *           not throw by itself.
 *   VB-014  field-level validation runs first, and a field-level failure means
 *           validateWrite is never reached.
 *
 * VB-013 — that a plain `buffer.insert()` does *not* call any of this — is enforced by
 * the runtime, not here: this module is only ever called when the learner asks for it.
 */

import type { FieldMetadata, TableMetadata } from "./types";

/** What a failed check produces. The message is what the Infolog shows. */
export interface ValidationFailure {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  failures: ValidationFailure[];
}

/** The row as the buffer currently holds it, field name to value. */
export type RecordValues = Record<string, unknown>;

const OK: ValidationResult = { ok: true, failures: [] };

function isEmpty(value: unknown): boolean {
  // X++ has no null: a field is "not filled in" when it still holds the empty value for
  // its type. That is why `if (custTable.AccountNum)` is the idiomatic existence check,
  // and it is the same rule the form engine applies.
  return value === undefined || value === null || value === "" || value === 0;
}

function lookup(values: RecordValues, fieldName: string): unknown {
  const key = Object.keys(values).find((name) => name.toLowerCase() === fieldName.toLowerCase());
  return key === undefined ? undefined : values[key];
}

/**
 * One field, checked the way the form engine checks it when focus leaves the control.
 *
 * Deliberately narrow. Real `validateField` also enforces relations and `AllowEditOnCreate`;
 * neither is modelled, so neither is claimed.
 */
export function validateField(
  field: FieldMetadata,
  value: unknown,
  edtStringSize?: number,
): ValidationResult {
  if (field.mandatory && isEmpty(value)) {
    // Phrasing follows F&O's convention of naming the field by its *label*, not its
    // name — that is what a user sees on the form. The exact string is in
    // docs/unverified.md; the shape is right and the wording may not be exact.
    return {
      ok: false,
      failures: [{ field: field.name, message: `Field '${field.label}' must be filled in.` }],
    };
  }

  if (edtStringSize !== undefined && typeof value === "string" && value.length > edtStringSize) {
    return {
      ok: false,
      failures: [
        {
          field: field.name,
          message: `Field '${field.label}' is longer than the ${edtStringSize} characters its type allows.`,
        },
      ],
    };
  }

  return OK;
}

export interface ValidateWriteOptions {
  table: TableMetadata;
  values: RecordValues;
  /** String sizes by EDT name, so a field can be checked against the type it extends. */
  edtStringSizes?: Record<string, number>;
}

/**
 * Every field, then the record.
 *
 * Returns all field failures rather than stopping at the first, which is what the docs
 * describe — "if a validation fails because of an error, validation for the remaining
 * fields continues". The learner sees everything wrong with the record in one pass, which
 * is also simply better feedback.
 */
export function validateWrite({
  table,
  values,
  edtStringSizes = {},
}: ValidateWriteOptions): ValidationResult {
  const failures: ValidationFailure[] = [];

  for (const field of table.fields) {
    const size = field.edt === undefined ? undefined : edtStringSizes[field.edt];
    const result = validateField(field, lookup(values, field.name), size);
    failures.push(...result.failures);
  }

  return failures.length === 0 ? OK : { ok: false, failures };
}
