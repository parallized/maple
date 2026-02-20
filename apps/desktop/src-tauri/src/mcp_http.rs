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

const MCP_PORT: u16 = 45819;

pub struct McpHttpState {
    #[allow(dead_code)]
    pub app_handle: tauri::AppHandle,
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
    status: String,
    tags: Vec<String>,
    version: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    reports: Vec<TaskReport>,
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
    let mut todos: Vec<&Task> = target.tasks.iter().filter(|t| t.status != "已完成").collect();
    todos.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    if todos.is_empty() {
        return json!({ "content": [{ "type": "text", "text":
            format!("项目「{}」暂无未完成任务。", target.name)
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
            format!("{}. [{}] {}{}  (id: {})", i + 1, t.status, t.title, tags, t.id)
        })
        .collect();

    json!({ "content": [{ "type": "text", "text": format!(
        "项目「{}」— {} 个未完成任务：\n\n{}",
        target.name, todos.len(), lines.join("\n")
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

fn tool_submit_task_report(args: &Value) -> Value {
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

    write_state(&projects);

    let status_text = status
        .map(|s| format!("状态已更新为「{s}」"))
        .unwrap_or_else(|| "状态未变更".into());

    json!({ "content": [{ "type": "text", "text":
        format!("已提交报告至「{target_name}」任务「{task_title}」。{status_text}。")
    }]})
}

fn tool_finish_worker(args: &Value) -> Value {
    let project = args
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let dir = state_dir();
    let _ = fs::create_dir_all(&dir);
    let signal = json!({
        "project": project,
        "summary": summary,
        "timestamp": iso_now(),
        "action": "finish"
    });
    let _ = fs::write(
        dir.join("worker-signal.json"),
        serde_json::to_string_pretty(&signal).unwrap_or_default(),
    );

    json!({ "content": [{ "type": "text", "text":
        format!("已通知 Maple 项目「{project}」的 Worker 执行完毕。")
    }]})
}

// ── JSON-RPC / MCP Handler ──

async fn handle_mcp_post(
    AxumState(_state): AxumState<Arc<McpHttpState>>,
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
                "submit_task_report" => tool_submit_task_report(&arguments),
                "finish_worker" => tool_finish_worker(&arguments),
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
            "description": "按项目名查询未完成任务，返回状态、更新时间与标签。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "项目名称（模糊匹配）" }
                },
                "required": ["project"]
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
                        "enum": ["待办", "队列中", "进行中", "需要更多信息", "已完成", "已阻塞"],
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
            "name": "finish_worker",
            "description": "通知 Maple 当前 Worker 已执行完毕，可以结束进程。",
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
