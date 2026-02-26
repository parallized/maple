use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path};
use std::process::Command;
use std::sync::Arc;

use crate::maple_fs;

const MAPLE_MCP_URL: &str = "http://localhost:45819/mcp";

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallMcpSkillsOptions {
  pub codex: bool,
  pub claude: bool,
  pub iflow: bool,
  pub wsl_codex: bool,
  pub wsl_claude: bool,
  pub wsl_iflow: bool,
  pub windsurf: bool,
  pub install_id: Option<String>,
}

impl Default for InstallMcpSkillsOptions {
  fn default() -> Self {
    Self {
      codex: true,
      claude: true,
      iflow: true,
      wsl_codex: false,
      wsl_claude: false,
      wsl_iflow: false,
      windsurf: true,
      install_id: None,
    }
  }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallTaskEvent {
  pub kind: String,
  pub install_id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub target_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub stream: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub line: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub state: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub target: Option<InstallTargetResult>,
}

impl InstallTaskEvent {
  fn log(install_id: &str, target_id: Option<&str>, stream: &str, line: String) -> Self {
    Self {
      kind: "log".to_string(),
      install_id: install_id.to_string(),
      target_id: target_id.map(|value| value.to_string()),
      stream: Some(stream.to_string()),
      line: Some(line),
      state: None,
      target: None,
    }
  }

  fn target_state(install_id: &str, target_id: &str, state: &str) -> Self {
    Self {
      kind: "target_state".to_string(),
      install_id: install_id.to_string(),
      target_id: Some(target_id.to_string()),
      stream: None,
      line: None,
      state: Some(state.to_string()),
      target: None,
    }
  }

  fn target_result(install_id: &str, target: InstallTargetResult) -> Self {
    Self {
      kind: "target_result".to_string(),
      install_id: install_id.to_string(),
      target_id: Some(target.id.clone()),
      stream: None,
      line: None,
      state: None,
      target: Some(target),
    }
  }
}

#[derive(Clone)]
struct InstallEventEmitter {
  install_id: String,
  emit: Option<Arc<dyn Fn(InstallTaskEvent) + Send + Sync>>,
}

impl InstallEventEmitter {
  fn emit(&self, event: InstallTaskEvent) {
    let Some(cb) = &self.emit else { return };
    cb(event);
  }

  fn log(&self, target_id: Option<&str>, stream: &str, line: impl Into<String>) {
    let text = line.into();
    if text.trim().is_empty() {
      return;
    }
    self.emit(InstallTaskEvent::log(&self.install_id, target_id, stream, text));
  }

  fn log_command(&self, target_id: &str, executable: &str, args: &[String]) {
    let mut cmd = executable.to_string();
    if !args.is_empty() {
      cmd.push(' ');
      cmd.push_str(&args.join(" "));
    }
    self.log(Some(target_id), "info", format!("$ {cmd}\n"));
  }

  fn target_state(&self, target_id: &str, state: &str) {
    self.emit(InstallTaskEvent::target_state(&self.install_id, target_id, state));
  }

