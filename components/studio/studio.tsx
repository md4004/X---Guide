"use client";

/**
 * The Studio — a simulated Visual Studio with the finance and operations developer tools.
 *
 * The layout is the real one: Application Explorer on the left, the designer or code
 * editor in the middle, Solution Explorer over Properties on the right, tool windows along
 * the bottom. Every menu path, command name and shortcut traces to a row in
 * docs/verified-behaviour.md — VB-015 to VB-026 — because a learner who memorises a
 * command that does not exist has been taught something false.
 *
 * Two things are deliberately not faked. Application Explorer really cannot edit anything
 * (VB-015), so trying to add a field from there fails with the same explanation the real
 * tool would give you. And the build reports honestly which of its steps it performs, so
 * nobody leaves believing their X++ was compiled to IL in a browser tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  addField,
  addToProject,
  build,
  buildApplicationExplorer,
  buildDesigner,
  createProject,
  createVirtualAot,
  isInProject,
  markSynchronised,
  planSynchronisation,
  type AotObjectRef,
  type BuildMessage,
  type DesignerNode,
  type FieldMetadata,
  type PropertyOrdering,
  type ProjectState,
} from "@xpplab/virtual-aot";
import type { Breakpoint, DebugCommand, DebugPause } from "@xpplab/xpp-runtime";
import { useEngine, type RunOutcome } from "@/lib/use-engine";
import { TreeView } from "./tree-view";
import { ContextMenu, type ContextCommand } from "./context-menu";
import { PropertiesWindow } from "./properties-window";
import { Autos, Breakpoints, CallStack, ErrorList, Infolog, Locals, Output } from "./tool-windows";

const CodeWindow = dynamic(() => import("./code-window").then((module) => module.CodeWindow), {
  ssr: false,
  loading: () => <span className="p-4 font-mono text-xs text-zinc-500">Loading the editor…</span>,
});

const STARTUP_OBJECT = "XppLabTutorial";

/**
 * The code the Studio opens with.
 *
 * Chosen so the first breakpoint someone sets teaches something: a loop, a transaction and
 * a buffer, which between them light up Locals, Autos and the SQL trace.
 */
const STARTER = `// Put a breakpoint on the update line, then press F5.
// Watch inventTable expand in Locals, and ttsLevel move in Autos.
InventTable inventTable;
int counter;

ttsbegin;
while select forupdate inventTable
    where inventTable.ItemGroupId == "FURNITURE"
{
    inventTable.Blocked = NoYes::Yes;
    inventTable.update();
    counter++;
}
ttscommit;

info(strFmt("Blocked %1 items", counter));
`;

type BottomTab = "output" | "errors" | "locals" | "autos" | "callStack" | "breakpoints" | "infolog";
type CentreTab = "code" | "designer";

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: "output", label: "Output" },
  { id: "errors", label: "Error List" },
  { id: "locals", label: "Locals" },
  { id: "autos", label: "Autos" },
  { id: "callStack", label: "Call Stack" },
  { id: "breakpoints", label: "Breakpoints" },
  { id: "infolog", label: "Infolog" },
];

