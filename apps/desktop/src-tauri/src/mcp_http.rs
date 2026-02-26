use axum::{
    extract::State as AxumState,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashSet, BTreeMap};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;

use crate::maple_fs;

const MCP_PORT: u16 = 45819;
const MCP_IMAGE_MAX_BYTES: usize = 3 * 1024 * 1024;

fn mime_from_extension(ext: &str) -> &'static str {
    let normalized = ext.trim().to_lowercase();
    if normalized == "png" {
        return "image/png";
    }
    if normalized == "jpg" || normalized == "jpeg" {
        return "image/jpeg";
    }
    if normalized == "webp" {
        return "image/webp";
    }
    if normalized == "gif" {
        return "image/gif";
    }
    if normalized == "svg" {
        return "image/svg+xml";
    }
    "application/octet-stream"
}

fn parse_maple_asset_file_name(url: &str) -> Option<&str> {
    let trimmed = url.trim().trim_end_matches('/');
    if let Some(rest) = trimmed.strip_prefix("maple://asset/") {
        return Some(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("maple://localhost/asset/") {
        return Some(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("maple:///asset/") {
        return Some(rest);
    }
    None
}

fn rewrite_maple_asset_urls(text: &str) -> (String, Vec<String>) {
    let mut rewritten = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut assets: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    while let Some(pos) = text[cursor..].find("maple://") {
        let start = cursor + pos;
        rewritten.push_str(&text[cursor..start]);

        let rest = &text[start..];
        let mut end_rel = rest.len();
        for (idx, ch) in rest.char_indices() {
            if ch.is_whitespace() || matches!(ch, ')' | ']' | '"' | '\'' | '<' | '>') {
                end_rel = idx;
                break;
            }
        }

        let url = &rest[..end_rel];
        let file_name = parse_maple_asset_file_name(url).map(str::trim);
        if let Some(file_name) = file_name {
            if maple_fs::is_valid_asset_file_name(file_name) {
                if seen.insert(file_name.to_string()) {
                    assets.push(file_name.to_string());
                }
                rewritten.push_str("asset://");
                rewritten.push_str(file_name);
            } else {
                rewritten.push_str(url);
            }
        } else {
            rewritten.push_str(url);
        }

        cursor = start + end_rel;
    }

    rewritten.push_str(&text[cursor..]);
    (rewritten, assets)
}

fn read_asset_base64_image(file_name: &str) -> Result<(String, &'static str), String> {
    let trimmed = file_name.trim();
    if !maple_fs::is_valid_asset_file_name(trimmed) {
        return Err("无效的 asset 文件名（必须为 64 位小写 hex + 扩展名）。".to_string());
    }

    let dir = maple_fs::asset_dir()?;
    let path = dir.join(trimmed);
    if !path.exists() {
        return Err("asset 文件不存在。".to_string());
    }

    let bytes = fs::read(&path).map_err(|e| format!("读取 asset 文件失败: {e}"))?;
    if bytes.len() > MCP_IMAGE_MAX_BYTES {
        return Err(format!("图片过大（{} bytes），已跳过内联。", bytes.len()));
    }

    let ext = trimmed.split('.').nth(1).unwrap_or_default();
    let mime = mime_from_extension(ext);
    if mime == "application/octet-stream" {
        return Err("不支持的图片类型。".to_string());
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok((encoded, mime))
}

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
    #[serde(rename = "detailsDoc", default, skip_serializing_if = "Option::is_none")]
    details_doc: Option<Value>,
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
    maple_fs::maple_home_dir().unwrap_or_else(|_| std::env::temp_dir().join(".maple"))
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

fn strip_trailing_separators(value: &str) -> &str {
    value.trim_end_matches(|ch| ch == '/' || ch == '\\')
}

fn is_path_like(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('/') {
        return true;
    }
    if trimmed.contains('\\') || trimmed.contains('/') {
        return true;
    }
    let bytes = trimmed.as_bytes();
    bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()
}

fn normalize_windows_drive_path_for_compare(value: &str) -> Option<String> {
    let trimmed = strip_trailing_separators(value.trim());
    let bytes = trimmed.as_bytes();
    if bytes.len() < 2 {
        return None;
    }
    let drive = bytes[0] as char;
    if !drive.is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }
    let mut rest = trimmed[2..].replace('/', "\\");
    while rest.contains("\\\\") {
        rest = rest.replace("\\\\", "\\");
    }
    rest = rest.trim_end_matches('\\').to_string();
    if rest.is_empty() {
        return Some(format!("{}:", drive.to_ascii_lowercase()).to_lowercase());
    }
    if !rest.starts_with('\\') {
        rest = format!("\\{rest}");
    }
    Some(format!("{}:{}", drive.to_ascii_lowercase(), rest).to_lowercase())
}

fn normalize_wsl_mnt_path_for_compare(value: &str) -> Option<String> {
    let trimmed = strip_trailing_separators(value.trim());
    let normalized = trimmed.replace('\\', "/");
    let rest = normalized
        .strip_prefix("/mnt/")
        .or_else(|| normalized.strip_prefix("mnt/"))?;

    let mut parts = rest.splitn(2, '/');
    let drive = parts.next()?.trim();
    if drive.len() != 1 {
        return None;
    }
    let drive_char = drive.chars().next()?.to_ascii_lowercase();
    if !drive_char.is_ascii_alphabetic() {
        return None;
    }
    let tail = parts
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('/')
        .trim();
    if tail.is_empty() {
        return Some(format!("{drive_char}:").to_lowercase());
    }

    let mut windows_tail = tail.replace('/', "\\");
    while windows_tail.contains("\\\\") {
        windows_tail = windows_tail.replace("\\\\", "\\");
    }
    windows_tail = windows_tail.trim_end_matches('\\').to_string();
    Some(format!("{drive_char}:\\{windows_tail}").to_lowercase())
}

fn normalize_directory_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(normalized) = normalize_wsl_mnt_path_for_compare(trimmed) {
        return Some(normalized);
    }
    if let Some(normalized) = normalize_windows_drive_path_for_compare(trimmed) {
        return Some(normalized);
    }

    let normalized = strip_trailing_separators(trimmed).replace('\\', "/");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_lowercase())
    }
}

fn find_project_index(projects: &[Project], name: &str) -> Option<usize> {
    let raw_kw = name.trim();
    let kw = raw_kw.to_lowercase();
    if raw_kw.is_empty() {
        return None;
    }

    projects
        .iter()
        .position(|p| p.name.trim().to_lowercase() == kw)
        .or_else(|| {
            if !is_path_like(raw_kw) {
                return None;
            }
            let query_key = normalize_directory_key(raw_kw)?;
            projects.iter().position(|p| {
                let dir_key = normalize_directory_key(&p.directory);
                dir_key.as_deref() == Some(query_key.as_str())
            })
        })
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
    let (content, _) = rewrite_maple_asset_urls(content);
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
    matches!(status, "草稿" | "已完成" | "已阻塞" | "需要更多信息")
}

fn normalize_tag_id(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn has_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|ch| ('\u{3400}'..='\u{9FFF}').contains(&ch))
}

