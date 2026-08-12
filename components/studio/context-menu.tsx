"use client";

/**
 * The right-click menu on an Application Explorer element.
 *
 * This is not decoration. "Right-click the selection to view the actions that you can
 * perform" is how the real tool is driven, and the commands on it are the vocabulary of
 * the job — **Add to project**, **Create extension**, **Find References**, **Open
 * designer**, **View code**. A learner who has never opened this menu has not used
 * Application Explorer.
 *
 * The commands we do not implement are shown greyed rather than omitted, with a note
 * saying which track they arrive in. Hiding them would teach a shorter menu than the one
 * that exists; enabling them would be worse.
 */

import { useEffect, useRef } from "react";

export interface ContextCommand {
  label: string;
  onSelect?: () => void;
  /** Shown under a disabled command, explaining why it is not available here. */
  note?: string;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  title: string;
  commands: ContextCommand[];
  onClose: () => void;
}

export function ContextMenu({ x, y, title, commands, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Any click elsewhere, or Escape, dismisses it — as a native menu does.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      // Clamped so a right-click near the bottom of the window does not open a menu
      // hanging off the edge of the screen.
      style={{ left: x, top: Math.min(y, Math.max(0, window.innerHeight - 260)) }}
      className="fixed z-50 min-w-60 border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
    >
      <p className="truncate border-b border-zinc-800 px-3 pb-1 font-mono text-[10px] text-zinc-500">
        {title}
      </p>

      {commands.map((command) => (
        <div key={command.label}>
          {command.separatorBefore === true && <hr className="my-1 border-zinc-800" />}
          <button
            type="button"
            role="menuitem"
            disabled={command.onSelect === undefined}
            onClick={() => {
              command.onSelect?.();
              onClose();
            }}
            data-testid={`context-${command.label}`}
            title={command.note}
            className="w-full px-3 py-1 text-left text-[11px] text-zinc-300 transition enabled:hover:bg-sky-500/20 disabled:text-zinc-600"
          >
            {command.label}
          </button>
        </div>
      ))}
    </div>
  );
}
