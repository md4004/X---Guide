/**
 * The landing page. Still thin: it says what the product is, points at the first lesson
 * and the sandbox, and shows how far the build has got.
 */

import Link from "next/link";

type PhaseStatus = "done" | "next" | "todo";

/** Declared, rather than inferred from the array, so retiring the last `todo` compiles. */
const statusStyles: Record<PhaseStatus, string> = {
  done: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  next: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  todo: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
};

const phases: { id: number; name: string; status: PhaseStatus }[] = [
  { id: 0, name: "Scaffold", status: "done" },
  { id: 1, name: "Virtual database", status: "done" },
  { id: 2, name: "Lexer and parser", status: "done" },
  { id: 3, name: "Interpreter", status: "done" },
  { id: 4, name: "Playground UI", status: "done" },
  { id: 5, name: "Lesson engine", status: "done" },
  { id: 6, name: "X++ for NAV/BC developers", status: "next" },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-24">
      <header className="flex flex-col gap-4">
        {/* No `uppercase` here — it would render the brand as X++LAB. */}
        <p className="font-mono text-xs tracking-widest text-sky-400">X++Lab</p>
        <h1 className="text-4xl font-semibold text-balance">
          Learn X++ by running it, not by reading about it.
        </h1>
        <p className="text-lg text-pretty text-zinc-400">
          Write real X++ in the browser and immediately see what it did — the Infolog, the rows that
          changed, and the SQL your <code className="font-mono text-zinc-300">while select</code>{" "}
          actually generated. Built for developers arriving from Dynamics NAV and Business Central.
        </p>

        <p className="flex flex-wrap gap-3">
          <Link
            href="/learn/xpp-for-nav-devs/02-buffers-and-select"
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 transition hover:bg-sky-400"
          >
            Start the first lesson
          </Link>
          <Link
            href="/playground"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Open the sandbox
          </Link>
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Build status</h2>
        <ul className="flex flex-col gap-2">
          {phases.map((phase) => (
            <li
              key={phase.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-zinc-600">Phase {phase.id}</span>
                <span className="text-sm text-zinc-200">{phase.name}</span>
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ${statusStyles[phase.status]}`}
              >
                {phase.status}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
