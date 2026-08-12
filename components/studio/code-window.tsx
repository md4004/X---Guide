"use client";

/**
 * The Studio's code editor.
 *
 * The playground's editor with the two things a debugger needs: a clickable breakpoint
 * margin, and a highlight on the line execution is paused at.
 *
 * Both are Monaco decorations rather than DOM of our own, because the margin has to line
 * up with the text at every font size and scroll position, and reimplementing that is how
 * you end up with a breakpoint dot one line off — which in a teaching tool is worse than
 * having no breakpoints at all.
 */

import { useCallback, useEffect, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { parse } from "@xpplab/xpp-parser";
import { XPP_LANGUAGE_ID, registerXppLanguage } from "@/lib/monaco-xpp";

interface CodeWindowProps {
  value: string;
  onChange: (value: string) => void;
  /** Lines carrying an enabled breakpoint. */
  breakpointLines: number[];
  /** Lines carrying a disabled one, drawn hollow as the real margin draws them. */
  disabledLines: number[];
  onToggleBreakpoint: (line: number) => void;
  /** The line execution is paused at, or `undefined` when not paused. */
  pausedLine?: number;
  readOnly?: boolean;
}

export function CodeWindow({
  value,
  onChange,
  breakpointLines,
  disabledLines,
  onToggleBreakpoint,
  pausedLine,
  readOnly,
}: CodeWindowProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // Monaco's mouse handler and F9 command are registered once, so they reach the current
  // callback through a ref rather than closing over a stale one.
  const toggleRef = useRef(onToggleBreakpoint);
  useEffect(() => {
    toggleRef.current = onToggleBreakpoint;
  }, [onToggleBreakpoint]);

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
        endColumn: Math.max((error.endColumn ?? error.column) + 1, error.column + 1),
      })),
    );
  }, []);

  const handleMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    decorationsRef.current = instance.createDecorationsCollection([]);

    // Clicking the margin is how most people set a breakpoint; F9 is how the rest do.
    instance.onMouseDown((event) => {
      const target = event.target.type;
      const isMargin =
        target === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        target === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
      const line = event.target.position?.lineNumber;
      if (isMargin && line !== undefined) toggleRef.current(line);
    });

    instance.addCommand(monaco.KeyCode.F9, () => {
      const line = instance.getPosition()?.lineNumber;
      if (line !== undefined) toggleRef.current(line);
    });

    refreshMarkers(instance.getValue());
  };

  useEffect(() => {
    const timer = setTimeout(() => refreshMarkers(value), 200);
    return () => clearTimeout(timer);
  }, [value, refreshMarkers]);

  // Breakpoint dots and the paused-line highlight, rebuilt whenever either changes.
  useEffect(() => {
    const collection = decorationsRef.current;
    const monaco = monacoRef.current;
    if (collection === null || monaco === null) return;

    const range = (line: number) => new monaco.Range(line, 1, line, 1);

    collection.set([
      ...breakpointLines.map((line) => ({
        range: range(line),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "xpp-breakpoint",
          glyphMarginHoverMessage: { value: "Breakpoint — click to remove, or press F9." },
        },
      })),
      ...disabledLines.map((line) => ({
        range: range(line),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "xpp-breakpoint-disabled",
          glyphMarginHoverMessage: { value: "Disabled breakpoint." },
        },
      })),
      ...(pausedLine === undefined
        ? []
        : [
            {
              range: range(pausedLine),
              options: {
                isWholeLine: true,
                className: "xpp-paused-line",
                glyphMarginClassName: "xpp-paused-arrow",
              },
            },
          ]),
    ]);
  }, [breakpointLines, disabledLines, pausedLine]);

  // Scroll the paused line into view, the way the debugger follows execution for you.
  useEffect(() => {
    if (pausedLine === undefined) return;
    editorRef.current?.revealLineInCenterIfOutsideViewport(pausedLine);
  }, [pausedLine]);

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
        // The margin is the breakpoint gutter. Without this there is nowhere to click.
        glyphMargin: true,
        renderLineHighlight: "line",
        smoothScrolling: true,
        readOnly: readOnly === true,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
