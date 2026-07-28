import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RegisterProjectRequest, RegisterProjectResponse, WorkerKind } from "@maple/protocol";
import type { MapleApiClient } from "../api/client";
import { loadConfig, saveConfig, upsertProject } from "../config/store";
import type { CliConfig, LocalProject } from "../config/types";
import { selectProjectDirectory, type DirectoryPicker } from "./directory-picker";
import { inspectProject, toRegistration } from "./inspect";

export interface AddProjectOptions {
  path: string;
  name?: string;
  workerKind: WorkerKind;
  configPath: string;
}

export interface ProjectRegistrationApi {
  registerProject(input: RegisterProjectRequest): Promise<RegisterProjectResponse>;
}

export interface SelectAndRegisterProjectOptions {
  configPath: string;
  signal?: AbortSignal;
  directoryPicker?: DirectoryPicker;
}

function sameLocalPath(leftPath: string, rightPath: string): boolean {
  const left = process.platform === "win32" ? leftPath.toLowerCase() : leftPath;
  const right = process.platform === "win32" ? rightPath.toLowerCase() : rightPath;
  return left === right;
}

export async function registerProject(
  api: ProjectRegistrationApi,
  config: CliConfig,
  options: AddProjectOptions
): Promise<{ config: CliConfig; project: LocalProject }> {
  const resolvedPath = resolve(options.path);
  let existing = config.projects.find((project) => sameLocalPath(project.path, resolvedPath));
  let inspected = inspectProject({
    path: resolvedPath,
    name: options.name,
    workerKind: options.workerKind,
    existing
  });
  if (!existing) {
    existing = config.projects.find((project) => sameLocalPath(project.path, inspected.path));
    if (existing) {
      inspected = inspectProject({
        path: inspected.path,
        name: options.name,
        workerKind: options.workerKind,
        existing
      });
    }
  }
  const prepared = upsertProject(config, inspected);
  saveConfig(prepared, options.configPath);
  const registered = await api.registerProject(toRegistration(inspected));
  const project: LocalProject = {
    ...inspected,
    projectId: registered.project.id,
    bindingId: registered.binding.id,
    registeredAt: inspected.registeredAt ?? new Date().toISOString()
  };
  const next = upsertProject(prepared, project);
  saveConfig(next, options.configPath);
  return { config: next, project };
}

/**
 * 由本机 CLI 主动选择并注册目录。项目不再指定执行 Worker；这里的 codex
 * 只用于兼容尚未迁移完成的本机配置字段，不会发送给 Server，也不参与任务派发。
 */
export async function selectAndRegisterProject(
  api: ProjectRegistrationApi,
  options: SelectAndRegisterProjectOptions
): Promise<{ config: CliConfig; project: LocalProject } | null> {
  const selectedPath = await (options.directoryPicker ?? selectProjectDirectory)(options.signal);
  if (!selectedPath || options.signal?.aborted) return null;
  return registerProject(api, loadConfig(options.configPath), {
    path: selectedPath,
    workerKind: "codex",
    configPath: options.configPath
  });
}

export async function synchronizeProjects(
  api: MapleApiClient,
  config: CliConfig,
  configPath: string
): Promise<CliConfig> {
  let next = config;
  for (const project of config.projects) {
    // Web 删除后的 Server 记录不能在 CLI 启动时被旧目录映射重新创建。
    // 再次按 E 选择目录仍会走 registerProject 显式添加。
    if (project.projectId) continue;
    if (!existsSync(project.path)) {
      console.warn(`[maple] 项目目录不可用，已跳过：${project.path}`);
      continue;
    }
    try {
      const result = await registerProject(api, next, {
        path: project.path,
        name: project.name,
        workerKind: project.workerKind,
        configPath
      });
      next = result.config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[maple] 项目同步失败（${project.name}）：${message}`);
    }
  }
  return loadConfig(configPath);
}