  fn target_result(&self, target: InstallTargetResult) {
    self.emit(InstallTaskEvent::target_result(&self.install_id, target));
  }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallTargetResult {
  pub id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub runtime: Option<String>,
  pub success: bool,
  pub skipped: bool,
  pub cli_found: Option<bool>,
  pub written_files: Vec<String>,
  pub stdout: String,
  pub stderr: String,
  pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallMcpSkillsReport {
  pub mcp_url: String,
  pub targets: Vec<InstallTargetResult>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallTargetProbe {
  pub id: String,
  pub runtime: String,
  pub cli_found: bool,
  pub installed: bool,
  pub npm_found: bool,
}

#[derive(Debug, Clone)]
struct CliOutput {
  success: bool,
  code: Option<i32>,
  stdout: String,
  stderr: String,
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

fn run_cli(executable: &str, args: &[String], cwd: Option<&Path>) -> Result<CliOutput, String> {
  let mut command = build_cli_command(executable, args);
  if let Some(dir) = cwd {
    command.current_dir(dir);
  }
  let output = command
    .output()
    .map_err(|error| format!("执行命令失败: {error}"))?;
  Ok(CliOutput {
    success: output.status.success(),
    code: output.status.code(),
    stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
  })
}

fn is_windows_cli_not_found(output: &CliOutput) -> bool {
  #[cfg(target_os = "windows")]
  {
    output.code == Some(9009)
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = output;
    false
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallRuntime {
  Native,
  Wsl,
}

impl InstallRuntime {
  fn as_str(self) -> &'static str {
    match self {
      InstallRuntime::Native => "native",
      InstallRuntime::Wsl => "wsl",
    }
  }
}

fn sh_quote(value: &str) -> String {
  if value.is_empty() {
    return "''".to_string();
  }
  format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn detect_cli_native(executable: &str) -> bool {
  let trimmed = executable.trim();
  if trimmed.is_empty() {
    return false;
  }

  #[cfg(target_os = "windows")]
  {
    if trimmed.contains('\\') || trimmed.contains('/') {
      if Path::new(trimmed).exists() {
        return true;
      }
    }
    let args = vec![trimmed.to_string()];
    return run_cli("where", &args, None).map(|out| out.success).unwrap_or(false);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let script = format!("command -v {} >/dev/null 2>&1", sh_quote(trimmed));
    let args = vec!["-lc".to_string(), script];
    return run_cli("sh", &args, None).map(|out| out.success).unwrap_or(false);
  }
}

fn detect_cli_wsl(executable: &str) -> bool {
  #[cfg(target_os = "windows")]
  {
    let trimmed = executable.trim();
    if trimmed.is_empty() {
      return false;
    }
    // Use "command -v" and verify the result isn't a Windows binary accessible via /mnt/ or .exe
    // WSL by default shares Windows PATH, so we must exclude those results.
    // Use "bash -lic" instead of "sh -lc" so that ~/.bashrc is sourced — nvm and
    // other version managers are typically configured there, not in ~/.profile.
    let script = format!(
      "p=$(command -v {} 2>/dev/null) && [ -n \"$p\" ] && case \"$p\" in /mnt/*) false;; *.exe) false;; *) true;; esac",
      sh_quote(trimmed)
    );
    let args = vec!["-e".to_string(), "bash".to_string(), "-lic".to_string(), script];
    return run_cli("wsl", &args, None).map(|out| out.success).unwrap_or(false);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = executable;
    false
  }
}

fn is_codex_installed_native(home: &Path) -> bool {
  home.join(".codex").join("skills").join("maple").join("SKILL.md").exists()
}

fn is_claude_installed_native(home: &Path) -> bool {
  home.join(".claude").join("commands").join("maple.md").exists()
}

fn is_iflow_installed_native(home: &Path) -> bool {
  home.join(".iflow").join("workflows").join("maple.md").exists()
    && home.join(".iflow").join("skills").join("maple").join("SKILL.md").exists()
}

fn is_codex_installed_wsl() -> bool {
  #[cfg(target_os = "windows")]
  {
    wsl_home_file_exists(".codex/skills/maple/SKILL.md").unwrap_or(false)
  }

  #[cfg(not(target_os = "windows"))]
  {
    false
  }
}

fn is_claude_installed_wsl() -> bool {
  #[cfg(target_os = "windows")]
  {
    wsl_home_file_exists(".claude/commands/maple.md").unwrap_or(false)
  }

  #[cfg(not(target_os = "windows"))]
  {
    false
  }
}

fn is_iflow_installed_wsl() -> bool {
  #[cfg(target_os = "windows")]
  {
    wsl_home_file_exists(".iflow/workflows/maple.md").unwrap_or(false)
      && wsl_home_file_exists(".iflow/skills/maple/SKILL.md").unwrap_or(false)
  }

  #[cfg(not(target_os = "windows"))]
  {
    false
  }
}

pub fn probe_install_targets() -> Result<Vec<InstallTargetProbe>, String> {
  let home = maple_fs::user_home_dir()?;

  let codex_native_cli = detect_cli_native("codex");
  let claude_native_cli = detect_cli_native("claude");
  let iflow_native_cli = detect_cli_native("iflow");

  let codex_wsl_cli = detect_cli_wsl("codex");
  let claude_wsl_cli = detect_cli_wsl("claude");
  let iflow_wsl_cli = detect_cli_wsl("iflow");

  let npm_native = detect_cli_native("npm");
  let npm_wsl = detect_cli_wsl("npm");

  Ok(vec![
    InstallTargetProbe {
      id: "codex".to_string(),
      runtime: "native".to_string(),
      cli_found: codex_native_cli,
      installed: is_codex_installed_native(&home),
      npm_found: npm_native,
    },
    InstallTargetProbe {
      id: "claude".to_string(),
      runtime: "native".to_string(),
      cli_found: claude_native_cli,
      installed: is_claude_installed_native(&home),
      npm_found: npm_native,
    },
    InstallTargetProbe {
      id: "iflow".to_string(),
      runtime: "native".to_string(),
      cli_found: iflow_native_cli,
      installed: is_iflow_installed_native(&home),
      npm_found: npm_native,
    },
    InstallTargetProbe {
      id: "wsl:codex".to_string(),
      runtime: "wsl".to_string(),
      cli_found: codex_wsl_cli,
      installed: is_codex_installed_wsl(),
      npm_found: npm_wsl,
    },
    InstallTargetProbe {
      id: "wsl:claude".to_string(),
      runtime: "wsl".to_string(),
      cli_found: claude_wsl_cli,
      installed: is_claude_installed_wsl(),
      npm_found: npm_wsl,
    },
    InstallTargetProbe {
      id: "wsl:iflow".to_string(),
      runtime: "wsl".to_string(),
      cli_found: iflow_wsl_cli,
      installed: is_iflow_installed_wsl(),
      npm_found: npm_wsl,
    },
  ])
}

fn normalize_home_relative_path(path: &str) -> Result<String, String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("无效路径（为空）".to_string());
  }
  Ok(trimmed
    .trim_start_matches("~/")
    .trim_start_matches('/')
    .to_string())
}

fn wsl_write_home_file(
  emitter: &InstallEventEmitter,
  target_id: &str,
  path: &str,
  content: &str,
) -> Result<String, String> {
  let rel = normalize_home_relative_path(path)?;
  let parent = rel
    .rsplit_once('/')
    .map(|(dir, _)| dir)
    .unwrap_or("");

  let encoded = general_purpose::STANDARD.encode(content.as_bytes());
  let script = if parent.is_empty() {
    format!(
      "set -e; printf '%s' '{}' | base64 -d > \"$HOME/{}\"",
      encoded, rel
    )
  } else {
    format!(
      "set -e; mkdir -p \"$HOME/{}\"; printf '%s' '{}' | base64 -d > \"$HOME/{}\"",
      parent, encoded, rel
    )
  };

  let args = vec![
    "-e".to_string(),
    "sh".to_string(),
    "-lc".to_string(),
    script,
  ];

  let pretty = format!("wsl:~/{rel}");
  emitter.log(Some(target_id), "info", format!("写入 {pretty}\n"));
  match run_cli("wsl", &args, None) {
    Ok(out) => {
      if out.success {
        Ok(pretty)
      } else {
        Err(format!(
          "WSL 写入失败（exit: {}）\n{}\n{}",
          out.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()),
          out.stdout,
          out.stderr
        ))
      }
    }
    Err(error) => Err(error),
  }
}

fn wsl_home_file_exists(path: &str) -> Result<bool, String> {
  let rel = normalize_home_relative_path(path)?;
  let script = format!("test -f \"$HOME/{rel}\"");
  let args = vec!["-e".to_string(), "sh".to_string(), "-lc".to_string(), script];
  Ok(run_cli("wsl", &args, None).map(|out| out.success).unwrap_or(false))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
  let parent = path.parent().ok_or_else(|| "无效路径（缺少父目录）".to_string())?;
  fs::create_dir_all(parent).map_err(|error| format!("创建目录失败: {error}"))?;
  Ok(())
}

fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
  ensure_parent_dir(path)?;
  fs::write(path, content.as_bytes()).map_err(|error| format!("写入文件失败: {error}"))?;
  Ok(())
}

fn pretty_path(path: &Path) -> String {
  path.to_string_lossy().to_string()
}

fn codex_skill_md() -> &'static str {
  r#"---
name: maple
description: "Run /maple workflow for Maple development tasks."
---

# maple

When user asks `/maple`:
1. Work in the current working directory (do NOT cd elsewhere).
2. Use Maple MCP tools (query_project_todos, query_recent_context) to gather tasks/context.
3. Always run typecheck/build verification before marking done.
4. For each task, call `submit_task_report` to set `进行中` when execution starts, then set `已完成` / `已阻塞` / `需要更多信息` when execution ends.
5. Before ending, call `query_project_todos` and ensure no `待办` / `队列中` / `进行中` task remains.
6. Call `finish_worker` as the final MCP call.
7. Output `mcp_decision` with status, comment, and tags.
"#
}

fn claude_command_md() -> &'static str {
  r#"Run Maple workflow in the current working directory:

1. Use Maple MCP tools (query_project_todos, query_recent_context) to get tasks
2. Implement the requested changes in the current project
3. Run typecheck/build before finishing
4. For each task call submit_task_report: set status to 进行中 at start, then set to 已完成 / 已阻塞 / 需要更多信息 at finish
5. Before ending, call query_project_todos and ensure no 待办 / 队列中 / 进行中 task remains
6. Call finish_worker as the final MCP call
7. Output mcp_decision with status, comment, and tags
"#
}

fn iflow_workflow_md() -> &'static str {
  r#"/maple

Work in the current working directory (do NOT cd elsewhere).
Use Maple MCP tools to query tasks and submit results.
Run typecheck/build before finishing.
For each task call submit_task_report: set status to 进行中 at start, then set to 已完成 / 已阻塞 / 需要更多信息 at finish.
Before ending, call query_project_todos and ensure no 待办 / 队列中 / 进行中 task remains.
Call finish_worker as the final MCP call.
Output mcp_decision with status, comment, and tags.
"#
}

