import type { PartialBlock } from "@blocknote/core";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";
import { type KeyboardEvent, type FocusEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

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

export function TaskDetailsEditor({ value, onCommit }: TaskDetailsEditorProps) {
  const editor = useCreateBlockNote();
  const currentValueRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  const commitEditorMarkdown = useCallback(() => {
    let nextValue = "";
    try {
      nextValue = editor.isEmpty ? "" : normalizeLineEndings(editor.blocksToMarkdownLossy(editor.document)).trimEnd();
    } catch {
      nextValue = currentValueRef.current;
    }
    if (normalizeForCompare(nextValue) === normalizeForCompare(currentValueRef.current)) return;
    onCommit(nextValue);
  }, [editor, onCommit]);

  const syncEditorFromMarkdown = useCallback((markdownText: string) => {
    const blocks = markdownText.trim()
      ? editor.tryParseMarkdownToBlocks(markdownText)
      : [EMPTY_BLOCK];
    const nextBlocks = blocks.length > 0 ? blocks : [EMPTY_BLOCK];
    const existingIds = editor.document.map((block) => block.id);

    if (existingIds.length > 0) {
      editor.replaceBlocks(existingIds, nextBlocks);
      return;
    }
    const fallback = editor.document[0];
    if (fallback) {
      editor.replaceBlocks([fallback.id], nextBlocks);
    }
  }, [editor]);

  useEffect(() => {
    try {
      syncEditorFromMarkdown(currentValueRef.current);
    } catch {
      // Keep editor open even if markdown parsing fails for malformed content.
    }
  }, [editor, syncEditorFromMarkdown]);

  return (
    <div className="task-details-surface task-details-surface--editing">
      <BlockNoteViewRaw
        editor={editor}
        className="task-details-cm"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        emojiPicker={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        comments={false}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            commitEditorMarkdown();
          }
        }}
        onBlur={() => {
          commitEditorMarkdown();
        }}
      />
    </div>
  );
}
