"use client";

/**
 * The Chain of Command visualiser.
 *
 * The diagram exists because the call order is the thing nobody explains and everybody
 * gets wrong. Two decisions make it honest rather than merely pretty:
 *
 * **It draws what ran**, not what the source implies. The chain comes back on the run
 * result, collected while the call actually happened.
 *
 * **It refuses to draw an order it does not have.** The moment two extensions wrap the
 * same method, the sequence between them is undefined — Microsoft's own documentation says
 * the system picks "randomly" — so the wrappers are drawn as an unordered set with that
 * stated on the diagram. A confident numbered list would be the single most damaging thing
 * this component could show, because it is the exact assumption the platform denies.
 */

import type { ResolvedChain } from "@xpplab/xpp-runtime";

export function ChainView({ chains }: { chains: ResolvedChain[] }) {
  if (chains.length === 0) {
    return (
      <p className="px-1 text-xs text-zinc-500">
        Nothing was wrapped in this run, so there is no chain to draw.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="chain-view">
      {chains.map((chain) => (
        <Chain key={`${chain.target}.${chain.methodName}`} chain={chain} />
      ))}
    </div>
  );
}

function Chain({ chain }: { chain: ResolvedChain }) {
  const wrappers = chain.links.filter((link) => link.kind === "wrapper");
  const base = chain.links.find((link) => link.kind === "base");

  return (
    <section data-testid={`chain-${chain.target}.${chain.methodName}`}>
      <h3 className="font-mono text-xs text-zinc-300">
        {chain.target}.{chain.methodName}()
      </h3>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {wrappers.length} wrapper{wrappers.length === 1 ? "" : "s"}, then the original.
      </p>

      <ol className="mt-3 flex flex-col gap-1.5">
        {wrappers.map((link, index) => (
          <li key={`${link.declaringClass}-${index}`} className="flex items-center gap-2">
            <Arrow />
            <span className="flex-1 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] text-sky-200">
              {link.declaringClass}.{link.methodName}()
              <span className="ml-2 text-[10px] text-sky-400/70">extension</span>
            </span>
          </li>
        ))}

        {base !== undefined && (
          <li className="flex items-center gap-2">
            <Arrow />
            <span className="flex-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] text-emerald-200">
              {base.declaringClass}.{base.methodName}()
              <span className="ml-2 text-[10px] text-emerald-400/70">original</span>
            </span>
          </li>
        )}
      </ol>

      {chain.orderIsUndefined && (
        <p
          data-testid="chain-order-warning"
          className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          <strong className="font-medium">The order of these wrappers is not defined.</strong>{" "}
          With more than one extension on the same method, the platform picks which runs
          first — and it does not promise the same answer twice. They are listed here in the
          order they were declared because something had to go first. Code that depends on
          being first or last is already broken.
        </p>
      )}
    </section>
  );
}

function Arrow() {
  return <span className="w-3 shrink-0 text-center text-[10px] text-zinc-600">↓</span>;
}
