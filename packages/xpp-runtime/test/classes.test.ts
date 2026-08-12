/**
 * Classes and methods, asserted against VB-034 to VB-046.
 *
 * The access rules carry most of the weight here, because two of X++'s defaults are the
 * opposite of the ones people arrive with: an unmarked method is public, and an unmarked
 * field is protected. Both compile silently under the wrong assumption, so a simulator
 * that does not enforce them teaches the wrong language.
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

describe("declaring and using a class", () => {
  it("constructs an instance and calls an instance method", async () => {
    expect(
      await messages(`
class Square
{
    private int side;

    public void new(int _side = 1)
    {
        side = _side;
    }

    public int getArea()
    {
        return side * side;
    }
}

Square square = new Square(15);
info(int2Str(square.getArea()));
`),
    ).toEqual(["225"]);
  });

  it("lets a class be declared after the code that uses it", async () => {
    // X++ has no forward-declaration rule, so neither does this.
    expect(
      await messages(`
Greeter greeter = new Greeter();
info(greeter.greet());

class Greeter
{
    public str greet()
    {
        return "hello";
    }
}
`),
    ).toEqual(["hello"]);
  });

  // VB-042
  it("gives a class with no new method a parameterless default constructor", async () => {
    expect(
      await messages(`
class Bare
{
    public int answer()
    {
        return 42;
    }
}

Bare bare = new Bare();
info(int2Str(bare.answer()));
`),
    ).toEqual(["42"]);
  });

  it("refuses arguments to a class that declares no constructor", async () => {
    expect(
      await failure(`class Bare { public int answer() { return 1; } }\nBare b = new Bare(7);`),
    ).toContain("has no 'new' method");
  });
});

describe("access modifiers", () => {
  // VB-034 — the one that surprises people arriving from C#.
  it("treats a method with no modifier as public", async () => {
    expect(
      await messages(`
class Loose
{
    str shout()
    {
        return "AUDIBLE";
    }
}

Loose loose = new Loose();
info(loose.shout());
`),
    ).toEqual(["AUDIBLE"]);
  });

  // VB-035 — and this is the other one.
  it("treats a field with no modifier as protected, so a job cannot read it", async () => {
    const message = await failure(`
class Point
{
    int x;
}

Point point = new Point();
info(int2Str(point.x));
`);

    expect(message).toContain("protected");
    expect(message).toContain("X++ are protected unless you write `public`");
  });

  it("lets a job read a field that was written public", async () => {
    expect(
      await messages(`
class Point
{
    public int x;
}

Point point = new Point();
point.x = 7;
info(int2Str(point.x));
`),
    ).toEqual(["7"]);
  });

  // VB-038
  it("refuses a private method from outside the class, and says why", async () => {
    const message = await failure(`
class Vault
{
    private str secret()
    {
        return "shhh";
    }
}

Vault vault = new Vault();
info(vault.secret());
`);

    expect(message).toContain("is private in 'Vault'");
    expect(message).toContain("a method with no access modifier is public");
  });

  // VB-039
  it("allows a public method to call a private one on the same class", async () => {
    expect(
      await messages(`
class Vault
{
    private str secret()
    {
        return "shhh";
    }

    public str reveal()
    {
        return this.secret();
    }
}

Vault vault = new Vault();
info(vault.reveal());
`),
    ).toEqual(["shhh"]);
  });

  it("lets a subclass reach a protected member but not a private one", async () => {
    expect(
      await messages(`
class Base
{
    protected str shared()
    {
        return "shared";
    }
}

class Derived extends Base
{
    public str show()
    {
        return this.shared();
    }
}

Derived derived = new Derived();
info(derived.show());
`),
    ).toEqual(["shared"]);

    expect(
      await failure(`
class Base
{
    private str hidden()
    {
        return "hidden";
    }
}

class Derived extends Base
{
    public str show()
    {
        return this.hidden();
    }
}

Derived derived = new Derived();
info(derived.show());
`),
    ).toContain("is private in 'Base'");
  });
});

describe("static", () => {
  // VB-040
  it("calls a static method on the class", async () => {
    expect(
      await messages(`
class MathHelp
{
    public static int twice(int _value)
    {
        return _value * 2;
    }
}

info(int2Str(MathHelp::twice(21)));
`),
    ).toEqual(["42"]);
  });

  it("refuses a static method called on an instance, and names the fix", async () => {
    const message = await failure(`
class MathHelp
{
    public static int twice(int _value)
    {
        return _value * 2;
    }
}

MathHelp helper = new MathHelp();
info(int2Str(helper.twice(1)));
`);

    expect(message).toContain("is static");
    expect(message).toContain("MathHelp::twice");
  });

  it("refuses an instance method called on the class", async () => {
    expect(
      await failure(`
class Counter
{
    public int value()
    {
        return 1;
    }
}

info(int2Str(Counter::value()));
`),
    ).toContain("needs an object to run on");
  });

  it("shares one static field across every instance", async () => {
    // Two objects, one counter. This is the difference between static and instance state,
    // and it is invisible until you look at exactly this.
    expect(
      await messages(`
class Tally
{
    public static int total;

    public void add(int _n)
    {
        total = total + _n;
    }

    public static int report()
    {
        return total;
    }
}

Tally first = new Tally();
Tally second = new Tally();
first.add(3);
second.add(4);
info(int2Str(Tally::report()));
`),
    ).toEqual(["7"]);
  });

  // VB-041
  it("refuses `this` in a static method", async () => {
    const message = await failure(`
class Odd
{
    public int side;

    public static int broken()
    {
        return this.side;
    }
}

info(int2Str(Odd::broken()));
`);

    expect(message).toContain("`this` is not available here");
    expect(message).toContain("static method");
  });
});

describe("return types", () => {
  // VB-037
  it("returns the type's default when execution falls off the end", async () => {
    expect(
      await messages(`
class Silent
{
    public int nothing()
    {
    }
}

Silent silent = new Silent();
info(int2Str(silent.nothing()));
`),
    ).toEqual(["0"]);
  });

  it("accepts a bare return in a void method", async () => {
    expect(
      await messages(`
class Early
{
    public void speak(boolean _quiet)
    {
        if (_quiet)
        {
            return;
        }

        info("loud");
    }
}

Early early = new Early();
early.speak(true);
early.speak(false);
`),
    ).toEqual(["loud"]);
  });
});

describe("inheritance", () => {
  it("inherits methods and fields from the base class", async () => {
    expect(
      await messages(`
class Animal
{
    protected str name;

    public void new(str _name = "thing")
    {
        name = _name;
    }

    public str describe()
    {
        return name;
    }
}

class Dog extends Animal
{
}

Dog dog = new Dog("Rex");
info(dog.describe());
`),
    ).toEqual(["Rex"]);
  });

  it("runs the override, and super() reaches the base's version", async () => {
    expect(
      await messages(`
class Animal
{
    public str speak()
    {
        return "...";
    }
}

class Dog extends Animal
{
    public str speak()
    {
        return super() + " woof";
    }
}

Dog dog = new Dog();
info(dog.speak());
`),
    ).toEqual(["... woof"]);
  });

  // VB-044
  it("refuses an override that narrows access", async () => {
    expect(
      await failure(`
class Base
{
    public str name()
    {
        return "base";
    }
}

class Derived extends Base
{
    private str name()
    {
        return "derived";
    }
}

info("unreached");
`),
    ).toContain("An override cannot narrow access");
  });

  it("refuses an override of a final method", async () => {
    expect(
      await failure(`
class Base
{
    final public str name()
    {
        return "base";
    }
}

class Derived extends Base
{
    public str name()
    {
        return "derived";
    }
}

info("unreached");
`),
    ).toContain("cannot be overridden");
  });

  it("answers `is` against the whole chain", async () => {
    expect(
      await messages(`
class Animal
{
}

class Dog extends Animal
{
}

Dog dog = new Dog();
Animal animal = new Animal();

if (dog is Animal)
{
    info("a Dog is an Animal");
}

if (!(animal is Dog))
{
    info("an Animal is not a Dog");
}
`),
    ).toEqual(["a Dog is an Animal", "an Animal is not a Dog"]);
  });

  it("refuses to instantiate an abstract class", async () => {
    expect(
      await failure(`
abstract class Shape
{
}

Shape shape = new Shape();
`),
    ).toContain("is abstract");
  });
});

describe("the parm convention", () => {
  // VB-045: the optional parameter defaulting to the field is what makes one method do
  // both jobs, and it is the single most common shape in the whole codebase.
  it("reads with no argument and writes with one", async () => {
    expect(
      await messages(`
class Contract
{
    private str account;

    public str parmAccount(str _account = account)
    {
        account = _account;
        return account;
    }
}

Contract contract = new Contract();
contract.parmAccount("C-1000");
info(contract.parmAccount());
`),
    ).toEqual(["C-1000"]);
  });
});

describe("safety", () => {
  it("stops unbounded recursion with a teaching error rather than a stack overflow", async () => {
    const result = await run(`
class Endless
{
    public int down(int _n)
    {
        return this.down(_n + 1);
    }
}

Endless endless = new Endless();
info(int2Str(endless.down(0)));
`);

    expect(result.errors[0]?.message).toContain("Call depth");
    expect(result.errors[0]?.hint).toContain("recursion");
  });

  it("refuses two classes with the same name", async () => {
    expect(await failure(`class Twice { }\nclass twice { }`)).toContain("already a class called");
  });

  it("refuses to extend something that does not exist", async () => {
    expect(await failure(`class Orphan extends Missing { }`)).toContain("does not exist");
  });
});

describe("the debugger sees method frames", () => {
  it("puts the running method on the call stack", async () => {
    const frames: string[][] = [];

    await runSource({
      source: `
class Deep
{
    public void inner()
    {
        info("here");
    }

    public void wrapper()
    {
        this.inner();
    }
}

Deep deep = new Deep();
deep.wrapper();
`,
      db,
      entryPoint: "Job.main",
      debug: {
        breakpoints: () => [{ line: 6 }],
        onPause: async (pause) => {
          frames.push(pause.callStack.map((frame) => frame.name));
          return "continue";
        },
      },
    });

    // Innermost first: the info() call inside inner, called from wrapper, called from the job.
    expect(frames[0]).toEqual(["Deep.inner", "Deep.wrapper", "Job.main"]);
  });
});