fn iflow_skill_md() -> &'static str {
  r#"---
name: maple
description: "Run maple workflow in this repository."
---

# maple

Maple execution skill:
- execute tasks end-to-end
- use Maple MCP + local skills first
- run typecheck/build before completion
- use submit_task_report to mark each task as 进行中 at start, then settle to 已完成 / 已阻塞 / 需要更多信息
- call query_project_todos before ending, and keep no 待办 / 队列中 / 进行中 tasks
- call finish_worker as the final MCP call
- keep Maple on the standalone execution path
"#
}

fn run_registration_commands(
  emitter: &InstallEventEmitter,
  target_id: &str,
  executable: &str,
  remove_args: Vec<String>,
  add_args: Vec<String>,
) -> (Option<bool>, bool, String, String, Option<String>) {
  let mut stdout = String::new();
  let mut stderr = String::new();

  emitter.log_command(target_id, executable, &remove_args);
  let remove_out = run_cli(executable, &remove_args, None);
  match remove_out {
    Ok(out) => {
      if is_windows_cli_not_found(&out) {
        emitter.log(Some(target_id), "stderr", format!("未检测到 CLI：{executable}\n"));
        return (Some(false), false, out.stdout, out.stderr, None);
      }
      if !out.stdout.is_empty() {
        emitter.log(Some(target_id), "stdout", format!("{}\n", out.stdout.trim_end()));
        stdout.push_str(&out.stdout);
        stdout.push('\n');
      }
      if !out.stderr.is_empty() {
        emitter.log(Some(target_id), "stderr", format!("{}\n", out.stderr.trim_end()));
        stderr.push_str(&out.stderr);
        stderr.push('\n');
      }
    }
    Err(error) => {
      // On non-Windows, command not found may surface as spawn error.
      let lower = error.to_lowercase();
      if lower.contains("not found")
        || lower.contains("no such file")
        || lower.contains("os error 2")
        || error.contains("系统找不到")
      {
        emitter.log(Some(target_id), "stderr", format!("{error}\n"));
        return (Some(false), false, "".to_string(), error, None);
      }
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return (Some(true), false, stdout, stderr, Some(error));
    }
  }

  emitter.log_command(target_id, executable, &add_args);
  let add_out = run_cli(executable, &add_args, None);
  match add_out {
    Ok(out) => {
      if is_windows_cli_not_found(&out) {
        emitter.log(Some(target_id), "stderr", format!("未检测到 CLI：{executable}\n"));
        return (Some(false), false, out.stdout, out.stderr, None);
      }
      if !out.stdout.is_empty() {
        emitter.log(Some(target_id), "stdout", format!("{}\n", out.stdout.trim_end()));
        stdout.push_str(&out.stdout);
        stdout.push('\n');
      }
      if !out.stderr.is_empty() {
        emitter.log(Some(target_id), "stderr", format!("{}\n", out.stderr.trim_end()));
        stderr.push_str(&out.stderr);
        stderr.push('\n');
      }
      if out.success {
        emitter.log(Some(target_id), "info", "MCP 注册成功。\n".to_string());
        (Some(true), true, stdout.trim().to_string(), stderr.trim().to_string(), None)
      } else {
        let detail = format!("MCP 注册失败（exit: {}）", out.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()));
        emitter.log(Some(target_id), "stderr", format!("{detail}\n"));
        (Some(true), false, stdout.trim().to_string(), stderr.trim().to_string(), Some(detail))
      }
    }
    Err(error) => {
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      (Some(true), false, stdout.trim().to_string(), stderr.trim().to_string(), Some(error))
    },
  }
}

