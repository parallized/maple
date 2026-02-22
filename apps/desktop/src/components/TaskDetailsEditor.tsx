import { indentWithTab } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown } from "@codemirror/lang-markdown";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { type Command, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type TaskDetailsEditorProps = {
  value: string;
  onCommit: (nextValue: string) => void;
  renderPreview?: (value: string) => ReactNode;
};

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function createWrapSelectionCommand(prefix: string, suffix: string, placeholder: string): Command {
  return (view) => {
    const update = view.state.changeByRange((range) => {
      const selectedText = view.state.doc.sliceString(range.from, range.to) || placeholder;
      const insert = `${prefix}${selectedText}${suffix}`;
      const anchor = range.from + prefix.length;
      const head = anchor + selectedText.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(anchor, head)
      };
    });
    view.dispatch(view.state.update(update, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

const boldCommand = createWrapSelectionCommand("**", "**", "文本");
const italicCommand = createWrapSelectionCommand("*", "*", "文本");
const linkCommand = createWrapSelectionCommand("[", "](https://)", "链接文本");

export function TaskDetailsEditor({ value, onCommit, renderPreview }: TaskDetailsEditorProps) {
  const skipBlurCommitRef = useRef(false);
  const currentValueRef = useRef(value);
  const draftRef = useRef(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    currentValueRef.current = value;
    setDraft(value);
    setEditing(false);
  }, [value]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const commitValue = useCallback((nextValue: string) => {
    const normalizedNext = normalizeLineEndings(nextValue);
    const normalizedCurrent = normalizeLineEndings(currentValueRef.current);
    if (normalizedNext === normalizedCurrent) return;
    onCommit(normalizedNext);
  }, [onCommit]);

  const closeWithoutCommit = useCallback(() => {
    skipBlurCommitRef.current = true;
    setDraft(currentValueRef.current);
    setEditing(false);
  }, []);

  const closeWithCommit = useCallback((nextValue: string) => {
    skipBlurCommitRef.current = true;
    setEditing(false);
    commitValue(nextValue);
  }, [commitValue]);

  const extensions = useMemo<Extension[]>(
    () => [
      markdown(),
      cmPlaceholder("支持 Markdown 快捷输入：#、-、- [ ]、1.、>、![alt](url)"),
      Prec.high(
        keymap.of([
          { key: "Enter", run: insertNewlineContinueMarkup },
          { key: "Mod-b", run: boldCommand },
          { key: "Mod-i", run: italicCommand },
          { key: "Mod-k", run: linkCommand },
          {
            key: "Mod-Enter",
            run: (view) => {
              closeWithCommit(view.state.doc.toString());
              return true;
            }
          },
          {
            key: "Escape",
            run: () => {
              closeWithoutCommit();
              return true;
            }
          },
          indentWithTab
        ])
      )
    ],
    [closeWithCommit, closeWithoutCommit]
  );

  if (!editing) {
    const hasContent = value.trim().length > 0;
    return (
      <div
        role="button"
        tabIndex={0}
        className="task-details-surface"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) return;
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setEditing(true);
          }
        }}
        aria-label="编辑详情"
      >
        {hasContent ? (
          <div className="task-details-text">
            {renderPreview ? renderPreview(value) : value}
          </div>
        ) : (
          <span className="task-details-placeholder">添加详情…</span>
        )}
      </div>
    );
  }

  return (
    <div className="task-details-surface task-details-surface--editing">
      <CodeMirror
        className="task-details-cm"
        value={draft}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLineGutter: false,
          searchKeymap: false
        }}
        extensions={extensions}
        onCreateEditor={(editor) => {
          queueMicrotask(() => {
            const end = editor.state.doc.length;
            editor.dispatch({ selection: EditorSelection.cursor(end) });
            editor.focus();
          });
        }}
        onBlur={(event) => {
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setEditing(false);
          commitValue(draftRef.current);
        }}
        onChange={(nextValue) => {
          setDraft(nextValue);
        }}
      />
    </div>
  );
}
