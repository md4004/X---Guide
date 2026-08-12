"use client";

/**
 * The Properties window.
 *
 * Two things make this worth building rather than dumping a JSON blob. The ordering
 * buttons are real (VB-018) and a developer will use them daily. And a property whose
 * value names another element offers **Go to <element>** — which is how anyone reads an
 * unfamiliar table, by hopping from a field to the EDT that defines it.
 */

import { orderProperties, type PropertyOrdering, type PropertyValue } from "@xpplab/virtual-aot";
import type { AotObjectRef } from "@xpplab/virtual-aot";

const ORDERINGS: PropertyOrdering[] = ["Categorized", "Alphabetical", "Changed"];

interface PropertiesWindowProps {
  title: string;
  properties: PropertyValue[];
  ordering: PropertyOrdering;
  onOrderingChange: (ordering: PropertyOrdering) => void;
  onGoTo: (ref: AotObjectRef) => void;
}

export function PropertiesWindow({
  title,
  properties,
  ordering,
  onOrderingChange,
  onGoTo,
}: PropertiesWindowProps) {
  const groups = orderProperties(properties, ordering);

  return (
    <section className="flex min-h-0 flex-col" data-testid="properties-window">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-2 py-1">
        <h2 className="text-[11px] font-medium text-zinc-300">Properties</h2>
        <div className="flex gap-px">
          {ORDERINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onOrderingChange(option)}
              title={`${option} ordering`}
              data-testid={`properties-ordering-${option}`}
              className={`px-1.5 py-0.5 text-[10px] transition ${
                ordering === option
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {option === "Categorized" ? "⊞" : option === "Alphabetical" ? "A↓" : "◐"}
            </button>
          ))}
        </div>
      </header>

      <p className="truncate border-b border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-500">
        {title}
      </p>

      <div className="min-h-0 flex-1 overflow-auto">
        {properties.length === 0 ? (
          <p className="p-2 text-[11px] text-zinc-600">Select a node to see its properties.</p>
        ) : (
          <table className="w-full font-mono text-[11px]">
            <tbody>
              {groups.map((group) => (
                <PropertyGroupRows
                  key={group.label || "all"}
                  label={group.label}
                  properties={group.properties}
                  onGoTo={onGoTo}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function PropertyGroupRows({
  label,
  properties,
  onGoTo,
}: {
  label: string;
  properties: PropertyValue[];
  onGoTo: (ref: AotObjectRef) => void;
}) {
  return (
    <>
      {label !== "" && (
        <tr>
          <th
            colSpan={2}
            className="bg-zinc-900/80 px-2 py-0.5 text-left text-[10px] font-medium text-zinc-500"
          >
            {label}
          </th>
        </tr>
      )}
      {properties.map((property) => (
        <tr key={property.name} className="border-b border-zinc-900/70 last:border-0">
          <td className="w-1/2 px-2 py-0.5 align-top text-zinc-400">
            {property.name}
            {/* A changed property is bolded in the real pane too — it is how you spot at a
                glance what somebody has actually configured. */}
            {property.changed && <span className="ml-1 text-sky-500">•</span>}
          </td>
          <td className="px-2 py-0.5 align-top text-zinc-200">
            {property.goTo === undefined ? (
              <span className="break-all">{property.value || "—"}</span>
            ) : (
              <button
                type="button"
                onClick={() => onGoTo(property.goTo!)}
                title={`Go to ${property.goTo.type} ${property.value}`}
                data-testid={`property-goto-${property.name}`}
                className="break-all text-sky-400 underline decoration-dotted underline-offset-2 hover:text-sky-300"
              >
                {property.value}
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
