import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "framer-motion";
import { WorkerLogo } from "./WorkerLogo";
import { SplitText } from "./ReactBits";
import type { ViewKey } from "../domain";
import type { Project } from "../domain";
import type { UiLanguage } from "../lib/constants";

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
  onCreateProject,
  onToggleConsole,
  onMinimize,
  onToggleMaximize,
  onClose
}: TopNavProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

  return (
    <nav className="topnav">
      <div className="topnav-brand">
        <Icon icon="mingcute:maple-leaf-line" className="text-lg" />
        <SplitText text="Maple" className="inline" delay={40} />
      </div>

      <div className="flex items-center gap-2 rounded-xl">
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
          <AnimatePresence>
            {projects.map((project, index) => {
              const active = view === "board" && boardProjectId === project.id;
              const pending = project.tasks.filter((t) => t.status !== "已完成").length;
              return (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0, transition: { delay: index * 0.05 } }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  key={project.id}
                  type="button"
                  className={`topnav-tab ${active ? "active" : ""}`}
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
                  {pending > 0 ? <span className="topnav-queue-count">{pending}</span> : null}
                </motion.button>
              );
            })}
          </AnimatePresence>
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
          <Icon icon="mingcute:terminal-line" className="text-sm" />
          {inProgressCount > 0 ? <span className="topnav-queue-count topnav-queue-count--global">{inProgressCount}</span> : null}
          {runningCount > 0 && (
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
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
