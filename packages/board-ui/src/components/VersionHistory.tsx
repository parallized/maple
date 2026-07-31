import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CHANGELOG } from "../lib/changelog";
import type { UiLanguage } from "../lib/constants";

type VersionHistoryProps = {
  version: string;
  uiLanguage: UiLanguage;
};

/** 侧栏底部的版本号，悬停（触屏点按）弹出更新历史。 */
export function VersionHistory({ version, uiLanguage }: VersionHistoryProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("查看更新历史", "View changelog")}
        onClick={() => setOpen((previous) => !previous)}
        className={`px-2.5 pt-1 text-[11px] leading-4 select-none transition-colors ${
          open ? "text-(--color-secondary)" : "text-(--color-secondary)/50 hover:text-(--color-secondary)"
        }`}
      >
        v{version}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label={t("更新历史", "Changelog")}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-full left-0 mb-2 flex max-h-[60vh] w-[min(300px,76vw)] flex-col overflow-hidden rounded-[12px] border border-(--color-base-300) bg-(--color-base-100)"
          >
            <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
              <Icon icon="mingcute:history-line" className="text-[14px] text-(--color-secondary)/70" />
              <span className="text-[12.5px] font-semibold text-(--color-base-content)">{t("更新历史", "Changelog")}</span>
            </div>
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-3.5 pb-3.5">
              {CHANGELOG.map((entry) => (
                <section key={entry.version}>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[12.5px] font-semibold ${entry.version === version ? "text-(--color-primary)" : "text-(--color-base-content)"}`}>
                      v{entry.version}
                    </span>
                    <span className="text-[11px] text-(--color-secondary)/60">{entry.date}</span>
                    {entry.version === version ? (
                      <span className="rounded-[4px] bg-(--color-primary)/15 px-1 text-[9.5px] font-bold leading-[15px] tracking-[0.05em] text-(--color-primary)">
                        {t("当前", "CURRENT")}
                      </span>
                    ) : null}
                  </div>
                  <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
                    {(uiLanguage === "en" ? entry.highlights.en : entry.highlights.zh).map((line) => (
                      <li key={line} className="flex items-start gap-1.5 text-[12px] leading-5 text-(--color-secondary)">
                        <span className="mt-[9px] size-1 flex-none rounded-full bg-(--color-secondary)/40" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
