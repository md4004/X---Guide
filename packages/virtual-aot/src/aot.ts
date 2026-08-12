/**
 * The AOT itself: lookups over the model.
 *
 * Every lookup is case-insensitive, because X++ identifiers are and a learner will type
 * `custTable` where the metadata says `CustTable`. Getting this wrong produces the worst
 * class of bug in a teaching tool — one where the learner's code is right and the tool
 * says it is wrong.
 *
 * Extensions and Chain of Command resolution belong to the customisation track and are
 * refused here rather than half-implemented. See CLAUDE.md > Fidelity rule.
 */

import { XppErrorCodes, type XppError } from "@xpplab/xpp-core";
import { BASE_MODEL } from "./model";
import type {
  AotModel,
  AotObjectRef,
  AotObjectType,
  BaseEnumMetadata,
  CocChain,
  DataEntityMetadata,
  EdtMetadata,
  ExtensionDefinition,
  FieldMetadata,
  FormMetadata,
  ReportMetadata,
  TableMetadata,
  VirtualAot,
} from "./types";

const lower = (value: string): string => value.toLowerCase();

/** Structured clone of the baseline, so a caller mutating the model cannot poison it. */
function cloneModel(model: AotModel): AotModel {
  return structuredClone(model);
}

class Aot implements VirtualAot {
  readonly #baseline: AotModel;
  #model: AotModel;

  #tables = new Map<string, TableMetadata>();
  #edts = new Map<string, EdtMetadata>();
  #enums = new Map<string, BaseEnumMetadata>();
  #forms = new Map<string, FormMetadata>();
  #entities = new Map<string, DataEntityMetadata>();
  #reports = new Map<string, ReportMetadata>();

  constructor(model: AotModel) {
    this.#baseline = cloneModel(model);
    this.#model = cloneModel(model);
    this.#reindex();
  }

  #reindex(): void {
    this.#tables = new Map(this.#model.tables.map((table) => [lower(table.name), table]));
    this.#edts = new Map(this.#model.edts.map((edt) => [lower(edt.name), edt]));
    this.#enums = new Map(this.#model.enums.map((item) => [lower(item.name), item]));
    this.#forms = new Map(this.#model.forms.map((form) => [lower(form.name), form]));
    this.#entities = new Map(this.#model.entities.map((entity) => [lower(entity.name), entity]));
    this.#reports = new Map(this.#model.reports.map((report) => [lower(report.name), report]));
  }

  getModel(): AotModel {
    return this.#model;
  }

  getTable(name: string): TableMetadata | undefined {
    return this.#tables.get(lower(name));
  }

  getEdt(name: string): EdtMetadata | undefined {
    return this.#edts.get(lower(name));
  }

  getEnum(name: string): BaseEnumMetadata | undefined {
    return this.#enums.get(lower(name));
  }

  getForm(name: string): FormMetadata | undefined {
    return this.#forms.get(lower(name));
  }

  getEntity(name: string): DataEntityMetadata | undefined {
    return this.#entities.get(lower(name));
  }

  getReport(name: string): ReportMetadata | undefined {
    return this.#reports.get(lower(name));
  }

  getField(tableName: string, fieldName: string): FieldMetadata | undefined {
    return this.getTable(tableName)?.fields.find((field) => lower(field.name) === lower(fieldName));
  }

  applyExtension(_extension: ExtensionDefinition): { ok: true } | { ok: false; error: XppError } {
    return {
      ok: false,
      error: {
        code: XppErrorCodes.ConstructOutsideSubset,
        message: "Extensions are not available yet.",
        hint: "Table and form extensions arrive with the customisation track.",
        severity: "error",
        line: 1,
        column: 1,
      },
    };
  }

  removeExtension(_name: string): void {
    // Nothing can be applied yet, so nothing can be removed. Not an error: `reset()`
    // calling this on an empty list must be a no-op rather than a throw.
  }

  listExtensions(): ExtensionDefinition[] {
    return [];
  }

  resolveCoc(_target: AotObjectRef, _methodName: string): CocChain {
    throw new Error(
      "Chain of Command resolution arrives with the customisation track. Refusing rather than returning an empty chain, which would read as 'nothing extends this'.",
    );
  }

  listObjects(type?: AotObjectType): AotObjectRef[] {
    const all: AotObjectRef[] = [
      ...this.#model.tables.map((table) => ({ type: "table" as const, name: table.name })),
      ...this.#model.edts.map((edt) => ({ type: "edt" as const, name: edt.name })),
      ...this.#model.enums.map((item) => ({ type: "baseEnum" as const, name: item.name })),
      ...this.#model.forms.map((form) => ({ type: "form" as const, name: form.name })),
      ...this.#model.entities.map((entity) => ({
        type: "dataEntity" as const,
        name: entity.name,
      })),
    ];

    return type === undefined ? all : all.filter((ref) => ref.type === type);
  }

  reset(): void {
    this.#model = cloneModel(this.#baseline);
    this.#reindex();
  }
}

export function createVirtualAot(model: AotModel = BASE_MODEL): VirtualAot {
  return new Aot(model);
}
