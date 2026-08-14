"use client";

/**
 * The AOT, beside the editor, with a job to do.
 *
 * This is not the Studio — that tool exists to teach the IDE, and a learner who wants it
 * should go there. This is the part of it a developer actually touches while writing a
 * change: find the element, get it into your project so it is editable at all, and read
 * the properties you cannot write the code without.
 *
 * The work list is load-bearing, not decoration. `CustVendorBlocked` is not a name anybody
 * can guess, and the only place in this app that tells you is the property grid on the
 * `Blocked` field. Ticking the item off is the learner noticing that.
 */

import { useCallback, useMemo, useState } from "react";
import {
  addToProject,
  buildApplicationExplorer,
  buildDesigner,
  createProject,
  createVirtualAot,
  isInProject,
  type AotObjectRef,
  type DesignerNode,
  type ProjectState,
  type PropertyOrdering,
} from "@xpplab/virtual-aot";
import type { AotWorkItem } from "@xpplab/scenarios";
import { TreeView } from "@/components/studio/tree-view";
import { PropertiesWindow } from "@/components/studio/properties-window";

export interface AotProgress {
  /** Indices of `aotWork` that are done. */
  done: number[];
}

export function AotPanel({
  work,
  progress,
  onProgress,
}: {
  work: AotWorkItem[];
  progress: AotProgress;
  onProgress: (progress: AotProgress) => void;
}) {
  const [aot] = useState(() => createVirtualAot());
  // Edited in place by addToProject, the way the Studio does it — the version counter
  // below is what tells React the tree needs redrawing.
  const [project] = useState<ProjectState>(() =>
    createProject("HavensdaleCreditHold", "HavensdaleExtensions"),
  );
  const [projectVersion, setProjectVersion] = useState(0);
  const [open, setOpen] = useState<AotObjectRef | undefined>();
  const [selected, setSelected] = useState<DesignerNode | undefined>();
  const [ordering, setOrdering] = useState<PropertyOrdering>("Categorized");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | undefined>();

  const explorer = useMemo(() => buildApplicationExplorer(aot), [aot]);
  const designer = useMemo(
    () => (open === undefined ? undefined : buildDesigner(aot, open)),
    [aot, open],
  );

  /**
   * Marks a work item done when the learner does the thing it asked for.
   *
   * Driven from the actual interaction rather than from a "mark complete" button, because
   * a checklist you can tick without doing the work is a checklist that teaches nothing.
   */
  const complete = useCallback(
    (index: number) => {
      if (progress.done.includes(index)) return;
      onProgress({ done: [...progress.done, index] });
    },
    [onProgress, progress.done],
  );

  const handleAddToProject = useCallback(
    (ref: AotObjectRef) => {
      const result = addToProject(project, ref);
      setProjectVersion((version) => version + 1);

      if (!result.ok) {
        setStatus({ tone: "error", text: result.message });
        return;
      }

      setStatus({ tone: "ok", text: `${ref.name} added to ${project.name}.` });
      work.forEach((item, index) => {
        if (
          item.kind === "addToProject" &&
          item.name.toLowerCase() === ref.name.toLowerCase()
        ) {
          complete(index);
        }
      });
    },
    [complete, project, work],
  );

  const handleSelect = useCallback(
    (node: DesignerNode) => {
      setSelected(node);
      if (open === undefined) return;

      work.forEach((item, index) => {
        if (
          item.kind === "inspect" &&
          item.name.toLowerCase() === open.name.toLowerCase() &&
          node.label.toLowerCase() === item.node.toLowerCase()
        ) {
          complete(index);
        }
      });
    },
    [complete, open, work],
  );

  // Referenced so the memo above re-runs after a mutation to the project object, which is
  // edited in place by `addToProject` the way the Studio does it.
  void projectVersion;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="aot-panel">
      <div className="shrink-0 space-y-1.5 border-b border-zinc-800 px-3 py-2.5">
        <h2 className="font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
          Before you write anything
        </h2>
        <ol className="space-y-1">
          {work.map((item, index) => {
            const done = progress.done.includes(index);
            return (
              <li
                key={index}
                data-testid={`aot-work-${index}`}
                data-done={done}
                className={`flex gap-2 text-xs leading-relaxed ${
                  done ? "text-zinc-500" : "text-zinc-300"
                }`}
              >
                <span className={done ? "text-emerald-400" : "text-zinc-600"}>
                  {done ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  <span className={done ? "line-through" : ""}>{item.prompt}</span>
                  {!done && <span className="mt-0.5 block text-zinc-500">{item.hint}</span>}
                  {done && item.kind === "inspect" && (
                    <span className="mt-0.5 block text-emerald-300/70">{item.takeaway}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_1fr]">
        <section className="flex min-h-0 flex-col border-b border-zinc-800">
          <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-2 py-1">
            <h3 className="text-[11px] font-medium text-zinc-300">
              {open === undefined ? "Application Explorer" : open.name}
            </h3>
            {open !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setOpen(undefined);
                  setSelected(undefined);
                }}
                className="text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                ← back
              </button>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            {/* Distinct keys, because `initiallyExpanded` is read once when the control
                mounts. Without them React reconciles the two trees as one component and
                the designer opens collapsed, with its Fields node hidden. */}
            {open === undefined || designer === undefined ? (
              <TreeView
                key="explorer"
                root={explorer}
                selectedId={selected?.id}
                onSelect={setSelected}
                onActivate={(node) => {
                  if (node.ref === undefined) return;
                  setOpen(node.ref);
                  setSelected(undefined);
                }}
                onContextMenu={(node) => {
                  if (node.ref !== undefined) handleAddToProject(node.ref);
                }}
                // Ids come from buildApplicationExplorer, which roots the tree at "AOT".
                // Opening straight onto the table list saves three clicks the scenario is
                // not about — the Studio is where you learn to navigate the tree.
                initiallyExpanded={["AOT", "AOT/Data Model", "AOT/Data Model/Tables"]}
                badge={(node) =>
                  node.ref !== undefined && isInProject(project, node.ref)
                    ? "in project"
                    : undefined
                }
              />
            ) : (
              <TreeView
                key={`designer-${designer.id}`}
                root={designer}
                selectedId={selected?.id}
                onSelect={handleSelect}
                initiallyExpanded={[designer.id, `${designer.id}/Fields`]}
              />
            )}
          </div>

          <footer className="shrink-0 border-t border-zinc-800 px-2 py-1.5">
            {open === undefined ? (
              <p className="text-[10px] text-zinc-600">
                Double-click an element to open its designer. Right-click it to add it to the
                project — Application Explorer itself only ever views the model.
              </p>
            ) : (
              <p className="text-[10px] text-zinc-600">
                Select a node to read its properties below.
              </p>
            )}
          </footer>
        </section>

        <section className="flex min-h-0 flex-col overflow-auto">
          {selected === undefined ? (
            <p className="px-3 py-3 text-xs text-zinc-600">Nothing selected.</p>
          ) : (
            <PropertiesWindow
              title={selected.label}
              properties={selected.properties ?? []}
              ordering={ordering}
              onOrderingChange={setOrdering}
              onGoTo={(ref) => {
                setOpen(ref);
                setSelected(undefined);
              }}
            />
          )}
        </section>
      </div>

      {status !== undefined && (
        <p
          data-testid="aot-status"
          className={`shrink-0 border-t px-3 py-2 text-xs ${
            status.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/5 text-rose-300"
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}

/** So a caller can ask whether the phase's AOT work is finished. */
export function aotWorkComplete(work: AotWorkItem[], progress: AotProgress): boolean {
  return work.every((_, index) => progress.done.includes(index));
}