export function Studio() {
  const { debug, resume, busy } = useEngine();

  /**
   * The AOT and the project are both mutable — adding a field really changes the model —
   * so they are held in state beside a version counter rather than deep-cloned on every
   * edit. Bumping the counter is what tells React the tree it rendered is stale; the
   * identity of `aot` deliberately never changes, because the engine and the designer have
   * to be looking at the same object or the property grid could disagree with the runtime.
   */
  const [model, setModel] = useState(() => ({ aot: createVirtualAot(), version: 0 }));
  const aot = model.aot;
  const revision = model.version;
  const touch = useCallback(
    () => setModel((current) => ({ ...current, version: current.version + 1 })),
    [],
  );

  const [project, setProject] = useState<ProjectState>(() =>
    createProject("XppLabTutorial", "XppLabTutorial"),
  );
  /** Mutated in place by the project helpers, then given a fresh identity for React. */
  const touchProject = useCallback(() => setProject((current) => ({ ...current })), []);

  const [filter, setFilter] = useState("");
  const [openElement, setOpenElement] = useState<AotObjectRef | undefined>();
  const [selectedNode, setSelectedNode] = useState<DesignerNode | undefined>();
  const [ordering, setOrdering] = useState<PropertyOrdering>("Categorized");
  const [centreTab, setCentreTab] = useState<CentreTab>("code");
  const [bottomTab, setBottomTab] = useState<BottomTab>("output");
  const [status, setStatus] = useState("Ready");

  const [source, setSource] = useState(STARTER);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [pause, setPause] = useState<DebugPause | undefined>();
  const [hits, setHits] = useState<Record<number, number>>({});
  const [outcome, setOutcome] = useState<RunOutcome | undefined>();
  const [output, setOutput] = useState<string[]>([]);
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [contextMenu, setContextMenu] = useState<
    { node: DesignerNode; x: number; y: number } | undefined
  >();

  // Resuming has to send the breakpoints as they are *now*, and the F5 key handler is
  // registered once, so both reach the current list through a ref.
  const breakpointsRef = useRef(breakpoints);
  useEffect(() => {
    breakpointsRef.current = breakpoints;
  }, [breakpoints]);

  const explorer = useMemo(
    () => buildApplicationExplorer(aot, filter),
    // `revision` is the dependency that matters: the model is mutable, so nothing else
    // changes identity when a field is added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aot, filter, revision],
  );

  const designer = useMemo(
    () => (openElement === undefined ? undefined : buildDesigner(aot, openElement)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aot, openElement, revision],
  );

  const solution = useMemo<DesignerNode>(
    () => ({
      id: "solution",
      label: `Solution 'XppLab' (1 project)`,
      kind: "folder",
      properties: [],
      children: [
        {
          id: "project",
          label: project.name,
          kind: "folder",
          properties: [
            { name: "Model", value: project.model, category: "General", changed: false },
            {
              name: "Startup Object",
              value: STARTUP_OBJECT,
              category: "General",
              changed: true,
            },
            // VB-026: a startup object is a form, a class with `main`, or a menu item.
            { name: "Startup Object Type", value: "Class", category: "General", changed: true },
            // VB-021.
            {
              name: "Synchronize database on build",
              value: project.properties.synchronizeDatabaseOnBuild ? "True" : "False",
              category: "Behavior",
              changed: !project.properties.synchronizeDatabaseOnBuild,
            },
          ],
          children: project.elements.map((ref) => ({
            id: `project/${ref.name}`,
            label: ref.name,
            kind: "element" as const,
            properties: [],
            children: [],
            ref,
          })),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, revision],
  );

  // -- commands ------------------------------------------------------------

  const openDesigner = useCallback((ref: AotObjectRef) => {
    setOpenElement(ref);
    setCentreTab("designer");
    setSelectedNode(undefined);
  }, []);

  /** **Add to project** — the command that makes an element editable at all (VB-015). */
  const handleAddToProject = useCallback(
    (ref: AotObjectRef) => {
      const result = addToProject(project, ref);
      setStatus(
        result.ok
          ? `${ref.name} added to ${project.name}. Its designer is now editable.`
          : result.message,
      );
      touchProject();
    },
    [project, touchProject],
  );

  /** Right-click Fields > New > String (VB-019), reduced to a prompt-free button. */
  const handleAddField = useCallback(() => {
    if (openElement === undefined || openElement.type !== "table") return;

    const existing = aot.getTable(openElement.name)?.fields.length ?? 0;
    const field: FieldMetadata = {
      name: `NewField${existing + 1}`,
      label: `New field ${existing + 1}`,
      baseType: "str",
      mandatory: false,
      allowEdit: true,
    };

    const result = addField(project, aot, openElement.name, field);
    if (result.ok) {
      setStatus(
        `${field.name} added to ${openElement.name}. The metadata has it; the database does not until you synchronise.`,
      );
      // Both: the field landed on the table (so the designer and the property grid are
      // stale) and on the project's pending list (so Solution Explorer is too).
      touch();
      touchProject();
      return;
    }

    // The refusal is the lesson. Surface it where a real refusal would land — the Error
    // List — rather than in a toast that vanishes.
    setMessages([{ severity: "error", element: openElement.name, message: result.message }]);
    setBottomTab("errors");
    setStatus(result.hint);
  }, [aot, openElement, project, touch, touchProject]);

  const handleBuild = useCallback(() => {
    const result = build(project, aot);
    setOutput(result.output);
    setMessages(result.messages);
    setBottomTab(result.messages.length > 0 ? "errors" : "output");
    setStatus(result.ok ? "Build succeeded" : "Build failed");

    if (result.synchronised) {
      const plan = planSynchronisation(project);
      if (plan.statements.length > 0) {
        setOutput([...result.output, "", ...plan.statements.map((line) => `  ${line}`)]);
        markSynchronised(project);
      }
    }
    touchProject();
  }, [aot, project, touchProject]);

  /** Dynamics 365 > Synchronize database (VB-021). */
  const handleSynchronise = useCallback(() => {
    const plan = planSynchronisation(project);
    setOutput([
      "Synchronize database...",
      ...(plan.statements.length === 0
        ? ["  Nothing to do — no table changes are pending."]
        : plan.statements.map((line) => `  ${line}`)),
      "Synchronize database completed.",
    ]);
    markSynchronised(project);
    setBottomTab("output");
    setStatus("Database synchronised");
    touchProject();
  }, [project, touchProject]);

  // -- debugging -----------------------------------------------------------

  const startDebugging = useCallback(async () => {
    if (busy) return;

    setPause(undefined);
    setHits({});
    setOutcome(undefined);
    setStatus("Running");
    setBottomTab(breakpointsRef.current.length === 0 ? "infolog" : "locals");

    const result = await debug(
      source,
      "HVND",
      breakpointsRef.current,
      (next) => {
        setPause(next);
        setHits((current) => ({
          ...current,
          ...(next.reason === "breakpoint" ? { [next.line]: (current[next.line] ?? 0) + 1 } : {}),
        }));
        setStatus(
          next.reason === "breakpoint"
            ? `Paused at a breakpoint on line ${next.line}`
            : `Paused on line ${next.line}`,
        );
      },
      `${STARTUP_OBJECT}.main`,
    );

    setPause(undefined);
    setOutcome(result);
    setStatus(
      result?.stoppedByDebugger === true
        ? "Debugging stopped"
        : result === undefined
          ? "Ready"
          : `Ready — ${result.statementsExecuted} statements in ${result.durationMs}ms`,
    );
    if (result !== undefined && result.errors.length === 0) setBottomTab("infolog");
  }, [busy, debug, source]);

  const send = useCallback(
    (command: DebugCommand) => {
      setPause(undefined);
      setStatus(command === "stop" ? "Stopping" : "Running");
      resume(command, breakpointsRef.current);
    },
    [resume],
  );

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((current) =>
      current.some((breakpoint) => breakpoint.line === line)
        ? current.filter((breakpoint) => breakpoint.line !== line)
        : [...current, { line }].sort((left, right) => left.line - right.line),
    );
  }, []);

  const toggleEnabled = useCallback((line: number) => {
    setBreakpoints((current) =>
      current.map((breakpoint) =>
        breakpoint.line === line
          ? { ...breakpoint, enabled: breakpoint.enabled === false }
          : breakpoint,
      ),
    );
  }, []);

  // The debugger's keys, at the window level so they work wherever focus is — which is
  // how they behave in the real product.
  const paused = pause !== undefined;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === "F5" && !event.shiftKey) {
        event.preventDefault();
        if (paused) send("continue");
        else void startDebugging();
      }
      if (key === "F5" && event.shiftKey && paused) {
        event.preventDefault();
        send("stop");
      }
      if (key === "F10" && paused) {
        event.preventDefault();
        send("stepOver");
      }
      if (key === "F11" && paused) {
        event.preventDefault();
        send(event.shiftKey ? "stepOut" : "stepInto");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, send, startDebugging]);

  /**
   * The commands the real context menu carries on an element.
   *
   * The unimplemented ones stay on the menu, greyed, with a note saying where they arrive.
   * They are the vocabulary of the job — a developer who has never seen **Create
   * extension** on this menu has a gap that no amount of X++ syntax fills.
   */
  const contextCommands = useCallback(
    (node: DesignerNode): ContextCommand[] => {
      const ref = node.ref;
      if (ref === undefined) return [];

      const already = isInProject(project, ref);

      return [
        {
          label: "Open designer",
          onSelect: () => openDesigner(ref),
        },
        {
          label: "View code",
          note: "Elements in this simulator carry no attached X++ yet — code lives in the editor tab.",
        },
        {
          label: "Add to project",
          separatorBefore: true,
          ...(already ? { note: `${ref.name} is already in ${project.name}.` } : {}),
          ...(already ? {} : { onSelect: () => handleAddToProject(ref) }),
        },
        {
          label: "Create extension",
          note: "Extensions and Chain of Command arrive with the customisation track.",
        },
        {
          label: "Customize",
          note: "Overlayering is deliberately not taught: extensions are the supported way to change a standard element.",
        },
        {
          label: "Find References",
          separatorBefore: true,
          note: "Cross-reference data is built during a real build. Not simulated.",
        },
        { label: "Properties", onSelect: () => setSelectedNode(node) },
      ];
    },
    [handleAddToProject, openDesigner, project],
  );

  const enabledLines = breakpoints
    .filter((breakpoint) => breakpoint.enabled !== false)
    .map((breakpoint) => breakpoint.line);
  const disabledLines = breakpoints
    .filter((breakpoint) => breakpoint.enabled === false)
    .map((breakpoint) => breakpoint.line);

  const properties = selectedNode?.properties ?? designer?.properties ?? [];
  const propertiesTitle = selectedNode?.label ?? designer?.label ?? "";

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-200">
      <MenuBar
        onBuild={handleBuild}
        onSynchronise={handleSynchronise}
        onStart={() => void startDebugging()}
      />

      <Toolbar
        paused={paused}
        busy={busy}
        onStart={() => (paused ? send("continue") : void startDebugging())}
        onStop={() => send("stop")}
        onStepOver={() => send("stepOver")}
        onStepInto={() => send("stepInto")}
        onStepOut={() => send("stepOut")}
      />

      <div className="flex min-h-0 flex-1">
        {/* Application Explorer */}
        <Pane title="Application Explorer" className="w-64 border-r border-zinc-800">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter the AOT…"
            data-testid="aot-filter"
            className="w-full border-b border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:bg-zinc-900/60"
          />
          <div className="min-h-0 flex-1 overflow-auto">
            <TreeView
              root={explorer}
              selectedId={selectedNode?.id}
              onSelect={setSelectedNode}
              onActivate={(node) => node.ref !== undefined && openDesigner(node.ref)}
              onContextMenu={(node, position) => {
                if (node.ref !== undefined) setContextMenu({ node, ...position });
              }}
              initiallyExpanded={["AOT", "AOT/Data Model", "AOT/Data Model/Tables"]}
              badge={(node) =>
                node.ref !== undefined && isInProject(project, node.ref) ? "in project" : undefined
              }
              emptyMessage="Nothing of this kind in the simulated model store."
            />
          </div>
          <p className="border-t border-zinc-800 px-2 py-1.5 text-[10px] leading-snug text-zinc-500">
            Application Explorer only ever <em>views</em> elements. Double-click to open a designer;
            right-click for <strong>Add to project</strong>, which is what makes one editable.
          </p>
        </Pane>

        {/* Designer or code */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-px border-b border-zinc-800 bg-zinc-900 px-1">
            <TabButton
              active={centreTab === "code"}
              onClick={() => setCentreTab("code")}
              testId="tab-code"
            >
              {STARTUP_OBJECT}.xpp
            </TabButton>
            {openElement !== undefined && (
              <TabButton
                active={centreTab === "designer"}
                onClick={() => setCentreTab("designer")}
                testId="tab-designer"
              >
                {openElement.name} [Designer]
              </TabButton>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {centreTab === "code" ? (
              <CodeWindow
                value={source}
                onChange={setSource}
                breakpointLines={enabledLines}
                disabledLines={disabledLines}
                onToggleBreakpoint={toggleBreakpoint}
                {...(pause === undefined ? {} : { pausedLine: pause.line })}
                readOnly={paused}
              />
            ) : designer === undefined ? (
              <p className="p-4 font-mono text-xs text-zinc-500">
                Nothing open. Double-click an element in Application Explorer.
              </p>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
                  <span className="font-mono text-[11px] text-zinc-400">{designer.label}</span>
                  {openElement?.type === "table" && (
                    <button
                      type="button"
                      onClick={handleAddField}
                      data-testid="designer-add-field"
                      className="rounded-sm border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 transition hover:bg-zinc-800"
                    >
                      Fields ▸ New ▸ String
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <TreeView
                    root={designer}
                    selectedId={selectedNode?.id}
                    onSelect={setSelectedNode}
                    initiallyExpanded={[designer.id, `${designer.id}/Fields`]}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Solution Explorer over Properties */}
        <div className="flex w-72 min-w-0 flex-col border-l border-zinc-800">
          <Pane title="Solution Explorer" className="h-1/3 min-h-0 border-b border-zinc-800">
            <div className="min-h-0 flex-1 overflow-auto">
              <TreeView
                root={solution}
                selectedId={selectedNode?.id}
                onSelect={setSelectedNode}
                onActivate={(node) => node.ref !== undefined && openDesigner(node.ref)}
                initiallyExpanded={["solution", "project"]}
                emptyMessage="Empty. Add an element from Application Explorer."
              />
            </div>
            <p className="border-t border-zinc-800 px-2 py-1 text-[10px] leading-snug text-zinc-500">
              A project belongs to exactly one model, and only elements in it can be edited or
              built.
            </p>
          </Pane>

          <div className="flex min-h-0 flex-1 flex-col">
            <PropertiesWindow
              title={propertiesTitle}
              properties={properties}
              ordering={ordering}
              onOrderingChange={setOrdering}
              onGoTo={openDesigner}
            />
          </div>
        </div>
      </div>

      {/* Tool windows */}
      <div className="flex h-56 min-h-0 flex-col border-t border-zinc-800">
        <div className="flex gap-px border-b border-zinc-800 bg-zinc-900 px-1">
          {BOTTOM_TABS.map((tab) => (
            <TabButton
              key={tab.id}
              active={bottomTab === tab.id}
              onClick={() => setBottomTab(tab.id)}
              testId={`bottom-tab-${tab.id}`}
            >
              {tab.label}
              {tab.id === "errors" && messages.length > 0 && (
                <span className="ml-1 text-amber-400">{messages.length}</span>
              )}
            </TabButton>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {bottomTab === "output" && <Output lines={output} />}
          {bottomTab === "errors" && <ErrorList messages={messages} />}
          {bottomTab === "locals" && <Locals {...(pause === undefined ? {} : { pause })} />}
          {bottomTab === "autos" && <Autos {...(pause === undefined ? {} : { pause })} />}
          {bottomTab === "callStack" && <CallStack {...(pause === undefined ? {} : { pause })} />}
          {bottomTab === "breakpoints" && (
            <Breakpoints
              breakpoints={breakpoints}
              hits={hits}
              onToggle={toggleEnabled}
              onRemove={toggleBreakpoint}
            />
          )}
          {bottomTab === "infolog" && (
            <Infolog entries={pause?.infolog ?? outcome?.infolog ?? []} />
          )}
        </div>
      </div>

      {contextMenu !== undefined && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.node.label}
          commands={contextCommands(contextMenu.node)}
          onClose={() => setContextMenu(undefined)}
        />
      )}

      <footer className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-3 py-1 text-[11px]">
        <span data-testid="studio-status" className={paused ? "text-amber-400" : "text-zinc-400"}>
          {status}
        </span>
        <span className="flex items-center gap-3 text-zinc-600">
          <span>HVND</span>
          <Link href="/playground" className="hover:text-zinc-400">
            Sandbox
          </Link>
          <Link href="/" className="hover:text-zinc-400">
            X++Lab
          </Link>
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MenuBar({
  onBuild,
  onSynchronise,
  onStart,
}: {
  onBuild: () => void;
  onSynchronise: () => void;
  onStart: () => void;
}) {
  /**
   * The menus carry the real command names, including the ones this simulator does not
   * implement. Greying an unimplemented command is honest and still teaches where it
   * lives; omitting it would teach a shorter menu than the one that exists.
   */
  const menus: { label: string; items: { label: string; onClick?: () => void; key?: string }[] }[] =
    [
      {
        label: "View",
        items: [
          { label: "Application Explorer" },
          { label: "Solution Explorer" },
          { label: "Properties Window", key: "F4" },
          { label: "Error List" },
          { label: "Output" },
          { label: "Infolog" },
        ],
      },
      {
        label: "Build",
        items: [
          { label: "Build XppLabTutorial", onClick: onBuild },
          { label: "Rebuild XppLabTutorial", onClick: onBuild },
        ],
      },
      {
        label: "Debug",
        items: [
          { label: "Start Debugging", onClick: onStart, key: "F5" },
          { label: "Stop Debugging", key: "Shift+F5" },
          { label: "Step Over", key: "F10" },
          { label: "Step Into", key: "F11" },
          { label: "Step Out", key: "Shift+F11" },
          { label: "Toggle Breakpoint", key: "F9" },
          { label: "Delete All Breakpoints" },
        ],
      },
      {
        label: "Dynamics 365",
        items: [
          { label: "Synchronize database", onClick: onSynchronise },
          { label: "Build models" },
          { label: "Model Management ▸ Create model" },
          { label: "Options" },
        ],
      },
    ];

  const [open, setOpen] = useState<string | undefined>();

  return (
    <nav
      className="relative flex items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px]"
      onMouseLeave={() => setOpen(undefined)}
    >
      <span className="mr-2 font-mono text-[10px] tracking-widest text-sky-400">X++LAB STUDIO</span>
      {menus.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            onClick={() => setOpen((current) => (current === menu.label ? undefined : menu.label))}
            onMouseEnter={() =>
              setOpen((current) => (current === undefined ? current : menu.label))
            }
            data-testid={`menu-${menu.label}`}
            className={`px-2 py-0.5 transition ${
              open === menu.label
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {menu.label}
          </button>

          {open === menu.label && (
            <ul className="absolute top-full left-0 z-20 min-w-56 border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              {menu.items.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    disabled={item.onClick === undefined}
                    onClick={() => {
                      item.onClick?.();
                      setOpen(undefined);
                    }}
                    data-testid={`menu-item-${item.label}`}
                    className="flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-zinc-300 transition enabled:hover:bg-sky-500/20 disabled:text-zinc-600"
                  >
                    <span>{item.label}</span>
                    {item.key !== undefined && (
                      <span className="font-mono text-[10px] text-zinc-500">{item.key}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

function Toolbar({
  paused,
  busy,
  onStart,
  onStop,
  onStepOver,
  onStepInto,
  onStepOut,
}: {
  paused: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onStepOver: () => void;
  onStepInto: () => void;
  onStepOut: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-2 py-1">
      <ToolbarButton onClick={onStart} testId="debug-start" title="Start Debugging (F5)">
        <span className="text-emerald-400">▶</span> {paused ? "Continue" : "Start"}
      </ToolbarButton>
      <ToolbarButton
        onClick={onStop}
        testId="debug-stop"
        title="Stop Debugging (Shift+F5)"
        disabled={!paused && !busy}
      >
        <span className="text-red-400">■</span> Stop
      </ToolbarButton>

      <span className="mx-1 h-4 w-px bg-zinc-700" />

      <ToolbarButton
        onClick={onStepOver}
        testId="debug-step-over"
        title="Step Over (F10)"
        disabled={!paused}
      >
        ⤵ Step Over
      </ToolbarButton>
      <ToolbarButton
        onClick={onStepInto}
        testId="debug-step-into"
        title="Step Into (F11)"
        disabled={!paused}
      >
        ⤷ Step Into
      </ToolbarButton>
      <ToolbarButton
        onClick={onStepOut}
        testId="debug-step-out"
        title="Step Out (Shift+F11)"
        disabled={!paused}
      >
        ⤴ Step Out
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
  testId,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testId}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] text-zinc-300 transition enabled:hover:bg-zinc-800 disabled:text-zinc-600"
    >
      {children}
    </button>
  );
}

function Pane({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <h2 className="border-b border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-300">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`border-b-2 px-3 py-1 text-[11px] transition ${
        active
          ? "border-sky-400 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
