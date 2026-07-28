import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { TaskArtifact } from "../domain";
import { usePlatform } from "../platform/context";

/** 带鉴权拉取附件内容并生成 object URL;卸载或附件变更时回收。variant=thumb 取服务端缩略图,避免大图被浏览器暴力缩小导致文字锯齿。 */
export function useArtifactObjectUrl(taskId: string, artifactId: string, variant?: "thumb" | "full"): { url: string | null; failed: boolean } {
  const platform = usePlatform();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!platform.fetchArtifactBlob) return;
    let stale = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    platform
      .fetchArtifactBlob(taskId, artifactId, variant)
      .then((blob) => {
        if (stale) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [platform, taskId, artifactId, variant]);

  return { url, failed };
}

function ArtifactThumb({ taskId, artifact, onOpen }: { taskId: string; artifact: TaskArtifact; onOpen: () => void }) {
  const { url, failed } = useArtifactObjectUrl(taskId, artifact.id, "thumb");
  return (
    <button
      type="button"
      onClick={onOpen}
      title={artifact.fileName}
      className="group relative block aspect-video w-full overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] bg-(--color-base-200) cursor-zoom-in"
    >
      {url ? (
        <img
          src={url}
          alt={artifact.fileName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : failed ? (
        <span className="flex h-full w-full items-center justify-center text-(--color-secondary)">
          <Icon icon="mingcute:file-warning-line" className="text-[18px] opacity-60" />
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-(--color-secondary)">
          <Icon icon="mingcute:loading-3-line" className="animate-spin text-[16px] opacity-60" />
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 bg-[linear-gradient(to_top,color-mix(in_srgb,var(--color-base-content)_18%,transparent),transparent_55%)]" />
    </button>
  );
}

function ArtifactLightbox({
  taskId,
  artifacts,
  index,
  onClose,
  onNavigate
}: {
  taskId: string;
  artifacts: TaskArtifact[];
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}) {
  const artifact = artifacts[index];
  const { url, failed } = useArtifactObjectUrl(taskId, artifact.id);
  const hasPrev = index > 0;
  const hasNext = index < artifacts.length - 1;

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
      else if (event.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    },
    [onClose, onNavigate, index, hasPrev, hasNext]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const navBtnClass =
    "ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn bg-[color-mix(in_srgb,var(--color-base-100)_72%,transparent)] backdrop-blur-md";

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={artifact.fileName} style={{ zIndex: 120 }}>
      <div className="ui-modal-backdrop" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative z-10 flex max-h-[86vh] w-auto max-w-[88vw] items-center justify-center"
      >
        {url ? (
          <img
            src={url}
            alt={artifact.fileName}
            className="max-h-[86vh] max-w-[88vw] rounded-[12px] object-contain shadow-2xl"
          />
        ) : failed ? (
          <span className="flex h-32 w-48 items-center justify-center rounded-[12px] bg-(--color-base-100) text-(--color-secondary)">
            <Icon icon="mingcute:file-warning-line" className="text-[22px] opacity-60" />
          </span>
        ) : (
          <span className="flex h-32 w-48 items-center justify-center rounded-[12px] bg-(--color-base-100) text-(--color-secondary)">
            <Icon icon="mingcute:loading-3-line" className="animate-spin text-[20px] opacity-60" />
          </span>
        )}

        <button type="button" onClick={onClose} aria-label="关闭" className={`${navBtnClass} absolute -right-2 -top-2`}>
          <Icon icon="mingcute:close-line" />
        </button>

        {hasPrev ? (
          <button type="button" onClick={() => onNavigate(index - 1)} aria-label="上一张" className={`${navBtnClass} absolute -left-12 top-1/2 -translate-y-1/2`}>
            <Icon icon="mingcute:left-line" />
          </button>
        ) : null}
        {hasNext ? (
          <button type="button" onClick={() => onNavigate(index + 1)} aria-label="下一张" className={`${navBtnClass} absolute -right-12 top-1/2 -translate-y-1/2`}>
            <Icon icon="mingcute:right-line" />
          </button>
        ) : null}

        {artifacts.length > 1 ? (
          <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 rounded-md bg-[color-mix(in_srgb,var(--color-base-100)_72%,transparent)] px-2 py-0.5 text-[12px] text-(--color-secondary) backdrop-blur-md">
            {index + 1} / {artifacts.length}
          </span>
        ) : null}
      </motion.div>
    </div>
  );
}

/** 任务附件画廊:缩略图网格 + 点击查看大图(左右切换)。 */
export function TaskArtifactGallery({ taskId, artifacts }: { taskId: string; artifacts: TaskArtifact[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (artifacts.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Icon icon="mingcute:camera-line" className="text-[14px] opacity-70" />
        <span>验收截图 · {artifacts.length}</span>
      </div>
      <div className={artifacts.length === 1 ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
        {artifacts.map((artifact, index) => (
          <ArtifactThumb key={artifact.id} taskId={taskId} artifact={artifact} onOpen={() => setOpenIndex(index)} />
        ))}
      </div>

      <AnimatePresence>
        {openIndex !== null && artifacts[openIndex] ? (
          <ArtifactLightbox
            taskId={taskId}
            artifacts={artifacts}
            index={openIndex}
            onClose={() => setOpenIndex(null)}
            onNavigate={setOpenIndex}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
