/**
 * The class table: what a class is once it has been declared, and who may call what.
 *
 * Pure and separate from the interpreter because the access rules are the lesson. X++'s
 * two defaults are the opposite of the ones most people arrive with:
 *
 *   - a method with no modifier is **public** (VB-034), where C# would make it private
 *   - a field with no modifier is **protected** (VB-035), where C# would make it private
 *
 * Code written on the C# assumption compiles here and then leaks its internals, which is
 * the kind of mistake that survives review because nothing complains. Enforcing it is the
 * only way a learner finds out.
 */

import type { ClassDeclaration, MethodDeclaration, TypeReference } from "@xpplab/xpp-parser";
import { CocError, checkWrapper, extensionTargetOf } from "./coc";
import type { XppValue } from "./values";

export type Access = "public" | "protected" | "private";

export interface RuntimeMethod {
  name: string;
  declaration: MethodDeclaration;
  access: Access;
  isStatic: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  /** Where it was declared. `private` and `protected` are measured against this. */
  declaringClass: RuntimeClass;
}

export interface RuntimeField {
  name: string;
  type: TypeReference;
  access: Access;
  isStatic: boolean;
  declaringClass: RuntimeClass;
}

export interface RuntimeClass {
  name: string;
  base?: RuntimeClass;
  isAbstract: boolean;
  /** Declared on this class only. Inherited members are reached through `base`. */
  methods: Map<string, RuntimeMethod>;
  fields: Map<string, RuntimeField>;
  /** Static field storage, shared by every instance and by the class itself. */
  statics: Map<string, XppValue>;
  /**
   * Wrappers contributed by `[ExtensionOf]` classes, keyed by lowercased method name.
   *
   * Stored on the *target* rather than on the extension, because that is how they are
   * found: a call to `target.method()` has to discover everyone who wrapped it, and the
   * extensions themselves are never named at the call site.
   */
  wrappers: Map<string, RuntimeMethod[]>;
  /** `true` for an `[ExtensionOf]` class, which is never instantiated. */
  isExtension: boolean;
}

const lower = (name: string): string => name.toLowerCase();

/**
 * The access level a member actually has.
 *
 * `fallback` is the difference between a method and a field, and it is the whole reason
 * this function takes a parameter rather than defaulting to one answer.
 */
function accessOf(modifiers: readonly string[], fallback: Access): Access {
  if (modifiers.includes("private")) return "private";
  if (modifiers.includes("protected")) return "protected";
  if (modifiers.includes("public")) return "public";
  return fallback;
}

