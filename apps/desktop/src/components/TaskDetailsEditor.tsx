import type { PartialBlock } from "@blocknote/core";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";
import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useRef } from "react";

import { hasTauriRuntime } from "../lib/utils";
import { resolveImageSrc, saveImageAsset } from "../lib/maple-assets";

type TaskDetailsEditorProps = {
  value: string;
  valueDoc?: unknown;
  onCommit: (nextValue: string, nextValueDoc: unknown) => void;
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

function stripTrailingNewlines(text: string): string {
  return text.replace(/\n+$/g, "");
}

function normalizeDocForCompare(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function resolveBlocksFromDoc(value: unknown): PartialBlock[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [EMPTY_BLOCK];
  return cloneValue(value as PartialBlock[]);
}

function isEmptyParagraphBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const maybe = block as { type?: unknown; content?: unknown };
  if (maybe.type !== "paragraph") return false;

  const content = maybe.content;
  if (content == null) return true;
  if (typeof content === "string") return content.length === 0;
  if (Array.isArray(content)) return content.length === 0;
  return false;
}

export function TaskDetailsEditor({ value, valueDoc, onCommit }: TaskDetailsEditorProps) {
  const currentValueRef = useRef(value);
  const currentValueDocRef = useRef<unknown>(valueDoc);
  const ignoreNextBlurRef = useRef(false);
  const lastSyncedValueRef = useRef<string>("");
  const lastSyncedDocRef = useRef<string>("");
  const debounceTimerRef = useRef<number | null>(null);
  const maxWaitTimerRef = useRef<number | null>(null);
  const isTauri = hasTauriRuntime();

  const editor = useCreateBlockNote(
    {
      placeholders: {
        emptyDocument: "输入任务详情…",
        default: "输入任务详情…"
      },
      uploadFile: async (file) => saveImageAsset(file),
      resolveFileUrl: async (url) => (await resolveImageSrc(url).catch(() => null)) ?? url
    },
    []
  );

  const serializeEditorMarkdown = useCallback((): string => {
    const blocks = editor.document ?? [];
    if (blocks.length === 0) return "";

    const allEmpty = blocks.every((block) => isEmptyParagraphBlock(block));
    if (allEmpty) return "";

    const hasTrailingEmptyParagraph = isEmptyParagraphBlock(blocks[blocks.length - 1]);
    const serializableBlocks = hasTrailingEmptyParagraph ? blocks.slice(0, -1) : blocks;

    const parts = serializableBlocks.map((block) => {
      if (isEmptyParagraphBlock(block)) return "";
      return stripTrailingNewlines(normalizeLineEndings(editor.blocksToMarkdownLossy([block])));
    });

    return parts.join("\n").trimEnd();
  }, [editor]);

  const commitEditorMarkdown = useCallback(() => {
    let nextValue = currentValueRef.current;
    let nextValueDoc: unknown = currentValueDocRef.current;
    try {
      nextValue = serializeEditorMarkdown();
      nextValueDoc = cloneValue(editor.document ?? []);
    } catch {
      nextValue = currentValueRef.current;
      nextValueDoc = currentValueDocRef.current;
    }
    const normalizedText = normalizeForCompare(nextValue);
    const normalizedDoc = normalizeDocForCompare(nextValueDoc);
    const textUnchanged = normalizedText === normalizeForCompare(currentValueRef.current);
    const docUnchanged = normalizedDoc === lastSyncedDocRef.current;
    if (textUnchanged && docUnchanged) return;

    onCommit(nextValue, nextValueDoc);
    currentValueRef.current = nextValue;
    currentValueDocRef.current = nextValueDoc;
    lastSyncedValueRef.current = normalizedText;
    lastSyncedDocRef.current = normalizedDoc;
  }, [editor, onCommit, serializeEditorMarkdown]);

  const scheduleAutosave = useCallback(() => {
    const maxWaitMs = 2000;
    const debounceMs = 450;

    const commit = () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        window.clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      commitEditorMarkdown();
    };

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(commit, debounceMs);

    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = window.setTimeout(commit, maxWaitMs);
    }
  }, [commitEditorMarkdown]);

  useEffect(() => {
    return editor.onUploadEnd((blockId) => {
      if (!blockId) return;
      const uploaded = editor.getBlock(blockId);
      if (!uploaded || uploaded.type !== "image") return;

      const next = editor.getNextBlock(blockId);
      if (next && isEmptyParagraphBlock(next)) {
        editor.setTextCursorPosition(next, "start");
        return;
      }

      const inserted = editor.insertBlocks([{ type: "paragraph", content: "" }], blockId, "after");
      const target = inserted[0];
      if (target) {
        editor.setTextCursorPosition(target, "start");
      }
    });
  }, [editor]);

  const syncEditorContent = useCallback(
    (markdownText: string, docValue: unknown) => {
      const parsedFromDoc = resolveBlocksFromDoc(docValue);
      const parsed = parsedFromDoc ?? (markdownText.trim()
        ? editor.tryParseMarkdownToBlocks(markdownText)
        : [EMPTY_BLOCK]);
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
    currentValueDocRef.current = valueDoc;
    const normalizedIncoming = normalizeForCompare(value);
    const normalizedIncomingDoc = normalizeDocForCompare(valueDoc);
    if (
      normalizedIncoming === lastSyncedValueRef.current
      && normalizedIncomingDoc === lastSyncedDocRef.current
    ) return;

    try {
      syncEditorContent(value, valueDoc);
      lastSyncedValueRef.current = normalizedIncoming;
      lastSyncedDocRef.current = normalizedIncomingDoc;
    } catch {
      // Keep editor interactive even if parsing a malformed markdown chunk fails.
    }
  }, [value, valueDoc, syncEditorContent]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        window.clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      commitEditorMarkdown();
    };
  }, [commitEditorMarkdown]);

  return (
    <div className="task-details-surface task-details-surface--editing">
      <BlockNoteViewRaw
        editor={editor}
        className="task-details-cm"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={!isTauri}
        emojiPicker={false}
        sideMenu={false}
        filePanel={true}
        tableHandles={false}
        comments={false}
        onChange={() => {
          scheduleAutosave();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
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
