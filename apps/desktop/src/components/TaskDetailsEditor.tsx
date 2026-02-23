import type { PartialBlock } from "@blocknote/core";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";
import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useRef } from "react";

type TaskDetailsEditorProps = {
  value: string;
  onCommit: (nextValue: string) => void;
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

export function TaskDetailsEditor({ value, onCommit }: TaskDetailsEditorProps) {
  const currentValueRef = useRef(value);
  const ignoreNextBlurRef = useRef(false);
  const lastSyncedValueRef = useRef<string>("");
  const autosaveTimerRef = useRef<number | null>(null);
  const lastAutosaveAtRef = useRef<number>(0);

  const editor = useCreateBlockNote(
    {
      placeholders: {
        emptyDocument: "输入任务详情…",
        default: "输入任务详情…"
      },
      uploadFile: async (file) => uploadFileAsDataUrl(file)
    },
    []
  );

  const commitEditorMarkdown = useCallback(() => {
    let nextValue = currentValueRef.current;
    try {
      nextValue = editor.isEmpty ? "" : normalizeLineEndings(editor.blocksToMarkdownLossy(editor.document)).trimEnd();
    } catch {
      nextValue = currentValueRef.current;
    }
    if (normalizeForCompare(nextValue) === normalizeForCompare(currentValueRef.current)) return;
    onCommit(nextValue);
    currentValueRef.current = nextValue;
    lastSyncedValueRef.current = normalizeForCompare(nextValue);
  }, [editor, onCommit]);

  const scheduleAutosave = useCallback(() => {
    const maxWaitMs = 2000;
    const debounceMs = 450;
    const now = Date.now();
    const elapsed = now - lastAutosaveAtRef.current;

    if (elapsed >= maxWaitMs) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      commitEditorMarkdown();
      lastAutosaveAtRef.current = Date.now();
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      commitEditorMarkdown();
      lastAutosaveAtRef.current = Date.now();
    }, debounceMs);
  }, [commitEditorMarkdown]);

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
    currentValueRef.current = value;
    const normalizedIncoming = normalizeForCompare(value);
    if (normalizedIncoming === lastSyncedValueRef.current) return;

    try {
      syncEditorFromMarkdown(value);
      lastSyncedValueRef.current = normalizedIncoming;
    } catch {
      // Keep editor interactive even if parsing a malformed markdown chunk fails.
    }
  }, [value, syncEditorFromMarkdown]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, []);

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
        onChange={() => {
          scheduleAutosave();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            ignoreNextBlurRef.current = true;
            editor.blur();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            ignoreNextBlurRef.current = true;
            commitEditorMarkdown();
            editor.blur();
          }
        }}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (ignoreNextBlurRef.current) {
            ignoreNextBlurRef.current = false;
            return;
          }
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          commitEditorMarkdown();
        }}
      />
    </div>
  );
}
