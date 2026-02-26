#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_http;
mod maple_fs;
mod installer;
mod maple_protocol;
mod tray_status;

use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri::State;

#[derive(Serialize)]
struct WorkerCommandResult {
  success: bool,
  code: Option<i32>,
  stdout: String,
  stderr: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkerLogEvent {
  worker_id: String,
  task_title: String,
  stream: String,
  line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkerDoneEvent {
  worker_id: String,
  success: bool,
  code: Option<i32>,
}

#[derive(Serialize)]
struct McpServerStatus {
  running: bool,
  pid: Option<u32>,
  command: String,
}

struct ManagedMcpServer {
  child: Child,
  command: String,
}

struct ManagedWorkerSession {
  stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct AppState {
  mcp_server: Mutex<Option<ManagedMcpServer>>,
  worker_sessions: Mutex<HashMap<String, ManagedWorkerSession>>,
}

#[tauri::command]
async fn probe_worker(
  executable: String,
  args: Vec<String>,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  tauri::async_runtime::spawn_blocking(move || run_command(executable, args, cwd))
    .await
    .map_err(|_| "Worker 探测线程异常退出".to_string())?
}

#[tauri::command]
async fn probe_install_targets() -> Result<Vec<installer::InstallTargetProbe>, String> {
  tauri::async_runtime::spawn_blocking(installer::probe_install_targets)
    .await
    .map_err(|_| "环境检测线程异常退出".to_string())?
}

#[tauri::command]
fn get_install_meta() -> installer::InstallMeta {
  installer::read_install_meta()
}

#[tauri::command]
async fn install_mcp_skills(
  window: tauri::Window,
  options: Option<installer::InstallMcpSkillsOptions>,
) -> Result<installer::InstallMcpSkillsReport, String> {
  let input = options.unwrap_or_default();
  let install_window = window.clone();
  let emitter = std::sync::Arc::new(move |event: installer::InstallTaskEvent| {
    let _ = install_window.emit("maple://install-task-event", event);
  });
  tauri::async_runtime::spawn_blocking(move || installer::install_mcp_and_skills_with_events(input, Some(emitter)))
    .await
    .map_err(|_| "安装线程异常退出".to_string())?
}

#[tauri::command]
async fn run_worker(
  window: tauri::Window,
  worker_id: String,
  task_title: String,
  executable: String,
  args: Vec<String>,
  prompt: String,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    run_command_stream(
      window,
      worker_id,
      task_title,
      executable,
      args,
      Some(prompt),
      cwd,
    )
  })
  .await
  .map_err(|_| "Worker 执行线程异常退出".to_string())?
}

#[tauri::command]
fn start_mcp_server(
  executable: String,
  args: Vec<String>,
  cwd: Option<String>,
  state: State<'_, AppState>,
) -> Result<McpServerStatus, String> {
  let trimmed = executable.trim();
  if trimmed.is_empty() {
    return Err("MCP Server executable 不能为空".to_string());
  }

  let mut guard = state
    .mcp_server
    .lock()
    .map_err(|_| "MCP Server 状态锁不可用".to_string())?;

  if let Some(server) = guard.as_mut() {
    match server.child.try_wait() {
      Ok(None) => {
        return Ok(McpServerStatus {
          running: true,
          pid: Some(server.child.id()),
          command: server.command.clone(),
        });
      }
      Ok(Some(_)) => {
        *guard = None;
      }
      Err(error) => {
        return Err(format!("读取 MCP Server 状态失败: {error}"));
      }
    }
  }

  let mut command = Command::new(trimmed);
  command.args(&args);

  if let Some(dir) = normalize_cwd(cwd) {
    command.current_dir(dir);
  }

  let command_string = command_string(trimmed, &args);
  let child = command
    .spawn()
    .map_err(|error| format!("启动 MCP Server 失败: {error}"))?;

  let pid = child.id();
  *guard = Some(ManagedMcpServer {
    child,
    command: command_string.clone(),
  });

  Ok(McpServerStatus {
    running: true,
    pid: Some(pid),
    command: command_string,
  })
}

#[tauri::command]
fn stop_mcp_server(state: State<'_, AppState>) -> Result<McpServerStatus, String> {
  let mut guard = state
    .mcp_server
    .lock()
    .map_err(|_| "MCP Server 状态锁不可用".to_string())?;

  if let Some(mut server) = guard.take() {
    let _ = server.child.kill();
    let _ = server.child.wait();

    return Ok(McpServerStatus {
      running: false,
      pid: None,
      command: server.command,
    });
  }

  Ok(McpServerStatus {
    running: false,
    pid: None,
    command: String::new(),
  })
}

#[tauri::command]
fn mcp_server_status(state: State<'_, AppState>) -> Result<McpServerStatus, String> {
  let mut guard = state
    .mcp_server
    .lock()
    .map_err(|_| "MCP Server 状态锁不可用".to_string())?;

  if let Some(server) = guard.as_mut() {
    match server.child.try_wait() {
      Ok(None) => {
        return Ok(McpServerStatus {
          running: true,
          pid: Some(server.child.id()),
          command: server.command.clone(),
        });
      }
      Ok(Some(_)) => {
        *guard = None;
      }
      Err(error) => {
        return Err(format!("读取 MCP Server 状态失败: {error}"));
      }
    }
  }

  Ok(McpServerStatus {
    running: false,
    pid: None,
    command: String::new(),
  })
}

#[tauri::command]
async fn start_interactive_worker(
  app_handle: AppHandle,
  worker_id: String,
  task_title: String,
  executable: String,
  args: Vec<String>,
  prompt: Option<String>,
  cwd: Option<String>,
) -> Result<bool, String> {
  let executable_trimmed = executable.trim().to_string();
  if executable_trimmed.is_empty() {
    return Err("worker executable 不能为空".to_string());
  }

  let wid = worker_id.clone();
  let ttitle = task_title.clone();

  tauri::async_runtime::spawn_blocking(move || {
    let mut pty_command = Command::new("script");
    pty_command
      .arg("-q")
      .arg("/dev/null")
      .arg(&executable_trimmed)
      .args(&args)
      .env("TERM", "xterm-256color")
      .env("COLORTERM", "truecolor")
      .env("FORCE_COLOR", "1")
      .env("CLICOLOR_FORCE", "1")
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    if let Some(dir) = normalize_cwd(cwd.clone()) {
      pty_command.current_dir(dir);
    }

    let mut child = match pty_command.spawn() {
      Ok(child) => child,
      Err(pty_error) => {
        let mut fallback = build_cli_command(&executable_trimmed, &args);
        fallback
          .env("TERM", "xterm-256color")
          .env("COLORTERM", "truecolor")
          .env("FORCE_COLOR", "1")
          .env("CLICOLOR_FORCE", "1")
          .stdin(Stdio::piped())
          .stdout(Stdio::piped())
          .stderr(Stdio::piped());

        if let Some(dir) = normalize_cwd(cwd) {
          fallback.current_dir(dir);
        }

        fallback
          .spawn()
          .map_err(|fallback_error| format!("启动 Worker 失败（PTY+回退均失败）: PTY={pty_error}; fallback={fallback_error}"))?
      }
    };

    if let Some(mut stdin_handle) = child.stdin.take() {
      if let Some(value) = prompt.as_ref() {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
          let _ = stdin_handle.write_all(trimmed.as_bytes());
          let _ = stdin_handle.write_all(b"\n");
          let _ = stdin_handle.flush();
        }
      }
      child.stdin = Some(stdin_handle);
    }

    let stdin_handle = child.stdin.take();
    let stdout = child.stdout.take().ok_or_else(|| "无法捕获 stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "无法捕获 stderr".to_string())?;

    {
      let state = app_handle.state::<AppState>();
      let mut sessions = state.worker_sessions.lock().map_err(|_| "会话锁不可用".to_string())?;
      sessions.insert(wid.clone(), ManagedWorkerSession { stdin: stdin_handle });
    }

    let stdout_app = app_handle.clone();
    let stdout_wid = wid.clone();
    let stdout_ttitle = ttitle.clone();
    let stdout_handle = std::thread::spawn(move || {
      stream_chunks_app(stdout_app, stdout_wid, stdout_ttitle, "stdout", stdout)
    });

    let stderr_app = app_handle.clone();
    let stderr_wid = wid.clone();
    let stderr_ttitle = ttitle.clone();
    let stderr_handle = std::thread::spawn(move || {
      stream_chunks_app(stderr_app, stderr_wid, stderr_ttitle, "stderr", stderr)
    });

    let status = child.wait().map_err(|error| format!("等待 Worker 退出失败: {error}"))?;

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    {
      let state = app_handle.state::<AppState>();
      let mut sessions = state.worker_sessions.lock().unwrap_or_else(|e| e.into_inner());
      sessions.remove(&wid);
    }

    let _ = app_handle.emit(
      "maple://worker-done",
      WorkerDoneEvent {
        worker_id: wid,
        success: status.success(),
        code: status.code(),
      },
    );

    Ok(true)
  })
  .await
  .map_err(|_| "Worker 执行线程异常退出".to_string())?
}

#[tauri::command]
fn send_worker_input(
  worker_id: String,
  input: String,
  append_newline: Option<bool>,
  state: State<'_, AppState>,
) -> Result<bool, String> {
  let mut sessions = state
    .worker_sessions
    .lock()
    .map_err(|_| "会话锁不可用".to_string())?;

  let session = sessions
    .get_mut(&worker_id)
    .ok_or_else(|| format!("Worker 会话不存在: {worker_id}"))?;

  let stdin = session
    .stdin
    .as_mut()
    .ok_or_else(|| "Worker stdin 不可用".to_string())?;

  stdin
    .write_all(input.as_bytes())
    .map_err(|error| format!("写入 stdin 失败: {error}"))?;
  if append_newline.unwrap_or(true) {
    stdin
      .write_all(b"\n")
      .map_err(|error| format!("写入换行失败: {error}"))?;
  }
  stdin
    .flush()
    .map_err(|error| format!("flush stdin 失败: {error}"))?;

  Ok(true)
}

#[tauri::command]
fn stop_worker_session(
  worker_id: String,
  state: State<'_, AppState>,
) -> Result<bool, String> {
  let mut sessions = state
    .worker_sessions
    .lock()
    .map_err(|_| "会话锁不可用".to_string())?;

  if sessions.remove(&worker_id).is_some() {
    Ok(true)
  } else {
    Ok(false)
  }
}

#[tauri::command]
fn open_path(path: String) -> Result<bool, String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("path 不能为空".to_string());
  }

  let target = PathBuf::from(trimmed);
  if !target.exists() {
    return Err(format!("路径不存在: {trimmed}"));
  }

  #[cfg(target_os = "macos")]
  let mut command = {
    let mut cmd = Command::new("open");
    cmd.arg(&target);
    cmd
  };

  #[cfg(target_os = "windows")]
  let mut command = {
    let mut cmd = Command::new("explorer");
    cmd.arg(&target);
    cmd
  };

  #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
  let mut command = {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(&target);
    cmd
  };

  command
    .spawn()
    .map_err(|error| format!("打开路径失败: {error}"))?;

  Ok(true)
}

