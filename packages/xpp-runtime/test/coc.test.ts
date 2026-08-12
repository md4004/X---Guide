/**
 * Chain of Command, asserted against VB-061 to VB-067.
 *
 * The rules here are almost all *compile-time* in a real environment, and that matters as
 * much as the rules themselves. A learner who meets "you must call next" when the code
 * runs has been taught that this is a runtime concern; it is not, and the difference
 * changes how they work.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVirtualDb, type VirtualDb } from "@xpplab/virtual-db";
import { runSource } from "../src";

let db: VirtualDb;

beforeEach(async () => {
  db = createVirtualDb();
  await db.init();
});

afterEach(async () => {
  await db.close();
});

const run = (source: string) => runSource({ source, db });
const messages = async (source: string) =>
  (await run(source)).infolog.map((entry) => entry.message);
const failure = async (source: string) => {
  const result = await run(source);
  return `${result.errors[0]?.message ?? ""} ${result.errors[0]?.hint ?? ""}`;
};

const BASE = `
class Greeter
{
    public str speak()
    {
        return "base";
    }
}
`;

describe("wrapping a method", () => {
  it("runs the wrapper around the original", async () => {
    expect(
      await messages(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        str result = next speak();
        return result + " and extension";
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`),
    ).toEqual(["base and extension"]);
  });

  it("chains more than one wrapper, ending at the original", async () => {
    const logged = await messages(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_ExtensionA
{
    public str speak()
    {
        info("A before");
        str result = next speak();
        info("A after");
        return result;
    }
}

[ExtensionOf(classStr(Greeter))]
final class Greeter_ExtensionB
{
    public str speak()
    {
        info("B before");
        str result = next speak();
        info("B after");
        return result;
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`);

    // Both wrappers ran, and the original's answer came back through both of them.
    // Which of A and B ran first is deliberately not asserted — see VB-063.
    expect(logged).toContain("A before");
    expect(logged).toContain("B before");
    expect(logged).toContain("base");
  });

  // VB-067 — the defect the lesson is built around.
  it("silently discards the rest of the chain when next's result is ignored", async () => {
    expect(
      await messages(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        next speak();
        return "mine only";
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`),
    ).toEqual(["mine only"]);
  });

  it("passes changed arguments down the chain", async () => {
    expect(
      await messages(`
class Doubler
{
    public int twice(int _value)
    {
        return _value * 2;
    }
}

[ExtensionOf(classStr(Doubler))]
final class Doubler_Extension
{
    public int twice(int _value)
    {
        return next twice(_value + 1);
    }
}

Doubler doubler = new Doubler();
info(int2Str(doubler.twice(10)));
`),
    ).toEqual(["22"]);
  });

  // VB-066
  it("wraps a base method through an extension of the derived class only", async () => {
    const logged = await messages(`
class Animal
{
    public str salute()
    {
        return "Hi";
    }
}

class Dog extends Animal
{
}

class Cat extends Animal
{
}

[ExtensionOf(classStr(Dog))]
final class Dog_Extension
{
    public str salute()
    {
        return next salute() + " from the dog extension";
    }
}

Animal animal = new Animal();
Dog dog = new Dog();
Cat cat = new Cat();

info(animal.salute());
info(dog.salute());
info(cat.salute());
`);

    expect(logged).toEqual(["Hi", "Hi from the dog extension", "Hi"]);
  });
});

describe("the rules, enforced before anything runs", () => {
  // VB-062
  it("requires the extension class to be final", async () => {
    expect(
      await failure(`${BASE}
[ExtensionOf(classStr(Greeter))]
class Greeter_Extension
{
    public str speak()
    {
        return next speak();
    }
}
`),
    ).toContain("must be declared `final`");
  });

  // VB-061 — the headline rule.
  it("refuses a wrapper that never calls next", async () => {
    const message = await failure(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        return "replaced";
    }
}
`);

    expect(message).toContain("never calls `next`");
    expect(message).toContain("silently replaced everyone else's code");
  });

  it("refuses a next that hides inside an if", async () => {
    // The compiler's rule is that `next` has to be a first-level statement, because it
    // must be able to guarantee the rest of the chain runs.
    const message = await failure(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        if (true)
        {
            return next speak();
        }

        return "";
    }
}
`);

    expect(message).toContain("not as a first-level statement");
    expect(message).toContain("cannot sit inside an `if`");
  });

  it("allows a next inside a try, which the platform permits", async () => {
    expect(
      await messages(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        str result;

        try
        {
            result = next speak();
        }
        catch (Exception::Error)
        {
            result = "failed";
        }

        return result + " guarded";
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`),
    ).toEqual(["base guarded"]);
  });

  // VB-064
  it("refuses to wrap a private method", async () => {
    expect(
      await failure(`
class Vault
{
    private str secret()
    {
        return "shhh";
    }
}

[ExtensionOf(classStr(Vault))]
final class Vault_Extension
{
    private str secret()
    {
        return next secret();
    }
}
`),
    ).toContain("is private, so it cannot be wrapped");
  });

  // VB-065
  it("refuses to wrap a final method unless it opts in", async () => {
    expect(
      await failure(`
class Sealed
{
    final public str name()
    {
        return "sealed";
    }
}

[ExtensionOf(classStr(Sealed))]
final class Sealed_Extension
{
    public str name()
    {
        return next name();
    }
}
`),
    ).toContain("is final, so it cannot be wrapped");

    expect(
      await messages(`
class Sealed
{
    [Wrappable(true)]
    final public str name()
    {
        return "sealed";
    }
}

[ExtensionOf(classStr(Sealed))]
final class Sealed_Extension
{
    public str name()
    {
        return next name() + " but wrappable";
    }
}

Sealed sealed = new Sealed();
info(sealed.name());
`),
    ).toEqual(["sealed but wrappable"]);
  });

  it("honours [Hookable(false)]", async () => {
    expect(
      await failure(`
class Closed
{
    [Hookable(false)]
    public str name()
    {
        return "closed";
    }
}

[ExtensionOf(classStr(Closed))]
final class Closed_Extension
{
    public str name()
    {
        return next name();
    }
}
`),
    ).toContain("[Hookable(false)]");
  });

  it("lets a [Replaceable] method be wrapped without calling next", async () => {
    // The one documented exception: the compiler does not enforce `next` for a method its
    // owner marked replaceable, because breaking the chain is the point of the attribute.
    expect(
      await messages(`
class Swappable
{
    [Replaceable]
    public str name()
    {
        return "original";
    }
}

[ExtensionOf(classStr(Swappable))]
final class Swappable_Extension
{
    public str name()
    {
        return "replaced";
    }
}

Swappable swappable = new Swappable();
info(swappable.name());
`),
    ).toEqual(["replaced"]);
  });

  it("refuses a wrapper for a method the target does not have", async () => {
    expect(
      await failure(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str shout()
    {
        return next shout();
    }
}
`),
    ).toContain("wraps nothing");
  });

  it("names the target when [ExtensionOf] points at nothing", async () => {
    expect(
      await failure(`
[ExtensionOf(classStr(NoSuchClass))]
final class Missing_Extension
{
    public str speak()
    {
        return next speak();
    }
}
`),
    ).toContain("which does not exist");
  });

  it("refuses `next` outside a wrapper", async () => {
    expect(
      await failure(`
class Plain
{
    public str speak()
    {
        return next speak();
    }
}

Plain plain = new Plain();
info(plain.speak());
`),
    ).toContain("only available inside a Chain of Command wrapper");
  });
});

describe("the resolved chain, for the visualiser", () => {
  it("reports the wrappers and the base, with the base last", async () => {
    const result = await run(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_Extension
{
    public str speak()
    {
        return next speak();
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`);

    expect(result.chains).toHaveLength(1);
    expect(result.chains?.[0]).toEqual({
      target: "Greeter",
      methodName: "speak",
      links: [
        { kind: "wrapper", declaringClass: "Greeter_Extension", methodName: "speak" },
        { kind: "base", declaringClass: "Greeter", methodName: "speak" },
      ],
      // One wrapper: there is nothing for it to be ordered against.
      orderIsUndefined: false,
    });
  });

  it("marks the order as undefined as soon as two wrappers compete", async () => {
    // VB-063. This flag is the whole reason the diagram is honest: with two extensions in
    // play, nothing in the product promises which runs first, so the visualiser must not
    // draw one.
    const result = await run(`${BASE}
[ExtensionOf(classStr(Greeter))]
final class Greeter_ExtensionA
{
    public str speak()
    {
        return next speak();
    }
}

[ExtensionOf(classStr(Greeter))]
final class Greeter_ExtensionB
{
    public str speak()
    {
        return next speak();
    }
}

Greeter greeter = new Greeter();
info(greeter.speak());
`);

    expect(result.chains?.[0]?.orderIsUndefined).toBe(true);
    expect(result.chains?.[0]?.links).toHaveLength(3);
    expect(result.chains?.[0]?.links.at(-1)?.kind).toBe("base");
  });

  it("reports nothing when nothing was wrapped", async () => {
    const result = await run(`${BASE}\nGreeter greeter = new Greeter();\ninfo(greeter.speak());`);
    expect(result.chains).toBeUndefined();
  });
});
