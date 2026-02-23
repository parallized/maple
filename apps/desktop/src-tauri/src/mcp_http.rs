use axum::{
    extract::State as AxumState,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::collections::BTreeMap;
use tauri::Emitter;

const MCP_PORT: u16 = 45819;

pub struct McpHttpState {
    pub app_handle: tauri::AppHandle,
}

// ── Events emitted to frontend ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskUpdatedEvent {
    project_name: String,
    task: Task,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TagCatalogUpdatedEvent {
    project_name: String,
    tag_catalog: BTreeMap<String, TagDefinition>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkerFinishedEvent {
    project: String,
    summary: String,
}

// ── Data Types (matching frontend domain.ts) ──

#[derive(Deserialize, Serialize, Clone)]
struct TaskReport {
    id: String,
    author: String,
    content: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct Task {
    id: String,
    title: String,
    #[serde(default)]
    details: String,
    status: String,
    tags: Vec<String>,
    version: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    reports: Vec<TaskReport>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
struct TagLabel {
    #[serde(skip_serializing_if = "Option::is_none")]
    zh: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    en: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
struct TagDefinition {
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<TagLabel>,
}

#[derive(Deserialize, Serialize, Clone)]
struct Project {
    id: String,
    name: String,
    version: String,
    directory: String,
    #[serde(rename = "workerKind", skip_serializing_if = "Option::is_none")]
    worker_kind: Option<String>,
    tasks: Vec<Task>,
    #[serde(rename = "tagCatalog", default)]
    tag_catalog: BTreeMap<String, TagDefinition>,
}

// ── State File ──

fn state_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".maple")
}

fn read_state() -> Vec<Project> {
    let path = state_dir().join("state.json");
    if !path.exists() {
        return vec![];
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state(projects: &[Project]) {
    let dir = state_dir();
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string_pretty(projects) {
        let _ = fs::write(dir.join("state.json"), json);
    }
}

fn find_project_index(projects: &[Project], name: &str) -> Option<usize> {
    let kw = name.trim().to_lowercase();
    if kw.is_empty() {
        return None;
    }
    projects
        .iter()
        .position(|p| p.name.to_lowercase() == kw)
        .or_else(|| projects.iter().position(|p| p.name.to_lowercase().contains(&kw)))
}

fn iso_now() -> String {
    Utc::now()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn truncate_chars(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

fn summarize_report_content(content: &str, max_chars: usize) -> String {
    let collapsed = content
        .replace("\r\n", "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" / ");
    if collapsed.is_empty() {
        return "（空）".to_string();
    }
    let preview = truncate_chars(&collapsed, max_chars);
    if collapsed.chars().count() > max_chars {
        format!("{preview}...")
    } else {
        preview.to_string()
    }
}

fn build_report_history_lines(reports: &[TaskReport]) -> Vec<String> {
    let mut sorted: Vec<&TaskReport> = reports
        .iter()
        .filter(|report| !report.content.trim().is_empty())
        .collect();
    if sorted.is_empty() {
        return vec!["历史报告：".to_string(), "（无）".to_string()];
    }

    sorted.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let total = sorted.len();
    let max_items = 5usize;
    let displayed = sorted.into_iter().take(max_items).collect::<Vec<_>>();

    let mut lines = vec![format!(
        "历史报告（最近 {} / 共 {} 条）：",
        displayed.len(),
        total
    )];
    lines.extend(displayed.into_iter().map(|report| {
        let author = if report.author.trim().is_empty() {
            "unknown"
        } else {
            report.author.trim()
        };
        let timestamp = if report.created_at.trim().is_empty() {
            "未知时间"
        } else {
            report.created_at.trim()
        };
        let preview = summarize_report_content(&report.content, 220);
        format!("- {author} @ {timestamp}: {preview}")
    }));
    if total > max_items {
        lines.push(format!("... 其余 {} 条已省略。", total - max_items));
    }
    lines
}

fn is_terminal_task_status(status: &str) -> bool {
    matches!(status, "已完成" | "已阻塞" | "需要更多信息")
}

fn normalize_tag_id(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn is_valid_mingcute_icon(icon: &str) -> bool {
    icon.trim().to_lowercase().starts_with("mingcute:")
}

// ── MCP Tool Handlers ──

fn tool_query_project_todos(args: &Value) -> Value {
    let name = args.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let projects = read_state();

    let Some(idx) = find_project_index(&projects, name) else {
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        return json!({ "content": [{ "type": "text", "text": format!(
            "未找到匹配项目「{name}」。可用项目：{}",
            if names.is_empty() { "（无）".to_string() } else { names.join("、") }
        )}]});
    };

    let target = &projects[idx];
    let mut todos: Vec<&Task> = target
        .tasks
        .iter()
        .filter(|t| t.status != "已完成" && t.status != "草稿")
        .collect();
    todos.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    if todos.is_empty() {
        return json!({ "content": [{ "type": "text", "text":
            format!("项目「{}」暂无待处理任务。", target.name)
        }]});
    }

    let lines: Vec<String> = todos
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let tags = if t.tags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", t.tags.join(", "))
            };
            let title = if t.title.trim().is_empty() {
                "（无标题）"
            } else {
                t.title.as_str()
            };
            let details = t.details.trim();
            let details_text = if details.is_empty() { "（空）" } else { details };
            let mut block = vec![
                format!("{}. [{}] {}{}  (id: {})", i + 1, t.status, title, tags, t.id),
                "详情：".to_string(),
                details_text.to_string(),
                String::new(),
            ];
            block.extend(build_report_history_lines(&t.reports));
            block.join("\n")
        })
        .collect();

    json!({ "content": [{ "type": "text", "text": format!(
        "项目「{}」— {} 个待处理任务（不含草稿）：\n\n{}",
        target.name, todos.len(), lines.join("\n\n---\n\n")
    )}]})
}

fn tool_query_recent_context(args: &Value) -> Value {
    let project_name = args.get("project").and_then(|v| v.as_str());
    let keyword = args.get("keyword").and_then(|v| v.as_str());
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .max(1) as usize;

    let projects = read_state();
    let indices: Vec<usize> = if let Some(name) = project_name {
        find_project_index(&projects, name).into_iter().collect()
    } else {
        (0..projects.len()).collect()
    };

    let mut items: Vec<(String, String, String, String)> = Vec::new();
    for idx in indices {
        let p = &projects[idx];
        for task in &p.tasks {
            for report in &task.reports {
                let content = report.content.trim();
                if content.is_empty() {
                    continue;
                }
                if let Some(kw) = keyword {
                    if !content.to_lowercase().contains(&kw.to_lowercase()) {
                        continue;
                    }
                }
                items.push((
                    p.name.clone(),
                    task.title.clone(),
                    report.created_at.clone(),
                    content.to_string(),
                ));
            }
        }
    }

    items.sort_by(|a, b| b.2.cmp(&a.2));
    let result: Vec<_> = items.iter().take(limit).collect();

    if result.is_empty() {
        return json!({ "content": [{ "type": "text", "text": "未找到匹配的任务报告。" }]});
    }

    let lines: Vec<String> = result
        .iter()
        .map(|(proj, task, at, text)| {
            let preview = truncate_chars(text, 200);
            format!("[{proj}] {task}\n  时间：{at}\n  内容：{preview}")
        })
        .collect();

    json!({ "content": [{ "type": "text", "text": lines.join("\n\n") }]})
}

fn tool_query_task_details(args: &Value) -> Value {
    let project_name = args
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let task_id = args
        .get("task_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let projects = read_state();
    let Some(idx) = find_project_index(&projects, project_name) else {
        return json!({
            "content": [{ "type": "text", "text": format!("未找到匹配项目「{project_name}」。") }],
            "isError": true
        });
    };

    let target = &projects[idx];
    let Some(task) = target.tasks.iter().find(|t| t.id == task_id) else {
        return json!({
            "content": [{ "type": "text", "text": format!("项目「{}」中未找到任务 ID「{task_id}」。", target.name) }],
            "isError": true
        });
    };

    let tags = if task.tags.is_empty() {
        "（无）".to_string()
    } else {
        task.tags.join("、")
    };
    let details = task.details.trim();
    let details_text = if details.is_empty() { "（空）" } else { details };

    let lines: Vec<String> = vec![
        format!("任务：{}  (id: {})", task.title, task.id),
        format!("状态：{}", task.status),
        format!("标签：{}", tags),
        format!("版本：{}", task.version),
        format!("更新时间：{}", task.updated_at),
        String::new(),
        "详情：".to_string(),
        details_text.to_string(),
    ];

    json!({ "content": [{ "type": "text", "text": lines.join("\n") }]})
}

fn tool_submit_task_report(args: &Value, state: &McpHttpState) -> Value {
    let project_name = args
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let task_id = args
        .get("task_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let status = args.get("status").and_then(|v| v.as_str());
    let report_content = args.get("report").and_then(|v| v.as_str()).unwrap_or("");
    let tags: Vec<String> = args
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .take(5)
                .collect()
        })
        .unwrap_or_default();

    let mut projects = read_state();

    let Some(idx) = find_project_index(&projects, project_name) else {
        return json!({
            "content": [{ "type": "text", "text": format!("未找到匹配项目「{project_name}」。") }],
            "isError": true
        });
    };

    let target = &mut projects[idx];
    let target_name = target.name.clone();

    let Some(task) = target.tasks.iter_mut().find(|t| t.id == task_id) else {
        return json!({
            "content": [{ "type": "text", "text": format!("项目「{target_name}」中未找到任务 ID「{task_id}」。") }],
            "isError": true
        });
    };

    let now = iso_now();
    let task_title = task.title.clone();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    task.reports.push(TaskReport {
        id: format!("report-{ts}"),
        author: "mcp".into(),
        content: report_content.into(),
        created_at: now.clone(),
    });
    task.updated_at = now;
    if let Some(s) = status {
        task.status = s.into();
    }
    if !tags.is_empty() {
        task.tags = tags;
    }
    let task_snapshot = task.clone();

    write_state(&projects);
    let _ = state.app_handle.emit(
        "maple://task-updated",
        TaskUpdatedEvent {
            project_name: target_name.clone(),
            task: task_snapshot,
        },
    );

    let status_text = status
        .map(|s| format!("状态已更新为「{s}」"))
        .unwrap_or_else(|| "状态未变更".into());

    json!({ "content": [{ "type": "text", "text":
        format!("已提交报告至「{target_name}」任务「{task_title}」。{status_text}。")
    }]})
}

fn tool_query_tag_catalog(args: &Value) -> Value {
    let name = args.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let projects = read_state();

    let Some(idx) = find_project_index(&projects, name) else {
        return json!({
            "content": [{ "type": "text", "text": format!("未找到匹配项目「{name}」。") }],
            "isError": true
        });
    };

    let target = &projects[idx];
    if target.tag_catalog.is_empty() {
        return json!({ "content": [{ "type": "text", "text":
            format!("项目「{}」暂无 Tag Catalog。", target.name)
        }]});
    }

    let mut lines: Vec<String> = Vec::new();
    for (tag, def) in &target.tag_catalog {
        let color = def
            .color
            .as_deref()
            .unwrap_or("（未设置）");
        let icon = def
            .icon
            .as_deref()
            .unwrap_or("（未设置）");
        let label_zh = def
            .label
            .as_ref()
            .and_then(|label| label.zh.as_deref())
            .unwrap_or("（未设置）");
        let label_en = def
            .label
            .as_ref()
            .and_then(|label| label.en.as_deref())
            .unwrap_or("（未设置）");
        lines.push(format!(
            "- {}  color: {}  icon: {}  label.zh: {}  label.en: {}",
            tag, color, icon, label_zh, label_en
        ));
    }

    json!({ "content": [{ "type": "text", "text": format!(
        "项目「{}」Tag Catalog：\n{}",
        target.name,
        lines.join("\n")
    )}]})
}

fn tool_upsert_tag_definition(args: &Value, state: &McpHttpState) -> Value {
    let project_name = args.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let tag_raw = args.get("tag").and_then(|v| v.as_str()).unwrap_or("");
    let tag_id = normalize_tag_id(tag_raw);
    if tag_id.is_empty() {
        return json!({
            "content": [{ "type": "text", "text": "tag 不能为空。"}],
            "isError": true
        });
    }

    let color = args.get("color").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty());
    let icon = args.get("icon").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty());
    if let Some(i) = icon {
        if !is_valid_mingcute_icon(i) {
            return json!({
                "content": [{ "type": "text", "text": "icon 必须是 Iconify 的 mingcute 图标（例如 mingcute:tag-line）。"}],
                "isError": true
            });
        }
    }
    let label_zh = args.get("label_zh").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty());
    let label_en = args.get("label_en").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty());

    let mut projects = read_state();
    let Some(idx) = find_project_index(&projects, project_name) else {
        return json!({
            "content": [{ "type": "text", "text": format!("未找到匹配项目「{project_name}」。") }],
            "isError": true
        });
    };

    let target = &mut projects[idx];
    let target_name = target.name.clone();

    let entry = target.tag_catalog.entry(tag_id.clone()).or_default();
    if let Some(c) = color {
        entry.color = Some(c.to_string());
    }
    if let Some(i) = icon {
        entry.icon = Some(i.to_lowercase());
    }
    if label_zh.is_some() || label_en.is_some() {
        let mut label = entry.label.clone().unwrap_or_default();
        if let Some(zh) = label_zh {
            label.zh = Some(zh.to_string());
        }
        if let Some(en) = label_en {
            label.en = Some(en.to_string());
        }
        if label.zh.is_none() && label.en.is_none() {
            entry.label = None;
        } else {
            entry.label = Some(label);
        }
    }

    let catalog_snapshot = target.tag_catalog.clone();

    write_state(&projects);
    let _ = state.app_handle.emit(
        "maple://tag-catalog-updated",
        TagCatalogUpdatedEvent {
            project_name: target_name.clone(),
            tag_catalog: catalog_snapshot.clone(),
        },
    );

    json!({ "content": [{ "type": "text", "text":
        format!("已更新「{target_name}」Tag「{tag_id}」定义。")
    }]})
}

fn tool_finish_worker(args: &Value, state: &McpHttpState) -> Value {
    let project_name = args
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let projects = read_state();
    let Some(idx) = find_project_index(&projects, project_name) else {
        return json!({
            "content": [{ "type": "text", "text": format!("未找到匹配项目「{project_name}」。") }],
            "isError": true
        });
    };

    let target = &projects[idx];
    let unresolved_tasks: Vec<&Task> = target
        .tasks
        .iter()
        .filter(|task| !is_terminal_task_status(&task.status))
        .collect();

    if !unresolved_tasks.is_empty() {
        let mut lines: Vec<String> = vec![
            format!(
                "项目「{}」仍有 {} 个任务未收敛，禁止 finish_worker。",
                target.name,
                unresolved_tasks.len()
            ),
            "请先对每条任务调用 submit_task_report，将状态更新为：已完成 / 已阻塞 / 需要更多信息。".into(),
            String::new(),
        ];
        lines.extend(
            unresolved_tasks
                .iter()
                .enumerate()
                .map(|(index, task)| {
                    format!(
                        "{}. [{}] {}  (id: {})",
                        index + 1,
                        task.status,
                        task.title,
                        task.id
                    )
                }),
        );
        return json!({
            "content": [{ "type": "text", "text": lines.join("\n") }],
            "isError": true
        });
    }

    let dir = state_dir();
    let _ = fs::create_dir_all(&dir);
    let signal = json!({
        "project": target.name,
        "summary": summary,
        "timestamp": iso_now(),
        "action": "finish"
    });
    let _ = fs::write(
        dir.join("worker-signal.json"),
        serde_json::to_string_pretty(&signal).unwrap_or_default(),
    );
    let _ = state.app_handle.emit(
        "maple://worker-finished",
        WorkerFinishedEvent {
            project: target.name.clone(),
            summary: summary.to_string(),
        },
    );

    json!({ "content": [{ "type": "text", "text":
        format!("已通知 Maple 项目「{}」的 Worker 执行完毕。", target.name)
    }]})
}

// ── JSON-RPC / MCP Handler ──

async fn handle_mcp_post(
    AxumState(state): AxumState<Arc<McpHttpState>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let id = body.get("id").cloned();
    let method = body
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let params = body.get("params").cloned().unwrap_or(json!({}));

    // Notification (no id) → 202 Accepted
    if id.is_none() || id.as_ref() == Some(&Value::Null) {
        return (StatusCode::ACCEPTED, Json(json!(null)));
    }

    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2025-03-26",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "maple", "version": "0.1.0" }
        }),

        "ping" => json!({}),

        "tools/list" => json!({ "tools": tool_definitions() }),

        "tools/call" => {
            let tool_name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            match tool_name {
                "query_project_todos" => tool_query_project_todos(&arguments),
                "query_recent_context" => tool_query_recent_context(&arguments),
                "query_task_details" => tool_query_task_details(&arguments),
                "submit_task_report" => tool_submit_task_report(&arguments, state.as_ref()),
                "query_tag_catalog" => tool_query_tag_catalog(&arguments),
                "upsert_tag_definition" => tool_upsert_tag_definition(&arguments, state.as_ref()),
                "finish_worker" => tool_finish_worker(&arguments, state.as_ref()),
                _ => json!({
                    "content": [{ "type": "text", "text": format!("未知工具：{tool_name}") }],
                    "isError": true
                }),
            }
        }

        _ => {
            return (
                StatusCode::OK,
                Json(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Method not found: {method}") }
                })),
            );
        }
    };

    (
        StatusCode::OK,
        Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })),
    )
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "query_project_todos",
            "description": "按项目名查询待处理任务（不含草稿/已完成），返回状态、标签、详情与历史报告摘要。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（模糊匹配）" }
                },
                "required": ["project"]
            }
        }),
        json!({
            "name": "query_task_details",
            "description": "查询指定任务的详情内容（包含 markdown、图片、文件引用等）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（模糊匹配）" },
                    "task_id": { "type": "string", "description": "任务 ID" }
                },
                "required": ["project", "task_id"]
            }
        }),
        json!({
            "name": "query_recent_context",
            "description": "查询最近任务报告，支持项目名和关键词过滤。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（可选，模糊匹配）" },
                    "keyword": { "type": "string", "description": "搜索关键词（可选）" },
                    "limit": { "type": "number", "description": "最多返回条数" }
                }
            }
        }),
        json!({
            "name": "submit_task_report",
            "description": "提交任务执行报告，并可修改任务状态。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称" },
                    "task_id": { "type": "string", "description": "任务 ID" },
                    "status": {
                        "type": "string",
                        "enum": ["草稿", "待办", "待返工", "队列中", "进行中", "需要更多信息", "已完成", "已阻塞"],
                        "description": "新状态（可选）"
                    },
                    "report": { "type": "string", "description": "报告内容" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "标签列表（可选，0-5 个）"
                    }
                },
                "required": ["project", "task_id", "report"]
            }
        }),
        json!({
            "name": "query_tag_catalog",
            "description": "查询项目 Tag Catalog（标签定义：颜色/图标/多语言 label）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（模糊匹配）" }
                },
                "required": ["project"]
            }
        }),
        json!({
            "name": "upsert_tag_definition",
            "description": "创建或更新 Tag 定义（用于 UI 渲染颜色/图标/多语言 label）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（模糊匹配）" },
                    "tag": { "type": "string", "description": "Tag ID（会被 trim + lower-case 归一化）" },
                    "color": { "type": "string", "description": "CSS 颜色（例如 #22c55e / hsl(...) / var(--color-primary)）" },
                    "icon": { "type": "string", "description": "Iconify 图标（仅允许 mingcute 集，例如 mingcute:tag-line）" },
                    "label_zh": { "type": "string", "description": "中文展示名（可选）" },
                    "label_en": { "type": "string", "description": "英文展示名（可选）" }
                },
                "required": ["project", "tag"]
            }
        }),
        json!({
            "name": "finish_worker",
            "description": "通知 Maple 当前 Worker 已执行完毕。调用前必须确保项目内无草稿/待办/待返工/队列中/进行中任务。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称" },
                    "summary": { "type": "string", "description": "执行总结（可选）" }
                },
                "required": ["project"]
            }
        }),
    ]
}

// ── Server Startup ──

pub fn start(app_handle: tauri::AppHandle) {
    let state = Arc::new(McpHttpState { app_handle });
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/mcp", post(handle_mcp_post))
            .with_state(state);

        match tokio::net::TcpListener::bind(format!("127.0.0.1:{MCP_PORT}")).await {
            Ok(listener) => {
                eprintln!("Maple MCP HTTP server listening on 127.0.0.1:{MCP_PORT}");
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("Maple MCP HTTP server error: {e}");
                }
            }
            Err(e) => {
                eprintln!(
                    "Failed to bind Maple MCP HTTP server on port {MCP_PORT}: {e}"
                );
            }
        }
    });
}
