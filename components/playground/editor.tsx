"use client";

/**
 * The X++ editor.
 *
 * Monaco, loaded client-side only. Parse errors are pushed in as markers on every
 * keystroke (debounced), so a learner sees the squiggle before they hit Run — the
 * parser is fast enough to afford it, and finding out at edit time is the point.
 */

import { useCallback, useEffect, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { parse } from "@xpplab/xpp-parser";
import { XPP_LANGUAGE_ID, registerXppLanguage } from "@/lib/monaco-xpp";

export interface XppEditorHandle {
  revealPosition: (line: number, column: number) => void;
}

interface XppEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReady?: (handle: XppEditorHandle) => void;
  /** Fired on Ctrl/Cmd+Enter, the shortcut everyone reaches for. */
  onRun?: () => void;
}

export function XppEditor({ value, onChange, onReady, onRun }: XppEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Monaco commands are registered once on mount, so the handler has to be reached
  // through a ref to stay current. Synced in an effect, not during render.
  const runRef = useRef(onRun);
  useEffect(() => {
    runRef.current = onRun;
  }, [onRun]);

  /** Reparses and replaces the marker set. Cheap enough to run on every change. */
  const refreshMarkers = useCallback((source: string) => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (monaco === null || !model) return;

    const { errors } = parse(source);
    monaco.editor.setModelMarkers(
      model,
      "xpp",
      errors.map((error) => ({
        severity: monaco.MarkerSeverity.Error,
        message: error.hint === undefined ? error.message : `${error.message}\n\n${error.hint}`,
        code: error.code,
        startLineNumber: error.line,
        startColumn: error.column,
        endLineNumber: error.endLine ?? error.line,
        // A zero-width marker renders as nothing, so always underline at least one char.
        endColumn: Math.max((error.endColumn ?? error.column) + 1, error.column + 1),
      })),
    );
  }, []);

  const handleMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());

    onReady?.({
      revealPosition: (line, column) => {
        instance.revealLineInCenter(line);
        instance.setPosition({ lineNumber: line, column });
        instance.focus();
      },
    });

    refreshMarkers(instance.getValue());
  };

  useEffect(() => {
    const timer = setTimeout(() => refreshMarkers(value), 200);
    return () => clearTimeout(timer);
  }, [value, refreshMarkers]);

  return (
    <Editor
      height="100%"
      language={XPP_LANGUAGE_ID}
      theme="xpplab"
      value={value}
      beforeMount={registerXppLanguage}
      onMount={handleMount}
      onChange={(next) => onChange(next ?? "")}
      loading={<span className="p-4 font-mono text-xs text-zinc-500">Loading the editor…</span>}
      options={{
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        renderLineHighlight: "line",
        smoothScrolling: true,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