fn install_codex(home: &Path, emitter: &InstallEventEmitter, runtime: InstallRuntime, target_id: &str) -> InstallTargetResult {
  let mut written_files = Vec::new();
  let mut stdout = String::new();
  let mut stderr = String::new();

  emitter.target_state(target_id, "running");
  let cli_detected = match runtime {
    InstallRuntime::Native => detect_cli_native("codex"),
    InstallRuntime::Wsl => detect_cli_wsl("codex"),
  };
  if !cli_detected {
    let scope = if runtime == InstallRuntime::Native { "本机" } else { "WSL" };
    emitter.log(Some(target_id), "stderr", format!("未检测到 CLI：codex（{scope}），已跳过。\n"));
    emitter.target_state(target_id, "success");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: true,
      skipped: true,
      cli_found: Some(false),
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  if runtime == InstallRuntime::Native {
    let skill_path = home.join(".codex").join("skills").join("maple").join("SKILL.md");
    emitter.log(Some(target_id), "info", format!("写入 {}\n", pretty_path(&skill_path)));
    if let Err(error) = write_text_file(&skill_path, codex_skill_md()) {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
    written_files.push(pretty_path(&skill_path));

    let (cli_found, registered, out, err, reg_error) = run_registration_commands(
      emitter,
      target_id,
      "codex",
      vec!["mcp".into(), "remove".into(), "maple".into()],
      vec![
        "mcp".into(),
        "add".into(),
        "maple".into(),
        "--url".into(),
        MAPLE_MCP_URL.into(),
      ],
    );
    stdout = out;
    stderr = err;

    if cli_found == Some(false) {
      emitter.target_state(target_id, "error");
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found,
        written_files,
        stdout,
        stderr,
        error: Some("未检测到 CLI：codex（本机）".to_string()),
      };
    }

    let result = InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: registered && reg_error.is_none(),
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: reg_error,
    };
    emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
    return result;
  }

  match wsl_write_home_file(emitter, target_id, ".codex/skills/maple/SKILL.md", codex_skill_md()) {
    Ok(path) => written_files.push(path),
    Err(error) => {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
  }

  let (cli_found, registered, out, err, reg_error) = run_registration_commands(
    emitter,
    target_id,
    "wsl",
    vec!["-e".into(), "bash".into(), "-lc".into(), "codex mcp remove maple".into()],
    vec![
      "-e".into(),
      "bash".into(),
      "-lc".into(),
      format!("codex mcp add maple --url {}", MAPLE_MCP_URL),
    ],
  );
  stdout = out;
  stderr = err;

  if cli_found == Some(false) {
    emitter.target_state(target_id, "error");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: false,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: Some("未检测到 CLI：codex（WSL）".to_string()),
    };
  }

  let result = InstallTargetResult {
    id: target_id.to_string(),
    runtime: Some(runtime.as_str().to_string()),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  };
  emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
  result
}

