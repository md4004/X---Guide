"use client";

/**
 * The tree control the Studio's three explorer panes share.
 *
 * Application Explorer, the element designers and Solution Explorer are all the same
 * control over different data, which is true of the real product too — and is why a
 * developer who can drive one can drive all three.
 *
 * Expansion state is held here rather than by each pane, keyed by node id, so selecting a
 * node deep in a designer and coming back to it does not collapse the path you took.
 */

import { useCallback, useMemo, useState } from "react";
import type { DesignerNode, DesignerNodeKind } from "@xpplab/virtual-aot";

/** A glyph per node kind. Text, not icons — it reads at 11px and never fails to load. */
const GLYPHS: Record<DesignerNodeKind, string> = {
  folder: "▸",
  element: "◆",
  field: "▪",
  fieldGroup: "▤",
  index: "⌗",
  relation: "⇄",
  method: "ƒ",
  enumValue: "•",
  dataSource: "▤",
  control: "▫",
};

const KIND_COLOURS: Record<DesignerNodeKind, string> = {
  folder: "text-zinc-500",
  element: "text-sky-400",
  field: "text-emerald-400",
  fieldGroup: "text-amber-400",
  index: "text-violet-400",
  relation: "text-orange-400",
  method: "text-pink-400",
  enumValue: "text-emerald-400",
  dataSource: "text-amber-400",
  control: "text-zinc-400",
};

interface TreeViewProps {
  root: DesignerNode;
  selectedId?: string;
  onSelect: (node: DesignerNode) => void;
  /** Double-click, which is **Open designer** on an element. */
  onActivate?: (node: DesignerNode) => void;
  /** Right-click. The real tool's primary interaction — see `ContextMenu`. */
  onContextMenu?: (node: DesignerNode, position: { x: number; y: number }) => void;
  /** Node ids expanded on first render. */
  initiallyExpanded?: string[];
  /** Renders to the right of a node's label — the "in project" marker, for instance. */
  badge?: (node: DesignerNode) => string | undefined;
  emptyMessage?: string;
}

export function TreeView({
  root,
  selectedId,
  onSelect,
  onActivate,
  onContextMenu,
  initiallyExpanded = [],
  badge,
  emptyMessage,
}: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded));

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The root itself is a container, not a row, except in Application Explorer where the
  // `AOT` node is genuinely clickable (it carries the classic/model view command).
  return (
    <ul className="py-1 font-mono text-[11px] leading-[1.7]">
      <TreeRow
        node={root}
        depth={0}
        expanded={expanded}
        toggle={toggle}
        selectedId={selectedId}
        onSelect={onSelect}
        onActivate={onActivate}
        onContextMenu={onContextMenu}
        badge={badge}
        emptyMessage={emptyMessage}
      />
    </ul>
  );
}

interface TreeRowProps extends Omit<TreeViewProps, "root" | "initiallyExpanded"> {
  node: DesignerNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
}

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedId,
  onSelect,
  onActivate,
  onContextMenu,
  badge,
  emptyMessage,
}: TreeRowProps) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const marker = badge?.(node);

  const children = useMemo(() => node.children, [node.children]);

  return (
    <li>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isOpen : undefined}
        tabIndex={0}
        data-testid={`tree-node-${node.id}`}
        onClick={() => {
          onSelect(node);
          if (hasChildren) toggle(node.id);
        }}
        onDoubleClick={() => onActivate?.(node)}
        onContextMenu={(event) => {
          if (onContextMenu === undefined) return;
          event.preventDefault();
          onSelect(node);
          onContextMenu(node, { x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSelect(node);
            onActivate?.(node);
          }
          if (event.key === "ArrowRight" && hasChildren && !isOpen) toggle(node.id);
          if (event.key === "ArrowLeft" && hasChildren && isOpen) toggle(node.id);
        }}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={`flex cursor-default items-center gap-1.5 py-px pr-2 outline-none ${
          isSelected ? "bg-sky-500/20 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/60"
        } focus-visible:ring-1 focus-visible:ring-sky-400`}
      >
        <span
          className={`w-2 shrink-0 text-[9px] text-zinc-500 transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          {hasChildren ? "▸" : ""}
        </span>
        <span className={`shrink-0 ${KIND_COLOURS[node.kind]}`}>{GLYPHS[node.kind]}</span>
        <span className="truncate">{node.label}</span>
        {marker !== undefined && (
          <span className="ml-1 shrink-0 rounded-sm bg-emerald-500/15 px-1 text-[9px] text-emerald-300">
            {marker}
          </span>
        )}
      </div>

      {isOpen && hasChildren && (
        <ul>
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onActivate={onActivate}
              onContextMenu={onContextMenu}
              badge={badge}
              emptyMessage={emptyMessage}
            />
          ))}
        </ul>
      )}

      {isOpen && !hasChildren && emptyMessage !== undefined && node.kind === "folder" && (
        <p
          className="py-px pr-2 text-[10px] text-zinc-600 italic"
          style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
        >
          {emptyMessage}
        </p>
      )}
    </li>
  );
}
