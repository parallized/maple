import type { PartialBlock } from "@blocknote/core";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";
import { type FocusEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type TaskDetailsEditorProps = {
  value: string;
  onCommit: (nextValue: string) => void;
  renderPreview?: (value: string) => ReactNode;
};

const EMPTY_BLOCK: PartialBlock = {
  type: "paragraph",
  content: ""
};

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function normalizeForCompare(text: string): string {
  return normalizeLineEndings(text).trimEnd();
}

async function uploadFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

export function TaskDetailsEditor({ value, onCommit, renderPreview }: TaskDetailsEditorProps) {
  const currentValueRef = useRef(value);
  const ignoreNextBlurRef = useRef(false);
  const [editing, setEditing] = useState(false);

  const editor = useCreateBlockNote(
    {
      uploadFile: async (file) => uploadFileAsDataUrl(file)
    },
    []
  );

  useEffect(() => {
    currentValueRef.current = value;
    setEditing(false);
  }, [value]);

  const commitEditorMarkdown = useCallback(() => {
    let nextValue = currentValueRef.current;
    try {
      nextValue = editor.isEmpty ? "" : normalizeLineEndings(editor.blocksToMarkdownLossy(editor.document)).trimEnd();
    } catch {
      nextValue = currentValueRef.current;
    }
    if (normalizeForCompare(nextValue) === normalizeForCompare(currentValueRef.current)) return;
    onCommit(nextValue);
  }, [editor, onCommit]);

  const syncEditorFromMarkdown = useCallback(
    (markdownText: string) => {
      const parsed = markdownText.trim()
        ? editor.tryParseMarkdownToBlocks(markdownText)
        : [EMPTY_BLOCK];
      const nextBlocks = parsed.length > 0 ? parsed : [EMPTY_BLOCK];
      const currentBlocks = editor.document;

      if (currentBlocks.length > 0) {
        editor.replaceBlocks(
          currentBlocks.map((block) => block.id),
          nextBlocks
        );
      }
    },
    [editor]
  );

  useEffect(() => {
    if (!editing) return;

    try {
      syncEditorFromMarkdown(currentValueRef.current);
    } catch {
      // Keep editor interactive even if parsing a malformed markdown chunk fails.
    }

    queueMicrotask(() => {
      const lastBlock = editor.document.at(-1);
      if (lastBlock) {
        editor.setTextCursorPosition(lastBlock.id, "end");
      }
      editor.focus();
    });
  }, [editing, editor, syncEditorFromMarkdown]);

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
      <BlockNoteViewRaw
        editor={editor}
        className="task-details-cm"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={true}
        emojiPicker={false}
        sideMenu={false}
        filePanel={true}
        tableHandles={false}
        comments={false}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            ignoreNextBlurRef.current = true;
            setEditing(false);
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            ignoreNextBlurRef.current = true;
            setEditing(false);
            commitEditorMarkdown();
          }
        }}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (ignoreNextBlurRef.current) {
            ignoreNextBlurRef.current = false;
            return;
          }
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setEditing(false);
          commitEditorMarkdown();
        }}
      />
    </div>
  );
}