fn install_claude(home: &Path, emitter: &InstallEventEmitter, runtime: InstallRuntime, target_id: &str) -> InstallTargetResult {
  let mut written_files = Vec::new();
  let mut stdout = String::new();
  let mut stderr = String::new();

  emitter.target_state(target_id, "running");
  let cli_detected = match runtime {
    InstallRuntime::Native => detect_cli_native("claude"),
    InstallRuntime::Wsl => detect_cli_wsl("claude"),
  };
  if !cli_detected {
    let scope = if runtime == InstallRuntime::Native { "本机" } else { "WSL" };
    emitter.log(Some(target_id), "stderr", format!("未检测到 CLI：claude（{scope}），已跳过。\n"));
    emitter.target_state(target_id, "success");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: true,
      skipped: true,
      cli_found: Some(false),
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  if runtime == InstallRuntime::Native {
    let command_path = home.join(".claude").join("commands").join("maple.md");
    emitter.log(Some(target_id), "info", format!("写入 {}\n", pretty_path(&command_path)));
    if let Err(error) = write_text_file(&command_path, claude_command_md()) {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
    written_files.push(pretty_path(&command_path));

    let (cli_found, registered, out, err, reg_error) = run_registration_commands(
      emitter,
      target_id,
      "claude",
      vec!["mcp".into(), "remove".into(), "maple".into(), "--scope".into(), "user".into()],
      vec![
        "mcp".into(),
        "add".into(),
        "--scope".into(),
        "user".into(),
        "--transport".into(),
        "http".into(),
        "maple".into(),
        MAPLE_MCP_URL.into(),
      ],
    );
    stdout = out;
    stderr = err;

    if cli_found == Some(false) {
      emitter.target_state(target_id, "error");
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found,
        written_files,
        stdout,
        stderr,
        error: Some("未检测到 CLI：claude（本机）".to_string()),
      };
    }

    let result = InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: registered && reg_error.is_none(),
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: reg_error,
    };
    emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
    return result;
  }

  match wsl_write_home_file(emitter, target_id, ".claude/commands/maple.md", claude_command_md()) {
    Ok(path) => written_files.push(path),
    Err(error) => {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
  }

  let (cli_found, registered, out, err, reg_error) = run_registration_commands(
    emitter,
    target_id,
    "wsl",
    vec![
      "-e".into(),
      "bash".into(),
      "-lc".into(),
      "claude mcp remove maple --scope user".into(),
    ],
    vec![
      "-e".into(),
      "bash".into(),
      "-lc".into(),
      format!("claude mcp add --scope user --transport http maple {}", MAPLE_MCP_URL),
    ],
  );
  stdout = out;
  stderr = err;

  if cli_found == Some(false) {
    emitter.target_state(target_id, "error");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: false,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: Some("未检测到 CLI：claude（WSL）".to_string()),
    };
  }

  let result = InstallTargetResult {
    id: target_id.to_string(),
    runtime: Some(runtime.as_str().to_string()),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  };
  emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
  result
}