export class ClassTableError extends Error {
  constructor(
    readonly className: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/**
 * Builds the class table from a parsed unit.
 *
 * Two passes, because a class may extend one declared after it — X++ has no
 * forward-declaration rule and neither should this.
 */
export function buildClassTable(
  declarations: readonly ClassDeclaration[],
  inherited: ReadonlyMap<string, RuntimeClass> = new Map(),
): Map<string, RuntimeClass> {
  const table = new Map<string, RuntimeClass>(inherited);

  for (const declaration of declarations) {
    if (table.has(lower(declaration.name)) && !inherited.has(lower(declaration.name))) {
      throw new ClassTableError(
        declaration.name,
        `There is already a class called '${declaration.name}'.`,
        "Class names are unique, and are compared case-insensitively as all X++ identifiers are.",
      );
    }

    table.set(lower(declaration.name), {
      name: declaration.name,
      isAbstract: declaration.modifiers.includes("abstract"),
      methods: new Map(),
      fields: new Map(),
      statics: new Map(),
      wrappers: new Map(),
      isExtension: extensionTargetOf(declaration) !== undefined,
    });
  }

  // Second pass: link bases and fill members, now that every name resolves.
  for (const declaration of declarations) {
    const runtime = table.get(lower(declaration.name))!;

    if (declaration.extendsClass !== undefined) {
      const base = table.get(lower(declaration.extendsClass));
      if (base === undefined) {
        throw new ClassTableError(
          declaration.name,
          `'${declaration.name}' extends '${declaration.extendsClass}', which does not exist.`,
          "Check the spelling. A class can only extend another class declared in this code or provided as a teaching stub.",
        );
      }
      runtime.base = base;
    }

    for (const field of declaration.fields) {
      for (const name of field.names) {
        runtime.fields.set(lower(name), {
          name,
          type: field.type,
          // VB-035: protected unless it says otherwise.
          access: accessOf(field.modifiers, "protected"),
          isStatic: field.modifiers.includes("static"),
          declaringClass: runtime,
        });
      }
    }

    for (const method of declaration.methods) {
      runtime.methods.set(lower(method.name), {
        name: method.name,
        declaration: method,
        // VB-034: public unless it says otherwise.
        access: accessOf(method.modifiers, "public"),
        isStatic: method.modifiers.includes("static"),
        isFinal: method.modifiers.includes("final"),
        isAbstract: method.modifiers.includes("abstract"),
        declaringClass: runtime,
      });
    }
  }

  // Third pass: the override rules, which can only be checked once bases are linked.
  for (const declaration of declarations) {
    const runtime = table.get(lower(declaration.name))!;
    if (runtime.isExtension) continue;

    for (const method of runtime.methods.values()) {
      checkOverride(runtime, method);
    }
  }

  // Fourth pass: hang each extension's wrappers on the class they wrap.
  for (const declaration of declarations) {
    const extension = table.get(lower(declaration.name))!;
    const target = extensionTargetOf(declaration);
    if (target === undefined) continue;

    attachWrappers(table, extension, target.name);
  }

  return table;
}

/**
 * Registers one extension class's methods as wrappers on its target.
 *
 * Every rule checked here is a compile error in a real environment, so it is raised before
 * a statement runs. A learner who meets "you cannot wrap a private method" at the moment
 * of the call has been taught that this is a runtime concern, and it is not.
 */
function attachWrappers(
  table: Map<string, RuntimeClass>,
  extension: RuntimeClass,
  targetName: string,
): void {
  const target = table.get(lower(targetName));

  if (target === undefined) {
    throw new CocError(
      `'${extension.name}' extends '${targetName}', which does not exist.`,
      "The [ExtensionOf] target has to be a class declared in this code. Check the spelling — a typo here is one of the most common reasons an extension silently never runs in a real environment.",
    );
  }

  for (const wrapper of extension.methods.values()) {
    // `new` on an extension is the extension's own constructor, not a wrapper.
    if (wrapper.name.toLowerCase() === "new") continue;

    const wrapped = findMethod(target, wrapper.name);

    if (wrapped === undefined) {
      throw new CocError(
        `'${extension.name}.${wrapper.name}' wraps nothing — '${target.name}' has no method called '${wrapper.name}'.`,
        "Chain of Command wraps an existing method; it cannot add a new one. Check the name and the signature against the class you are extending.",
      );
    }

    // VB-064: only public and protected methods can be wrapped.
    if (wrapped.access === "private") {
      throw new CocError(
        `'${wrapped.declaringClass.name}.${wrapped.name}' is private, so it cannot be wrapped.`,
        "Chain of Command reaches public and protected methods. A private method is an implementation detail its owner has not offered you.",
      );
    }

    // VB-065: `final` blocks wrapping unless the method opts back in.
    if (wrapped.isFinal && !hasAttribute(wrapped, "wrappable")) {
      throw new CocError(
        `'${wrapped.declaringClass.name}.${wrapped.name}' is final, so it cannot be wrapped.`,
        "A final method can only be wrapped if its owner marked it `[Wrappable(true)]`.",
      );
    }

    if (hasAttribute(wrapped, "hookable")) {
      throw new CocError(
        `'${wrapped.declaringClass.name}.${wrapped.name}' is marked [Hookable(false)], so it cannot be wrapped.`,
        "The owner has explicitly opted this method out of both Chain of Command and pre/post handlers.",
      );
    }

    checkWrapper(extension.name, wrapper.declaration, {
      replaceable: hasAttribute(wrapped, "replaceable"),
    });

    const key = lower(wrapper.name);
    const existing = target.wrappers.get(key) ?? [];
    target.wrappers.set(key, [...existing, wrapper]);
  }
}

/**
 * Whether a method carries an attribute whose single argument is not `false`.
 *
 * `[Hookable(false)]` and `[Wrappable(false)]` are the negative forms, and both matter, so
 * the argument is read rather than the attribute's presence alone.
 */
function hasAttribute(method: RuntimeMethod, name: string): boolean {
  const attribute = method.declaration.attributes.find(
    (candidate) => candidate.name.toLowerCase() === name,
  );
  if (attribute === undefined) return false;

  const argument = attribute.arguments[0];
  const value =
    argument?.kind === "literal" ? String(argument.value).toLowerCase() : "true";

  // `[Hookable(false)]` blocks; `[Wrappable(true)]` and `[Replaceable]` permit.
  return name === "hookable" ? value === "false" : value !== "false";
}

const RANK: Record<Access, number> = { private: 0, protected: 1, public: 2 };

/** VB-038 and VB-044, checked where a real compiler checks them: at declaration time. */
function checkOverride(runtime: RuntimeClass, method: RuntimeMethod): void {
  const inheritedMethod =
    runtime.base === undefined ? undefined : findMethod(runtime.base, method.name);
  if (inheritedMethod === undefined) return;

  if (inheritedMethod.isFinal) {
    throw new ClassTableError(
      runtime.name,
      `'${method.name}' is final in '${inheritedMethod.declaringClass.name}' and cannot be overridden.`,
      "A final method is a promise to callers that its behaviour will not change in a subclass. Give the override a different name, or drop `final` on the base.",
    );
  }

  // VB-038: a private method is not visible to a subclass, so nothing is being overridden.
  if (inheritedMethod.access === "private") {
    throw new ClassTableError(
      runtime.name,
      `'${method.name}' is private in '${inheritedMethod.declaringClass.name}', so it cannot be overridden here.`,
      "Private methods are invisible to subclasses. If it is meant to be overridden, make it protected.",
    );
  }

  // VB-044: the override must be at least as accessible as what it overrides.
  if (RANK[method.access] < RANK[inheritedMethod.access]) {
    throw new ClassTableError(
      runtime.name,
      `'${method.name}' is ${method.access} here but ${inheritedMethod.access} in '${inheritedMethod.declaringClass.name}'. An override cannot narrow access.`,
      "Anything that could call the base method must still be able to call yours, or the subclass would break code that works against the base.",
    );
  }
}

/** Resolves a method up the inheritance chain, innermost first. */
export function findMethod(runtime: RuntimeClass, name: string): RuntimeMethod | undefined {
  return (
    runtime.methods.get(lower(name)) ??
    (runtime.base === undefined ? undefined : findMethod(runtime.base, name))
  );
}

/** Resolves a field up the inheritance chain. */
export function findField(runtime: RuntimeClass, name: string): RuntimeField | undefined {
  return (
    runtime.fields.get(lower(name)) ??
    (runtime.base === undefined ? undefined : findField(runtime.base, name))
  );
}

/** Every field on the class and its bases, for instance construction and for Locals. */
export function allFields(runtime: RuntimeClass): RuntimeField[] {
  const inheritedFields = runtime.base === undefined ? [] : allFields(runtime.base);
  // Own fields last so a redeclaration shadows the inherited one, as the lookup does.
  return [...inheritedFields, ...runtime.fields.values()];
}

export function isSubclassOf(candidate: RuntimeClass, ancestor: RuntimeClass): boolean {
  if (candidate === ancestor) return true;
  return candidate.base === undefined ? false : isSubclassOf(candidate.base, ancestor);
}

/**
 * Whether code executing inside `caller` may reach a member declared in `declaringClass`.
 *
 * `caller` is `undefined` at the top level — a job, or the playground — which is outside
 * every class and therefore sees only public members. That is exactly right: a script is
 * a consumer of your class, and if it can reach a private field then `private` means
 * nothing.
 *
 * VB-039 falls out of this without a special case: two methods of the same class share a
 * `caller`, so every level resolves to true between them.
 */
export function canAccess(
  access: Access,
  declaringClass: RuntimeClass,
  caller: RuntimeClass | undefined,
): boolean {
  if (access === "public") return true;
  if (caller === undefined) return false;
  if (access === "private") return caller === declaringClass;
  return isSubclassOf(caller, declaringClass);
}
