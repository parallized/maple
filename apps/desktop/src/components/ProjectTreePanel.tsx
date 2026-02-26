import { Icon } from "@iconify/react";
import type { Project } from "../domain";

type ProjectTreePanelProps = {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onImportProject: () => void;
};

type TreeNode =
  | {
      kind: "group";
      id: string;
      label: string;
      children: TreeNode[];
    }
  | {
      kind: "project";
      project: Project;
    };

function splitPath(value: string): string[] {
  return value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function commonPrefixLength(list: string[][]): number {
  if (list.length === 0) {
    return 0;
  }
  const minLen = Math.min(...list.map((segments) => segments.length));
  let length = 0;
  while (length < minLen) {
    const token = list[0][length];
    if (!token) {
      break;
    }
    if (!list.every((segments) => segments[length] === token)) {
      break;
    }
    length += 1;
  }
  return length;
}

function buildTree(projects: Project[]): TreeNode[] {
  const parsed = projects.map((project) => ({ project, segments: splitPath(project.directory) }));
  const prefix = commonPrefixLength(parsed.map((item) => item.segments));

  type MutableGroup = {
    label: string;
    id: string;
    groups: Map<string, MutableGroup>;
    projects: Project[];
  };

  const root: MutableGroup = { label: "", id: "", groups: new Map(), projects: [] };

  for (const item of parsed) {
    const rel = item.segments.slice(prefix);
    const groupSegments = rel.length > 1 ? rel.slice(0, -1) : [];

    let cursor = root;
    let path = "";
    for (const seg of groupSegments) {
      path = path ? `${path}/${seg}` : seg;
      const existing = cursor.groups.get(seg);
      if (existing) {
        cursor = existing;
        continue;
      }
      const next: MutableGroup = { label: seg, id: path, groups: new Map(), projects: [] };
      cursor.groups.set(seg, next);
      cursor = next;
    }

    cursor.projects.push(item.project);
  }

  function toNodes(group: MutableGroup): TreeNode[] {
    const children: TreeNode[] = [];

    const groupNodes = [...group.groups.values()]
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"))
      .map<TreeNode>((child) => ({
        kind: "group",
        id: child.id,
        label: child.label,
        children: toNodes(child)
      }));
    children.push(...groupNodes);

    const projectNodes = [...group.projects]
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
      .map<TreeNode>((project) => ({ kind: "project", project }));
    children.push(...projectNodes);

    return children;
  }

  return toNodes(root);
}

function TreeNodes({
  nodes,
  activeProjectId,
  onSelectProject
}: {
  nodes: TreeNode[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        if (node.kind === "group") {
          return (
            <li key={`group:${node.id}`}>
              <details open className="tree-group">
                <summary className="tree-group-summary">
                  <Icon icon="mingcute:folder-2-line" />
                  <span>{node.label}</span>
                </summary>
                <TreeNodes nodes={node.children} activeProjectId={activeProjectId} onSelectProject={onSelectProject} />
              </details>
            </li>
          );
        }

        const project = node.project;
        return (
          <li key={project.id}>
            <button
              type="button"
              className={project.id === activeProjectId ? "tree-node active" : "tree-node"}
              onClick={() => onSelectProject(project.id)}
            >
              <Icon icon="mingcute:folder-open-line" />
              <span>{project.name}</span>
              <small>{project.version}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectTreePanel({ projects, activeProjectId, onSelectProject, onCreateProject, onImportProject }: ProjectTreePanelProps) {
  const nodes = buildTree(projects);

  return (
    <div className="project-tree">
      <header>
        <Icon icon="mingcute:folder-2-line" />
        <strong>项目</strong>
      </header>

      {projects.length === 0 ? <p className="hint">还没有项目。先新建或导入一个目录。</p> : <TreeNodes nodes={nodes} activeProjectId={activeProjectId} onSelectProject={onSelectProject} />}

      <div className="tree-tools">
        <button type="button" onClick={onCreateProject}>
          <Icon icon="mingcute:add-line" />
          新建项目
        </button>
        <button type="button" onClick={onImportProject}>
          <Icon icon="mingcute:folder-upload-line" />
          导入项目
        </button>
      </div>
    </div>
  );
}