fn install_iflow(home: &Path, emitter: &InstallEventEmitter, runtime: InstallRuntime, target_id: &str) -> InstallTargetResult {
  let mut written_files = Vec::new();
  let mut stdout = String::new();
  let mut stderr = String::new();

  emitter.target_state(target_id, "running");
  let cli_detected = match runtime {
    InstallRuntime::Native => detect_cli_native("iflow"),
    InstallRuntime::Wsl => detect_cli_wsl("iflow"),
  };
  if !cli_detected {
    let scope = if runtime == InstallRuntime::Native { "本机" } else { "WSL" };
    emitter.log(Some(target_id), "stderr", format!("未检测到 CLI：iflow（{scope}），已跳过。\n"));
    emitter.target_state(target_id, "success");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: true,
      skipped: true,
      cli_found: Some(false),
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  let index_md = r#"---
name: maple
description: "Project-local maple skill index."
---

# maple

Use `~/.iflow/skills/maple/SKILL.md` for the full maple execution skill.
"#;

  if runtime == InstallRuntime::Native {
    let workflow_path = home.join(".iflow").join("workflows").join("maple.md");
    emitter.log(Some(target_id), "info", format!("写入 {}\n", pretty_path(&workflow_path)));
    if let Err(error) = write_text_file(&workflow_path, iflow_workflow_md()) {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
    written_files.push(pretty_path(&workflow_path));

    let skill_path = home.join(".iflow").join("skills").join("maple").join("SKILL.md");
    emitter.log(Some(target_id), "info", format!("写入 {}\n", pretty_path(&skill_path)));
    if let Err(error) = write_text_file(&skill_path, iflow_skill_md()) {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
    written_files.push(pretty_path(&skill_path));

    // Only create the skills index if it doesn't exist to avoid overwriting user content.
    let skill_index_path = home.join(".iflow").join("skills").join("SKILL.md");
    if !skill_index_path.exists() {
      emitter.log(Some(target_id), "info", format!("写入 {}\n", pretty_path(&skill_index_path)));
      if let Err(error) = write_text_file(&skill_index_path, index_md) {
        emitter.target_state(target_id, "error");
        emitter.log(Some(target_id), "stderr", format!("{error}\n"));
        return InstallTargetResult {
          id: target_id.to_string(),
          runtime: Some(runtime.as_str().to_string()),
          success: false,
          skipped: false,
          cli_found: Some(true),
          written_files,
          stdout,
          stderr,
          error: Some(error),
        };
      }
      written_files.push(pretty_path(&skill_index_path));
    }

    let (cli_found, registered, out, err, reg_error) = run_registration_commands(
      emitter,
      target_id,
      "iflow",
      vec!["mcp".into(), "remove".into(), "maple".into()],
      vec![
        "mcp".into(),
        "add".into(),
        "--scope".into(),
        "user".into(),
        "--transport".into(),
        "http".into(),
        "maple".into(),
        MAPLE_MCP_URL.into(),
      ],
    );
    stdout = out;
    stderr = err;

    if cli_found == Some(false) {
      emitter.target_state(target_id, "error");
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found,
        written_files,
        stdout,
        stderr,
        error: Some("未检测到 CLI：iflow（本机）".to_string()),
      };
    }

    let result = InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: registered && reg_error.is_none(),
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: reg_error,
    };
    emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
    return result;
  }

  match wsl_write_home_file(emitter, target_id, ".iflow/workflows/maple.md", iflow_workflow_md()) {
    Ok(path) => written_files.push(path),
    Err(error) => {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
  }

  match wsl_write_home_file(emitter, target_id, ".iflow/skills/maple/SKILL.md", iflow_skill_md()) {
    Ok(path) => written_files.push(path),
    Err(error) => {
      emitter.target_state(target_id, "error");
      emitter.log(Some(target_id), "stderr", format!("{error}\n"));
      return InstallTargetResult {
        id: target_id.to_string(),
        runtime: Some(runtime.as_str().to_string()),
        success: false,
        skipped: false,
        cli_found: Some(true),
        written_files,
        stdout,
        stderr,
        error: Some(error),
      };
    }
  }

  // Only create the skills index if it doesn't exist to avoid overwriting user content.
  let index_exists = wsl_home_file_exists(".iflow/skills/SKILL.md").unwrap_or(true);
  if !index_exists {
    match wsl_write_home_file(emitter, target_id, ".iflow/skills/SKILL.md", index_md) {
      Ok(path) => written_files.push(path),
      Err(error) => {
        emitter.target_state(target_id, "error");
        emitter.log(Some(target_id), "stderr", format!("{error}\n"));
        return InstallTargetResult {
          id: target_id.to_string(),
          runtime: Some(runtime.as_str().to_string()),
          success: false,
          skipped: false,
          cli_found: Some(true),
          written_files,
          stdout,
          stderr,
          error: Some(error),
        };
      }
    }
  }

  let (cli_found, registered, out, err, reg_error) = run_registration_commands(
    emitter,
    target_id,
    "wsl",
    vec!["-e".into(), "bash".into(), "-lc".into(), "iflow mcp remove maple".into()],
    vec![
      "-e".into(),
      "bash".into(),
      "-lc".into(),
      format!("iflow mcp add --scope user --transport http maple {}", MAPLE_MCP_URL),
    ],
  );
  stdout = out;
  stderr = err;

  if cli_found == Some(false) {
    emitter.target_state(target_id, "error");
    return InstallTargetResult {
      id: target_id.to_string(),
      runtime: Some(runtime.as_str().to_string()),
      success: false,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: Some("未检测到 CLI：iflow（WSL）".to_string()),
    };
  }

  let result = InstallTargetResult {
    id: target_id.to_string(),
    runtime: Some(runtime.as_str().to_string()),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  };
  emitter.target_state(target_id, if result.success && result.error.is_none() { "success" } else { "error" });
  result
}

fn install_windsurf(home: &Path, emitter: &InstallEventEmitter) -> InstallTargetResult {
  let mut written_files = Vec::new();

  emitter.target_state("windsurf", "running");
  let config_path = home
    .join(".codeium")
    .join("windsurf")
    .join("mcp_config.json");

  let mut root = serde_json::Value::Object(Default::default());
  if config_path.exists() {
    if let Ok(raw) = fs::read_to_string(&config_path) {
      let trimmed = raw.trim();
      if !trimmed.is_empty() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
          root = parsed;
        }
      }
    }
  }

  if !root.is_object() {
    root = serde_json::Value::Object(Default::default());
  }
  let obj = root.as_object_mut().unwrap();
  let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));
  if !servers.is_object() {
    *servers = json!({});
  }
  servers
    .as_object_mut()
    .unwrap()
    .insert("maple".to_string(), json!({ "url": MAPLE_MCP_URL }));

  let json_text = serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{\n}\n".to_string());
  emitter.log(Some("windsurf"), "info", format!("写入 {}\n", pretty_path(&config_path)));
  if let Err(error) = write_text_file(&config_path, &(json_text + "\n")) {
    emitter.target_state("windsurf", "error");
    emitter.log(Some("windsurf"), "stderr", format!("{error}\n"));
    return InstallTargetResult {
      id: "windsurf".to_string(),
      runtime: Some("native".to_string()),
      success: false,
      skipped: false,
      cli_found: None,
      written_files,
      stdout: String::new(),
      stderr: String::new(),
      error: Some(error),
    };
  }
  written_files.push(pretty_path(&config_path));

  let result = InstallTargetResult {
    id: "windsurf".to_string(),
    runtime: Some("native".to_string()),
    success: true,
    skipped: false,
    cli_found: None,
    written_files,
    stdout: String::new(),
    stderr: String::new(),
    error: None,
  };
  emitter.target_state("windsurf", "success");
  result
}