#[tauri::command]
fn open_in_editor(path: String, app: Option<String>) -> Result<bool, String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("path 不能为空".to_string());
  }

  let target = PathBuf::from(trimmed);
  if !target.exists() {
    return Err(format!("路径不存在: {trimmed}"));
  }

  let app_key = app.unwrap_or_default().trim().to_lowercase();

  #[cfg(target_os = "macos")]
  let mut command = {
    let mut cmd = Command::new("open");
    let app_name = match app_key.as_str() {
      "vscode" => Some("Visual Studio Code"),
      "github_desktop" => Some("GitHub Desktop"),
      "cursor" => Some("Cursor"),
      "windsurf" => Some("Windsurf"),
      "visual_studio" => Some("Visual Studio"),
      _ => None,
    };
    if let Some(name) = app_name {
      cmd.arg("-a").arg(name);
    }
    cmd.arg(&target);
    cmd
  };

  #[cfg(target_os = "windows")]
  let mut command = {
    let mut cmd = match app_key.as_str() {
      "vscode" => Command::new("code"),
      "cursor" => Command::new("cursor"),
      "windsurf" => Command::new("windsurf"),
      "visual_studio" => Command::new("devenv"),
      _ => Command::new("explorer"),
    };
    cmd.arg(&target);
    cmd
  };

  #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
  let mut command = {
    let mut cmd = match app_key.as_str() {
      "vscode" => Command::new("code"),
      "cursor" => Command::new("cursor"),
      "windsurf" => Command::new("windsurf"),
      _ => Command::new("xdg-open"),
    };
    cmd.arg(&target);
    cmd
  };

  command
    .spawn()
    .map_err(|error| format!("打开编辑器失败: {error}"))?;

  Ok(true)
}

