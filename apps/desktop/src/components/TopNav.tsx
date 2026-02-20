import { Icon } from "@iconify/react";
import { SplitText } from "./ReactBits";
import type { ViewKey } from "../domain";
import type { Project } from "../domain";

type TopNavProps = {
  isTauri: boolean;
  windowMaximized: boolean;
  view: ViewKey;
  projects: Project[];
  boardProjectId: string | null;
  runningCount: number;
  inProgressCount: number;
  workerConsoleOpen: boolean;
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
  onViewChange,
  onProjectSelect,
  onCreateProject,
  onToggleConsole,
  onMinimize,
  onToggleMaximize,
  onClose
}: TopNavProps) {
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
          <Icon icon="mingcute:home-4-line" className="text-sm" />
          概览
        </button>

        <div className="w-px h-4 bg-(--color-base-300) mx-1" />

        <div className="flex items-center gap-2">
          {projects.map((project) => {
            const inProgress = project.tasks.filter((task) => task.status === "进行中" || task.status === "队列中").length;
            return (
              <button
                key={project.id}
                type="button"
                className={`topnav-tab ${boardProjectId === project.id && view === "board" ? "active" : ""}`}
                onClick={() => onProjectSelect(project.id)}
              >
                {project.name}
                {inProgress > 0 ? <span className="topnav-queue-count">{inProgress}</span> : null}
              </button>
            );
          })}
          <button type="button" className="topnav-tab px-2" onClick={onCreateProject} aria-label="新建项目">
            <Icon icon="mingcute:add-line" className="text-sm" />
          </button>
        </div>
      </div>

      <div className="topnav-actions ml-auto flex items-center gap-2">
        <button
          type="button"
          className={`topnav-tab ${workerConsoleOpen ? "active" : ""}`}
          onClick={onToggleConsole}
          title="控制台"
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
          title="设置"
        >
          <Icon icon="mingcute:settings-3-line" className="text-sm" />
        </button>

        {isTauri ? (
          <>
            <div className="w-px h-4 bg-(--color-base-300) mx-1" />
            <div className="flex items-center gap-2">
              <button type="button" className="topnav-wc" onClick={onMinimize} aria-label="最小化">
                <Icon icon="mingcute:minimize-line" />
              </button>
              <button type="button" className="topnav-wc" onClick={onToggleMaximize} aria-label="最大化">
                <Icon icon={windowMaximized ? "mingcute:minimize-line" : "mingcute:fullscreen-line"} />
              </button>
              <button type="button" className="topnav-wc hover:bg-error/10 hover:text-error" onClick={onClose} aria-label="关闭">
                <Icon icon="mingcute:close-line" />
              </button>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}
