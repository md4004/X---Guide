import Link from "next/link";
import type { Metadata } from "next";
import { orderedScenarioSlugs, scenarios } from "@/content/scenarios";

export const metadata: Metadata = {
  title: "Scenarios — X++Lab",
  description:
    "A whole job rather than one construct: somebody asks you for something, you work out what they meant, build it, prove it, and get it to production.",
};

export default function ScenariosPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="font-mono text-xs tracking-widest text-sky-400">
        X++Lab
      </Link>

      <h1 className="mt-6 text-2xl font-semibold text-zinc-50">Scenarios</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
        A lesson teaches one construct. A scenario is a job. Somebody asks you for something
        in the words they actually use, you work out the three things they did not say, you
        build it, you prove it to the person who asked, and then you get it through the
        gates into production.
      </p>

      <ul className="mt-8 space-y-3">
        {orderedScenarioSlugs.map((slug) => {
          const scenario = scenarios[slug]!;
          return (
            <li key={slug}>
              <Link
                href={`/scenarios/${slug}`}
                data-testid={`scenario-${slug}`}
                className="block rounded border border-zinc-800 bg-zinc-900/40 px-4 py-3.5 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-medium text-zinc-100">{scenario.title}</h2>
                  <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                    {scenario.estimatedMinutes} min
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{scenario.summary}</p>
                <p className="mt-2 font-mono text-[10px] tracking-widest text-zinc-600 uppercase">
                  brief → build → test → release
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
