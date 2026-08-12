/**
 * The landing page.
 *
 * Deliberately says nothing about how the product is built. Build status belongs in
 * PLAN.md, where the person building it looks — not in front of someone who came here to
 * learn X++.
 */

import Link from "next/link";
import { lessons, orderedSlugs, track } from "@/content/tracks/xpp-fundamentals";

const POINTS = [
  {
    title: "Run it, don't read it",
    body: "Every lesson is a code editor with a real engine behind it. Write X++, press Check, and see what it did.",
  },
  {
    title: "See the SQL",
    body: "Every run shows the statements your code generated, in order, with row counts. Most X++ courses never show you this, and it is where the expensive mistakes hide.",
  },
  {
    title: "Real rules, real errors",
    body: "Transactions, record locking and exception handling behave the way they do in a real environment — including the parts that surprise people.",
  },
];

export default function Home() {
  const slugs = orderedSlugs();
  const totalTasks = slugs.reduce((total, slug) => total + lessons[slug]!.tasks.length, 0);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-14 px-6 py-24">
      <header className="flex flex-col gap-5">
        <p className="font-mono text-xs tracking-widest text-sky-400">X++Lab</p>

        <h1 className="text-4xl font-semibold text-balance">
          Learn X++ by running it, not by reading about it.
        </h1>

        <p className="text-lg text-pretty text-zinc-400">
          X++ is the language behind Dynamics 365 Finance &amp; Operations, and it normally takes a
          licensed environment to write a single line of it. Here it runs in your browser — write
          the code, press Check, and see the Infolog, the rows that changed and the SQL it
          generated.
        </p>

        <p className="flex flex-wrap gap-3">
          <Link
            href={`/learn/${track.slug}`}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-5 py-2.5 text-sm font-medium text-sky-950 transition hover:bg-sky-400"
          >
            Start learning
          </Link>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Open the Studio
          </Link>
          <Link
            href="/playground"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Open the sandbox
          </Link>
        </p>

        <p className="font-mono text-xs text-zinc-600">
          {slugs.length} lessons · {totalTasks} exercises · no account, no install
        </p>
      </header>

      <section className="flex flex-col gap-6">
        {POINTS.map((point) => (
          <div key={point.title} className="flex flex-col gap-1.5">
            <h2 className="text-sm font-semibold text-zinc-100">{point.title}</h2>
            <p className="text-sm text-pretty text-zinc-400">{point.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        Everything runs client-side. Your code is never sent anywhere, and your progress is stored
        in this browser.
      </footer>
    </main>
  );
}