fn has_latin(value: &str) -> bool {
    value.chars().any(|ch| ch.is_ascii_alphabetic())
}

fn resolve_tag_preset(tag_id: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match tag_id {
        "mcp" => Some(("MCP", "MCP", "mingcute:server-line")),
        "verify" => Some(("验证", "Verify", "mingcute:check-line")),
        "verified" => Some(("已验证", "Verified", "mingcute:check-line")),
        "ui" => Some(("UI", "UI", "mingcute:palette-line")),
        "fix" => Some(("修复", "Fix", "mingcute:shield-line")),
        "i18n" => Some(("多语言", "i18n", "mingcute:translate-line")),
        "tag" => Some(("标签", "Tag", "mingcute:tag-line")),
        "icon" => Some(("图标", "Icon", "mingcute:tag-line")),
        "image" => Some(("图片", "Image", "mingcute:layers-line")),
        "editor" => Some(("编辑器", "Editor", "mingcute:code-line")),
        "desktop" => Some(("桌面端", "Desktop", "mingcute:computer-line")),
        "ci" => Some(("CI", "CI", "mingcute:settings-3-line")),
        "release" => Some(("发布", "Release", "mingcute:settings-3-line")),
        "research" => Some(("调研", "Research", "mingcute:search-line")),
        "blocknote" => Some(("BlockNote", "BlockNote", "mingcute:layers-line")),
        "hapi" => Some(("Hapi", "Hapi", "mingcute:server-line")),
        "interactive" => Some(("交互", "Interactive", "mingcute:palette-line")),
        "area:build" => Some(("构建", "Build", "mingcute:settings-3-line")),
        "area:tags" => Some(("标签", "Tags", "mingcute:tag-line")),
        "area:research" => Some(("调研", "Research", "mingcute:search-line")),
        _ => {
            if let Some(area) = tag_id.strip_prefix("area:") {
                return match area {
                    "core" => Some(("核心", "Core", "mingcute:layout-grid-line")),
                    "ui" => Some(("UI", "UI", "mingcute:palette-line")),
                    "task-detail" => Some(("详情", "Detail", "mingcute:layout-right-line")),
                    "markdown" => Some(("Markdown", "Markdown", "mingcute:layers-line")),
                    "worker" => Some(("执行器", "Worker", "mingcute:ai-line")),
                    "mcp" => Some(("MCP", "MCP", "mingcute:server-line")),
                    "xterm" => Some(("终端", "Terminal", "mingcute:terminal-box-line")),
                    "i18n" => Some(("多语言", "i18n", "mingcute:translate-line")),
                    "build" => Some(("构建", "Build", "mingcute:settings-3-line")),
                    "tags" => Some(("标签", "Tags", "mingcute:tag-line")),
                    "research" => Some(("调研", "Research", "mingcute:search-line")),
                    _ => None,
                };
            }
            None
        }
    }
}

