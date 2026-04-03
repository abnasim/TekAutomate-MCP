import React, { useEffect, useRef } from 'react';
import { EditorView, minimalSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

interface PythonCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** When true, editor is read-only and uses themed Python syntax highlighting. */
  readOnly?: boolean;
}

export const PythonCodeEditor: React.FC<PythonCodeEditorProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
  readOnly = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const extensions = [
      minimalSetup,
      python(),
      oneDark,
      ...(readOnly ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString();
            onChange(newValue);
          }
        }),
      ]),
      EditorView.theme({
        '&': {
          fontSize: '14px',
          fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, "source-code-pro", monospace',
        },
        '.cm-content': {
          padding: '12px',
          minHeight: readOnly ? '200px' : '400px',
        },
        '.cm-focused': {
          outline: readOnly ? 'none' : '2px solid #1cb5d8',
          outlineOffset: '-2px',
        },
      }),
    ];

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    // Create editor view
    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Update editor content when value prop changes (but not from user typing)
  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value,
        },
      });
      viewRef.current.dispatch(transaction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={className}>
      <div ref={editorRef} className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-auto max-h-[70vh]" />
      {placeholder && !value && (
        <div className="absolute inset-0 pointer-events-none text-gray-400 text-sm p-4 font-mono">
          {placeholder}
        </div>
      )}
    </div>
  );
};
