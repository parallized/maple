#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

#[derive(Serialize)]
struct WorkerCommandResult {
  success: bool,
  code: Option<i32>,
  stdout: String,
  stderr: String,
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

#[derive(Default)]
struct AppState {
  mcp_server: Mutex<Option<ManagedMcpServer>>,
}

#[tauri::command]
fn probe_worker(
  executable: String,
  args: Vec<String>,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  run_command(executable, args, cwd)
}

#[tauri::command]
fn run_worker(
  executable: String,
  args: Vec<String>,
  prompt: String,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  let mut final_args = args;
  final_args.push(prompt);
  run_command(executable, final_args, cwd)
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

fn run_command(
  executable: String,
  args: Vec<String>,
  cwd: Option<String>,
) -> Result<WorkerCommandResult, String> {
  let executable = executable.trim();
  if executable.is_empty() {
    return Err("worker executable 不能为空".to_string());
  }

  let mut command = Command::new(executable);
  command.args(&args);

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

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      probe_worker,
      run_worker,
      start_mcp_server,
      stop_mcp_server,
      mcp_server_status
    ])
    .run(tauri::generate_context!())
    .expect("error while running maple desktop");
}
