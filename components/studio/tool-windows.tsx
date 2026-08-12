"use client";

/**
 * The panes along the bottom of the Studio: Output, Error List, and the debugger's
 * windows.
 *
 * These are the windows a developer actually lives in, and each is here because it teaches
 * something the code editor alone cannot:
 *
 * - **Locals** expands a table buffer to its fields, which is where VB-024 becomes visible.
 * - **Autos** shows the transaction level, which makes `ttsbegin` a thing you can watch
 *   rather than a keyword you take on trust.
 * - **Breakpoints** shows the hit counts, so a conditional breakpoint's behaviour is
 *   legible instead of mysterious.
 */

import { useState } from "react";
import type { InfologEntry } from "@xpplab/xpp-core";
import type { Breakpoint, DebugPause, DebugVariable } from "@xpplab/xpp-runtime";
import type { BuildMessage } from "@xpplab/virtual-aot";

export function Output({ lines }: { lines: string[] }) {
  return (
    <pre
      data-testid="output-pane"
      className="h-full overflow-auto p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300"
    >
      {lines.length === 0 ? (
        <span className="text-zinc-600">
          Nothing built yet. Build &gt; Build, or the Dynamics 365 menu.
        </span>
      ) : (
        lines.join("\n")
      )}
    </pre>
  );
}