fn build_auto_tag_definition(raw_tag: &str) -> TagDefinition {
    let raw = raw_tag.trim();
    let tag_id = normalize_tag_id(raw);
    let preset = resolve_tag_preset(&tag_id);

    let mut label = TagLabel::default();
    if let Some((zh, en, _)) = preset {
        label.zh = Some(zh.to_string());
        label.en = Some(en.to_string());
    }

    if label.zh.is_none() && !raw.is_empty() && has_cjk(raw) {
        label.zh = Some(raw.to_string());
    }
    if label.en.is_none() && !raw.is_empty() && has_latin(raw) {
        label.en = Some(raw.to_string());
    }
    if label.zh.is_none() && !raw.is_empty() {
        label.zh = Some(raw.to_string());
    }
    if label.en.is_none()
        && label
            .zh
            .as_ref()
            .map(|value| has_latin(value))
            .unwrap_or(false)
    {
        label.en = label.zh.clone();
    }

    TagDefinition {
        color: None,
        icon: Some(
            preset
                .map(|(_, _, icon)| icon.to_string())
                .unwrap_or_else(|| "mingcute:tag-line".to_string()),
        ),
        label: if label.zh.is_some() || label.en.is_some() {
            Some(label)
        } else {
            None
        },
    }
}

fn ensure_tag_catalog_for_tags(
    catalog: &mut BTreeMap<String, TagDefinition>,
    tags: &[String],
) -> bool {
    let mut changed = false;

    for raw_tag in tags {
        let tag_id = normalize_tag_id(raw_tag);
        if tag_id.is_empty() {
            continue;
        }

        let inferred = build_auto_tag_definition(raw_tag);
        let entry = catalog.entry(tag_id).or_default();

        if entry.icon.is_none() && inferred.icon.is_some() {
            entry.icon = inferred.icon;
            changed = true;
        }

        let mut label = entry.label.clone().unwrap_or_default();
        let mut label_changed = false;

        if label.zh.is_none() {
            if let Some(value) = inferred.label.as_ref().and_then(|item| item.zh.clone()) {
                label.zh = Some(value);
                label_changed = true;
            }
        }
        if label.en.is_none() {
            if let Some(value) = inferred.label.as_ref().and_then(|item| item.en.clone()) {
                label.en = Some(value);
                label_changed = true;
            }
        }

        if label_changed {
            entry.label = Some(label);
            changed = true;
        }
    }

    changed
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
            let details_text = if details.is_empty() {
                "（空）".to_string()
            } else {
                rewrite_maple_asset_urls(details).0
            };
            let mut block = vec![
                format!("{}. [{}] {}{}  (id: {})", i + 1, t.status, title, tags, t.id),
                "详情：".to_string(),
                details_text,
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
            let (rewritten, _) = rewrite_maple_asset_urls(text);
            let preview = truncate_chars(&rewritten, 200);
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
    let (details_text, assets) = if details.is_empty() {
        ("（空）".to_string(), Vec::new())
    } else {
        rewrite_maple_asset_urls(details)
    };

    let lines: Vec<String> = vec![
        format!("任务：{}  (id: {})", task.title, task.id),
        format!("状态：{}", task.status),
        format!("标签：{}", tags),
        format!("版本：{}", task.version),
        format!("更新时间：{}", task.updated_at),
        String::new(),
        "详情：".to_string(),
        details_text,
    ];

    let mut content: Vec<Value> = vec![json!({ "type": "text", "text": lines.join("\n") })];
    for file_name in assets {
        match read_asset_base64_image(&file_name) {
            Ok((data, mime_type)) => {
                content.push(json!({ "type": "text", "text": format!("图片：{file_name}") }));
                content.push(json!({ "type": "image", "mimeType": mime_type, "data": data }));
            }
            Err(err) => {
                content.push(json!({ "type": "text", "text": format!("图片读取失败：{file_name}（{err}）") }));
            }
        }
    }

    json!({ "content": content })
}

fn normalize_asset_file_name_arg(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("asset://") {
        return Some(rest.trim());
    }
    if let Some(rest) = parse_maple_asset_file_name(trimmed) {
        return Some(rest.trim());
    }
    Some(trimmed)
}

fn tool_read_asset_image(args: &Value) -> Value {
    let raw = args
        .get("file_name")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("url").and_then(|v| v.as_str()))
        .unwrap_or("");

    let Some(file_name) = normalize_asset_file_name_arg(raw) else {
        return json!({
            "content": [{ "type": "text", "text": "缺少参数：file_name / url。" }],
            "isError": true
        });
    };

    match read_asset_base64_image(file_name) {
        Ok((data, mime_type)) => json!({
            "content": [
                { "type": "text", "text": format!("图片：{file_name}") },
                { "type": "image", "mimeType": mime_type, "data": data }
            ]
        }),
        Err(err) => json!({
            "content": [{ "type": "text", "text": format!("图片读取失败：{file_name}（{err}）") }],
            "isError": true
        }),
    }
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

    let Some(task_index) = target.tasks.iter().position(|t| t.id == task_id) else {
        return json!({
            "content": [{ "type": "text", "text": format!("项目「{target_name}」中未找到任务 ID「{task_id}」。") }],
            "isError": true
        });
    };

    let now = iso_now();
    let task_title = target.tasks[task_index].title.clone();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    {
        let task = &mut target.tasks[task_index];
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
            task.tags = tags.clone();
        }
    }

    let task_snapshot = target.tasks[task_index].clone();
    let catalog_changed = ensure_tag_catalog_for_tags(&mut target.tag_catalog, &task_snapshot.tags);
    let catalog_snapshot = if catalog_changed {
        Some(target.tag_catalog.clone())
    } else {
        None
    };

    write_state(&projects);
    let _ = state.app_handle.emit(
        "maple://task-updated",
        TaskUpdatedEvent {
            project_name: target_name.clone(),
            task: task_snapshot,
        },
    );
    if let Some(tag_catalog) = catalog_snapshot {
        let _ = state.app_handle.emit(
            "maple://tag-catalog-updated",
            TagCatalogUpdatedEvent {
                project_name: target_name.clone(),
                tag_catalog,
            },
        );
    }

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
            "请先对每条任务调用 submit_task_report，将状态更新为：草稿 / 已完成 / 已阻塞 / 需要更多信息。".into(),
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
                "read_asset_image" => tool_read_asset_image(&arguments),
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
            "name": "read_asset_image",
            "description": "读取任务中的本地图片 asset，并以 MCP image 内容块返回（避免 maple://）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_name": { "type": "string", "description": "asset 文件名（hash.ext），也支持 asset://... / maple://... 形式。" }
                },
                "required": ["file_name"]
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
            "description": "通知 Maple 当前 Worker 已执行完毕。调用前必须确保项目内无待办/待返工/队列中/进行中任务。",
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