fn build_cli_command(executable: &str, args: &[String]) -> Command {
  #[cfg(target_os = "windows")]
  {
    let trimmed = executable.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower == "wsl" || lower.ends_with("\\wsl.exe") || lower.ends_with("/wsl.exe") {
      let mut command = Command::new(trimmed);
      command.args(args);
      return command;
    }

    let mut command = Command::new("cmd");
    command.arg("/D").arg("/C").arg(executable);
    command.args(args);
    command
  }

  #[cfg(not(target_os = "windows"))]
  {
    let mut command = Command::new(executable);
    command.args(args);
    command
  }
}

fn run_command(
  executable: String,
  args: Vec<String>,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  let executable = executable.trim();
  if executable.is_empty() {
    return Err("worker executable 不能为空".to_string());
  }

  let mut command = build_cli_command(executable, &args);

  if let Some(dir) = normalize_cwd(cwd) {
    command.current_dir(dir);
  }

  let output = command
    .output()
    .map_err(|error| format!("执行命令失败: {error}"))?;

  Ok(WorkerCommandResult {
    success: output.status.success(),
    code: output.status.code(),
    stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
  })
}

fn run_command_stream(
  window: tauri::Window,
  worker_id: String,
  task_title: String,
  executable: String,
  args: Vec<String>,
  prompt: Option<String>,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  let executable = executable.trim().to_string();
  if executable.is_empty() {
    return Err("worker executable 不能为空".to_string());
  }

  let mut pty_command = Command::new("script");
  pty_command
    .arg("-q")
    .arg("/dev/null")
    .arg(&executable)
    .args(&args)
    .env("TERM", "xterm-256color")
    .env("COLORTERM", "truecolor")
    .env("FORCE_COLOR", "1")
    .env("CLICOLOR_FORCE", "1")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  if let Some(dir) = normalize_cwd(cwd.clone()) {
    pty_command.current_dir(dir);
  }

  let mut child = match pty_command.spawn() {
    Ok(child) => child,
    Err(pty_error) => {
      let mut fallback = build_cli_command(&executable, &args);
      fallback
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("FORCE_COLOR", "1")
        .env("CLICOLOR_FORCE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

      if let Some(dir) = normalize_cwd(cwd) {
        fallback.current_dir(dir);
      }

      fallback.spawn().map_err(|fallback_error| {
        format!("执行命令失败（PTY+回退均失败）: PTY={pty_error}; fallback={fallback_error}")
      })?
    }
  };

  if let Some(mut stdin_handle) = child.stdin.take() {
    if let Some(value) = prompt.as_ref() {
      if !value.trim().is_empty() {
        let _ = stdin_handle.write_all(value.as_bytes());
        let _ = stdin_handle.write_all(b"\n");
        let _ = stdin_handle.flush();
      }
    }
  }

  let stdout = child.stdout.take().ok_or_else(|| "无法捕获 stdout".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "无法捕获 stderr".to_string())?;

  let stdout_window = window.clone();
  let stdout_worker_id = worker_id.clone();
  let stdout_task_title = task_title.clone();
  let stdout_handle = std::thread::spawn(move || {
    stream_chunks(stdout_window, stdout_worker_id, stdout_task_title, "stdout", stdout)
  });

  let stderr_window = window.clone();
  let stderr_worker_id = worker_id.clone();
  let stderr_task_title = task_title.clone();
  let stderr_handle = std::thread::spawn(move || {
    stream_chunks(stderr_window, stderr_worker_id, stderr_task_title, "stderr", stderr)
  });

  let status = child
    .wait()
    .map_err(|error| format!("等待 Worker 退出失败: {error}"))?;

  let stdout_text = stdout_handle.join().unwrap_or_default();
  let stderr_text = stderr_handle.join().unwrap_or_default();

  Ok(WorkerCommandResult {
    success: status.success(),
    code: status.code(),
    stdout: stdout_text.trim().to_string(),
    stderr: stderr_text.trim().to_string(),
  })
}

fn stream_chunks<R: Read>(
  window: tauri::Window,
  worker_id: String,
  task_title: String,
  stream: &str,
  mut reader: R,
) -> String {
  let mut out = String::new();
  let mut buffer = [0u8; 4096];

  loop {
    match reader.read(&mut buffer) {
      Ok(0) => break,
      Ok(size) => {
        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
        out.push_str(&chunk);
        let _ = window.emit(
          "maple://worker-log",
          WorkerLogEvent {
            worker_id: worker_id.clone(),
            task_title: task_title.clone(),
            stream: stream.to_string(),
            line: chunk,
          },
        );
      }
      Err(_) => break,
    }
  }

  out
}

fn stream_chunks_app<R: Read>(
  app_handle: AppHandle,
  worker_id: String,
  task_title: String,
  stream: &str,
  mut reader: R,
) -> String {
  let mut out = String::new();
  let mut buffer = [0u8; 4096];

  loop {
    match reader.read(&mut buffer) {
      Ok(0) => break,
      Ok(size) => {
        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
        out.push_str(&chunk);
        let _ = app_handle.emit(
          "maple://worker-log",
          WorkerLogEvent {
            worker_id: worker_id.clone(),
            task_title: task_title.clone(),
            stream: stream.to_string(),
            line: chunk,
          },
        );
      }
      Err(_) => break,
    }
  }

  out
}

fn normalize_cwd(cwd: Option<String>) -> Option<PathBuf> {
  let dir = cwd?;
  let trimmed = dir.trim();
  if trimmed.is_empty() {
    return None;
  }
  Some(PathBuf::from(trimmed))
}

fn command_string(executable: &str, args: &[String]) -> String {
  if args.is_empty() {
    executable.to_string()
  } else {
    format!("{} {}", executable, args.join(" "))
  }
}

fn maple_home_dir() -> Result<PathBuf, String> {
  maple_fs::maple_home_dir()
}

fn asset_dir() -> Result<PathBuf, String> {
  maple_fs::asset_dir()
}

fn is_valid_asset_file_name(value: &str) -> bool {
  maple_fs::is_valid_asset_file_name(value)
}

#[tauri::command]
fn write_state_file(json: String) -> Result<(), String> {
  let dir = maple_home_dir()?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建 .maple 目录失败: {e}"))?;
  let path = dir.join("state.json");
  std::fs::write(&path, json.as_bytes()).map_err(|e| format!("写入状态文件失败: {e}"))?;
  Ok(())
}

#[tauri::command]
fn read_state_file() -> Result<String, String> {
  let path = maple_home_dir()?.join("state.json");
  if !path.exists() {
    return Ok("[]".to_string());
  }
  std::fs::read_to_string(&path).map_err(|e| format!("读取状态文件失败: {e}"))
}

#[tauri::command]
fn save_asset_file(file_name: String, bytes_base64: String) -> Result<bool, String> {
  let trimmed_name = file_name.trim();
  if !is_valid_asset_file_name(trimmed_name) {
    return Err("无效的 asset 文件名（必须为 64 位小写 hex + 扩展名）。".to_string());
  }

  let bytes = base64::engine::general_purpose::STANDARD
    .decode(bytes_base64.trim().as_bytes())
    .map_err(|e| format!("解码图片数据失败: {e}"))?;

  let dir = asset_dir()?;
  let path = dir.join(trimmed_name);
  if path.exists() {
    return Ok(true);
  }

  std::fs::write(&path, &bytes).map_err(|e| format!("写入图片文件失败: {e}"))?;
  Ok(true)
}

#[tauri::command]
fn get_asset_file_path(file_name: String) -> Result<String, String> {
  let trimmed_name = file_name.trim();
  if !is_valid_asset_file_name(trimmed_name) {
    return Err("无效的 asset 文件名（必须为 64 位小写 hex + 扩展名）。".to_string());
  }
  let dir = asset_dir()?;
  let path = dir.join(trimmed_name);
  if !path.exists() {
    return Err("asset 文件不存在。".to_string());
  }
  Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_asset_file_base64(file_name: String) -> Result<String, String> {
  let trimmed_name = file_name.trim();
  if !is_valid_asset_file_name(trimmed_name) {
    return Err("无效的 asset 文件名（必须为 64 位小写 hex + 扩展名）。".to_string());
  }
  let dir = asset_dir()?;
  let path = dir.join(trimmed_name);
  if !path.exists() {
    return Err("asset 文件不存在。".to_string());
  }

  let bytes = std::fs::read(&path).map_err(|e| format!("读取图片文件失败: {e}"))?;
  Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn sync_tray_task_badge(
  snapshot: tray_status::TrayTaskSnapshot,
  app_handle: AppHandle,
) -> Result<(), String> {
  tray_status::sync(&app_handle, &snapshot).map_err(|error| format!("同步托盘状态失败: {error}"))
}

fn main() {
  tauri::Builder::default()
    .register_uri_scheme_protocol("maple", maple_protocol::handle)
    .manage(AppState::default())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      mcp_http::start(app.handle().clone());
      if let Err(error) = tray_status::init(app.handle()) {
        eprintln!("failed to initialize tray status: {error}");
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      probe_worker,
      probe_install_targets,
      get_install_meta,
      install_mcp_skills,
      run_worker,
      start_interactive_worker,
      send_worker_input,
      stop_worker_session,
      open_path,
      open_in_editor,
      start_mcp_server,
      stop_mcp_server,
      mcp_server_status,
      write_state_file,
      read_state_file,
      save_asset_file,
      get_asset_file_path,
      read_asset_file_base64,
      sync_tray_task_badge
    ])
    .run(tauri::generate_context!())
    .expect("error while running maple desktop");
}