export function ErrorList({ messages }: { messages: BuildMessage[] }) {
  if (messages.length === 0) {
    return <Empty>No errors or warnings.</Empty>;
  }

  return (
    <table className="w-full font-mono text-[11px]" data-testid="error-list">
      <thead>
        <tr className="border-b border-zinc-800 text-left text-zinc-500">
          <th className="px-2 py-1 font-normal">Severity</th>
          <th className="px-2 py-1 font-normal">Description</th>
          <th className="px-2 py-1 font-normal">Element</th>
        </tr>
      </thead>
      <tbody>
        {messages.map((message, index) => (
          <tr key={`${message.element}-${index}`} className="border-b border-zinc-900/70">
            <td
              className={`px-2 py-1 align-top ${
                message.severity === "error" ? "text-red-400" : "text-amber-400"
              }`}
            >
              {message.severity === "error" ? "Error" : "Warning"}
            </td>
            <td className="px-2 py-1 align-top text-zinc-300">{message.message}</td>
            <td className="px-2 py-1 align-top text-zinc-500">{message.element}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Locals({ pause }: { pause?: DebugPause }) {
  if (pause === undefined) return <Empty>Not debugging. Press F5 to start.</Empty>;
  if (pause.locals.length === 0) {
    return <Empty>No variables are in scope yet.</Empty>;
  }

  return (
    <div className="p-1 font-mono text-[11px]" data-testid="locals-pane">
      {pause.locals.map((local) => (
        <LocalRow key={local.name} local={local} />
      ))}
    </div>
  );
}

function LocalRow({ local }: { local: DebugVariable }) {
  const [open, setOpen] = useState(false);
  const expandable = local.fields !== undefined && local.fields.length > 0;

  return (
    <div>
      <div
        className="flex cursor-default items-baseline gap-2 px-1 py-px hover:bg-zinc-800/60"
        onClick={() => expandable && setOpen((current) => !current)}
        data-testid={`local-${local.name}`}
      >
        <span className="w-2 text-[9px] text-zinc-500">{expandable ? (open ? "▾" : "▸") : ""}</span>
        <span className="text-zinc-300">{local.name}</span>
        <span className="text-zinc-600">{local.typeName}</span>
        <span className="ml-auto truncate text-sky-300">{local.value || "—"}</span>
      </div>

      {open && local.fields !== undefined && (
        <div className="ml-5 border-l border-zinc-800 pl-2">
          {local.fields.map((field) => (
            <div
              key={field.name}
              className="flex items-baseline gap-2 px-1 py-px"
              data-testid={`local-field-${local.name}-${field.name}`}
            >
              <span className={field.selected ? "text-zinc-400" : "text-zinc-600"}>
                {field.name}
              </span>
              <span
                className={`ml-auto ${field.selected ? "text-sky-300" : "text-zinc-600 italic"}`}
                title={
                  field.selected
                    ? undefined
                    : "This field was not in the select statement's field list, so the debugger shows null. The variable really holds its type's default — it is a debugging artifact, not a value from the database."
                }
              >
                {field.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Autos window (VB-023).
 *
 * The real one lists four things. We simulate two, and the other two are shown greyed and
 * labelled rather than filled with an invented value or quietly dropped — a learner should
 * know the window has them. See CLAUDE.md > Fidelity rule.
 */
export function Autos({ pause }: { pause?: DebugPause }) {
  if (pause === undefined) return <Empty>Not debugging. Press F5 to start.</Empty>;

  return (
    <table className="w-full font-mono text-[11px]" data-testid="autos-pane">
      <tbody>
        <AutoRow label="Company" value={pause.autos.company} />
        <AutoRow label="Transaction level" value={String(pause.autos.transactionLevel)} />
        <AutoRow label="Partition" value="not simulated" muted />
        <AutoRow label="User ID" value="not simulated" muted />
      </tbody>
    </table>
  );
}

function AutoRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <tr className="border-b border-zinc-900/70 last:border-0">
      <td className="px-2 py-0.5 text-zinc-400">{label}</td>
      <td className={`px-2 py-0.5 ${muted ? "text-zinc-600 italic" : "text-sky-300"}`}>{value}</td>
    </tr>
  );
}

export function CallStack({ pause }: { pause?: DebugPause }) {
  if (pause === undefined) return <Empty>Not debugging. Press F5 to start.</Empty>;

  return (
    <div className="p-1 font-mono text-[11px]" data-testid="call-stack-pane">
      {pause.callStack.map((frame, index) => (
        <div key={`${frame.name}-${index}`} className="flex gap-2 px-1 py-px">
          <span className="text-amber-400">{index === 0 ? "▸" : " "}</span>
          <span className="text-zinc-300">{frame.name}</span>
          <span className="ml-auto text-zinc-500">line {frame.line}</span>
        </div>
      ))}
      <p className="mt-2 px-1 text-[10px] text-zinc-600 italic">
        One frame: this engine runs a top-level script and does not yet call user-defined methods,
        so there is nothing deeper to step into.
      </p>
    </div>
  );
}

export function Breakpoints({
  breakpoints,
  hits,
  onToggle,
  onRemove,
}: {
  breakpoints: Breakpoint[];
  hits: Record<number, number>;
  onToggle: (line: number) => void;
  onRemove: (line: number) => void;
}) {
  if (breakpoints.length === 0) {
    return <Empty>No breakpoints. Click the left margin of the editor, or press F9.</Empty>;
  }

  return (
    <table className="w-full font-mono text-[11px]" data-testid="breakpoints-pane">
      <tbody>
        {breakpoints.map((breakpoint) => (
          <tr key={breakpoint.line} className="border-b border-zinc-900/70 last:border-0">
            <td className="w-6 px-2 py-0.5">
              <input
                type="checkbox"
                checked={breakpoint.enabled !== false}
                onChange={() => onToggle(breakpoint.line)}
                aria-label={`Breakpoint on line ${breakpoint.line}`}
                className="accent-red-500"
              />
            </td>
            <td className="px-2 py-0.5 text-zinc-300">Line {breakpoint.line}</td>
            <td className="px-2 py-0.5 text-zinc-500">
              {breakpoint.condition === undefined ? "" : `when ${breakpoint.condition}`}
              {breakpoint.hitCount === undefined ? "" : ` every ${breakpoint.hitCount} hits`}
            </td>
            <td className="px-2 py-0.5 text-right text-zinc-500">
              {hits[breakpoint.line] ?? 0} hit{(hits[breakpoint.line] ?? 0) === 1 ? "" : "s"}
            </td>
            <td className="w-6 px-2 py-0.5">
              <button
                type="button"
                onClick={() => onRemove(breakpoint.line)}
                aria-label={`Remove the breakpoint on line ${breakpoint.line}`}
                className="text-zinc-600 hover:text-red-400"
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** View > Infolog — the F&O-specific debugger window. */
export function Infolog({ entries }: { entries: InfologEntry[] }) {
  if (entries.length === 0) return <Empty>Nothing logged yet.</Empty>;

  const colour = (type: InfologEntry["type"]): string =>
    type === "error" ? "text-red-400" : type === "warning" ? "text-amber-400" : "text-zinc-300";

  return (
    <ul className="p-2 font-mono text-[11px]" data-testid="studio-infolog">
      {entries.map((entry, index) => (
        <li key={index} className={`flex gap-2 ${colour(entry.type)}`}>
          <span className="w-12 shrink-0 text-zinc-600">{entry.type}</span>
          <span className="break-all">{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-2 font-mono text-[11px] text-zinc-600">{children}</p>;
}