pub fn install_mcp_and_skills(options: InstallMcpSkillsOptions) -> Result<InstallMcpSkillsReport, String> {
  install_mcp_and_skills_with_events(options, None)
}

pub fn install_mcp_and_skills_with_events(
  options: InstallMcpSkillsOptions,
  emit: Option<Arc<dyn Fn(InstallTaskEvent) + Send + Sync>>,
) -> Result<InstallMcpSkillsReport, String> {
  let home = maple_fs::user_home_dir()?;
  let mut targets = Vec::new();
  let install_id = options
    .install_id
    .as_deref()
    .unwrap_or("")
    .trim()
    .to_string();
  let resolved_install_id = if !install_id.is_empty() {
    install_id
  } else {
    let ts = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis();
    format!("install-{ts}")
  };
  let emitter = InstallEventEmitter {
    install_id: resolved_install_id.clone(),
    emit,
  };

  if options.codex {
    let result = install_codex(&home, &emitter, InstallRuntime::Native, "codex");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.wsl_codex {
    let result = install_codex(&home, &emitter, InstallRuntime::Wsl, "wsl:codex");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.claude {
    let result = install_claude(&home, &emitter, InstallRuntime::Native, "claude");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.wsl_claude {
    let result = install_claude(&home, &emitter, InstallRuntime::Wsl, "wsl:claude");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.iflow {
    let result = install_iflow(&home, &emitter, InstallRuntime::Native, "iflow");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.wsl_iflow {
    let result = install_iflow(&home, &emitter, InstallRuntime::Wsl, "wsl:iflow");
    emitter.target_result(result.clone());
    targets.push(result);
  }
  if options.windsurf {
    let result = install_windsurf(&home, &emitter);
    emitter.target_result(result.clone());
    targets.push(result);
  }

  let report = InstallMcpSkillsReport {
    mcp_url: MAPLE_MCP_URL.to_string(),
    targets,
  };

  Ok(report)
}
