/**
 * Phase 0 landing page. Deliberately thin — it exists so `pnpm build` has something to
 * build and the e2e smoke test has something to load. Phase 4 brings the playground,
 * Phase 6 the guided track.
 */

const phases = [
  { id: 0, name: "Scaffold", status: "done" },
  { id: 1, name: "Virtual database", status: "next" },
  { id: 2, name: "Lexer and parser", status: "todo" },
  { id: 3, name: "Interpreter", status: "todo" },
  { id: 4, name: "Playground UI", status: "todo" },
  { id: 5, name: "Lesson engine", status: "todo" },
  { id: 6, name: "X++ for NAV/BC developers", status: "todo" },
] as const;

const statusStyles: Record<(typeof phases)[number]["status"], string> = {
  done: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  next: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  todo: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
};

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-24">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-xs tracking-widest text-sky-400 uppercase">XppLab</p>
        <h1 className="text-4xl font-semibold text-balance">
          Learn X++ by running it, not by reading about it.
        </h1>
        <p className="text-lg text-pretty text-zinc-400">
          Write real X++ in the browser and immediately see what it did — the Infolog, the rows that
          changed, and the SQL your <code className="font-mono text-zinc-300">while select</code>{" "}
          actually generated. Built for developers arriving from Dynamics NAV and Business Central.
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
