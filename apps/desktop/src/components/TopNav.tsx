import { Icon } from "@iconify/react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { WorkerLogo } from "./WorkerLogo";
import { SplitText } from "./ReactBits";
import type { ViewKey } from "../domain";
import type { Project } from "../domain";
import type { UiLanguage } from "../lib/constants";

import { WORKER_KINDS } from "../lib/constants";

type TopNavProps = {
  isTauri: boolean;
  windowMaximized: boolean;
  view: ViewKey;
  projects: Project[];
  boardProjectId: string | null;
  runningCount: number;
  inProgressCount: number;
  workerConsoleOpen: boolean;
  uiLanguage: UiLanguage;
  onViewChange: (view: ViewKey) => void;
  onProjectSelect: (projectId: string) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onCreateProject: () => void;
  onToggleConsole: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function TopNav({
  isTauri,
  windowMaximized,
  view,
  projects,
  boardProjectId,
  runningCount,
  inProgressCount,
  workerConsoleOpen,
  uiLanguage,
  onViewChange,
  onProjectSelect,
  onReorderProjects,
  onCreateProject,
  onToggleConsole,
  onMinimize,
  onToggleMaximize,
  onClose
}: TopNavProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const projectOrder = projects.map((project) => project.id);

  return (
    <nav className="topnav" data-tauri-drag-region={isTauri ? "true" : undefined}>
      <div className="topnav-brand">
        <Icon icon="mingcute:quill-pen-ai-fill" className="text-lg" />
        <SplitText text="Maple" className="inline" delay={40} />
      </div>

      <div className="flex items-center gap-2 topnav-tabs-wrapper">
        <button
          type="button"
          className={`topnav-tab ${view === "overview" ? "active" : ""}`}
          onClick={() => onViewChange("overview")}
        >
          <div className="flex items-center justify-center">
            <Icon icon="mingcute:home-4-line" className="text-base opacity-70" />
          </div>
          <span>{t("概览", "Overview")}</span>
        </button>

        <div className="w-px h-4 bg-(--color-base-300) mx-1" />

        <div className="topnav-scroll">
          <Reorder.Group
            as="div"
            axis="x"
            values={projectOrder}
            onReorder={onReorderProjects}
            className="flex items-center gap-2"
          >
            <AnimatePresence>
              {projects.map((project, index) => {
              const active = view === "board" && boardProjectId === project.id;
              const confirmCount = project.tasks.filter((t) => t.status === "已完成" && t.needsConfirmation).length;
              const isExecuting = project.tasks.some((t) => t.status === "队列中" || t.status === "进行中");
              const todoCount = project.tasks.filter((t) => t.status === "待办" || t.status === "待返工").length;
              const workerColor = project.workerKind 
                ? WORKER_KINDS.find(w => w.kind === project.workerKind)?.color 
                : "var(--color-primary)";

              const badgeTitle =
                confirmCount > 0
                  ? t("待确认", "Needs review")
                  : isExecuting
                    ? t("执行中", "Running")
                    : todoCount > 0
                      ? t("待办", "Todo")
                      : "";

                return (
                  <Reorder.Item
                    key={project.id}
                    value={project.id}
                    className="flex"
                    whileDrag={{
                      scale: 1.03,
                      y: -2,
                      zIndex: 10,
                      boxShadow: "0 10px 24px rgba(0, 0, 0, 0.16)"
                    }}
                  >
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0, transition: { delay: index * 0.05 } }}
                      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      type="button"
                      className={`topnav-tab ${active ? "active" : ""}`}
                      style={{ "--worker-color": workerColor } as React.CSSProperties}
                      onClick={() => onProjectSelect(project.id)}
                      title={project.directory}
                    >
                      <div className="flex items-center justify-center">
                        {project.workerKind ? (
                          <WorkerLogo kind={project.workerKind} size={15} className="opacity-80" />
                        ) : (
                          <Icon icon="mingcute:folder-open-line" className="text-[15px] opacity-70" />
                        )}
                      </div>
                      <span className="truncate max-w-[120px]">{project.name}</span>
                      {confirmCount > 0 ? (
                        <span className="topnav-queue-count--warning" title={badgeTitle}>?</span>
                      ) : isExecuting ? (
                        <span className="topnav-queue-count topnav-queue-count--spinning" title={badgeTitle}>
                          <Icon icon="mingcute:loading-line" className="text-[12px]" />
                        </span>
                      ) : todoCount > 0 ? (
                        <span className="topnav-queue-count" title={badgeTitle}>
                          {todoCount}
                        </span>
                      ) : null}
                    </motion.button>
                  </Reorder.Item>
                );
              })}
            </AnimatePresence>
          </Reorder.Group>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            className="topnav-tab px-2"
            onClick={onCreateProject}
          >
            <Icon icon="mingcute:add-line" className="text-base opacity-70" />
          </motion.button>
        </div>
      </div>

      <div className="topnav-actions ml-auto flex items-center gap-2">
        <button
          type="button"
          className={`topnav-tab ${workerConsoleOpen ? "active" : ""}`}
          onClick={onToggleConsole}
          title={t("控制台", "Console")}
        >
          <Icon icon="mingcute:terminal-line" className="text-sm opacity-80" />
          {inProgressCount > 0 ? (
            <span className="topnav-queue-count topnav-queue-count--global">
              {inProgressCount}
            </span>
          ) : null}
          {runningCount > 0 && inProgressCount === 0 && (
            <span className="flex h-1.5 w-1.5 rounded-full bg-(--color-base-content) opacity-40 animate-pulse ml-0.5" />
          )}
        </button>

        <button
          type="button"
          className="topnav-tab"
          onClick={() => onViewChange("settings")}
          title={t("设置", "Settings")}
        >
          <Icon icon="mingcute:settings-3-line" className="text-sm" />
        </button>

        {isTauri ? (
          <>
            <div className="w-px h-4 bg-(--color-base-300) mx-1" />
            <div className="flex items-center gap-2">
              <button type="button" className="topnav-wc" onClick={onMinimize} aria-label={t("最小化", "Minimize")}>
                <Icon icon="mingcute:minimize-line" />
              </button>
              <button type="button" className="topnav-wc" onClick={onToggleMaximize} aria-label={t("最大化", "Maximize")}>
                <Icon icon={windowMaximized ? "mingcute:minimize-line" : "mingcute:fullscreen-line"} />
              </button>
              <button
                type="button"
                className="topnav-wc hover:bg-error/10 hover:text-error"
                onClick={onClose}
                aria-label={t("关闭", "Close")}
              >
                <Icon icon="mingcute:close-line" />
              </button>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}
