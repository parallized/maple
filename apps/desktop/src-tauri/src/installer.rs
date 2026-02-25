use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path};
use std::process::Command;

use crate::maple_fs;

const MAPLE_MCP_URL: &str = "http://localhost:45819/mcp";

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallMcpSkillsOptions {
  pub codex: bool,
  pub claude: bool,
  pub iflow: bool,
  pub windsurf: bool,
}

impl Default for InstallMcpSkillsOptions {
  fn default() -> Self {
    Self {
      codex: true,
      claude: true,
      iflow: true,
      windsurf: true,
    }
  }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallTargetResult {
  pub id: String,
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
  executable: &str,
  remove_args: Vec<String>,
  add_args: Vec<String>,
) -> (Option<bool>, bool, String, String, Option<String>) {
  let mut stdout = String::new();
  let mut stderr = String::new();

  let remove_out = run_cli(executable, &remove_args, None);
  match remove_out {
    Ok(out) => {
      if is_windows_cli_not_found(&out) {
        return (Some(false), false, out.stdout, out.stderr, None);
      }
      if !out.stdout.is_empty() {
        stdout.push_str(&out.stdout);
        stdout.push('\n');
      }
      if !out.stderr.is_empty() {
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
        return (Some(false), false, "".to_string(), error, None);
      }
      return (Some(true), false, stdout, stderr, Some(error));
    }
  }

  let add_out = run_cli(executable, &add_args, None);
  match add_out {
    Ok(out) => {
      if is_windows_cli_not_found(&out) {
        return (Some(false), false, out.stdout, out.stderr, None);
      }
      if !out.stdout.is_empty() {
        stdout.push_str(&out.stdout);
        stdout.push('\n');
      }
      if !out.stderr.is_empty() {
        stderr.push_str(&out.stderr);
        stderr.push('\n');
      }
      if out.success {
        (Some(true), true, stdout.trim().to_string(), stderr.trim().to_string(), None)
      } else {
        let detail = format!("MCP 注册失败（exit: {}）", out.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()));
        (Some(true), false, stdout.trim().to_string(), stderr.trim().to_string(), Some(detail))
      }
    }
    Err(error) => (Some(true), false, stdout.trim().to_string(), stderr.trim().to_string(), Some(error)),
  }
}

fn install_codex(home: &Path) -> InstallTargetResult {
  let mut written_files = Vec::new();
  let mut stdout = String::new();
  let mut stderr = String::new();

  let skill_path = home.join(".codex").join("skills").join("maple").join("SKILL.md");
  if let Err(error) = write_text_file(&skill_path, codex_skill_md()) {
    return InstallTargetResult {
      id: "codex".to_string(),
      success: false,
      skipped: false,
      cli_found: None,
      written_files,
      stdout,
      stderr,
      error: Some(error),
    };
  }
  written_files.push(pretty_path(&skill_path));

  let (cli_found, registered, out, err, reg_error) = run_registration_commands(
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
    return InstallTargetResult {
      id: "codex".to_string(),
      success: true,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  InstallTargetResult {
    id: "codex".to_string(),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  }
}

fn install_claude(home: &Path) -> InstallTargetResult {
  let mut written_files = Vec::new();
  let mut stdout = String::new();
  let mut stderr = String::new();

  let command_path = home.join(".claude").join("commands").join("maple.md");
  if let Err(error) = write_text_file(&command_path, claude_command_md()) {
    return InstallTargetResult {
      id: "claude".to_string(),
      success: false,
      skipped: false,
      cli_found: None,
      written_files,
      stdout,
      stderr,
      error: Some(error),
    };
  }
  written_files.push(pretty_path(&command_path));

  let (cli_found, registered, out, err, reg_error) = run_registration_commands(
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
    return InstallTargetResult {
      id: "claude".to_string(),
      success: true,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  InstallTargetResult {
    id: "claude".to_string(),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  }
}

fn install_iflow(home: &Path) -> InstallTargetResult {
  let mut written_files = Vec::new();

  let workflow_path = home.join(".iflow").join("workflows").join("maple.md");
  if let Err(error) = write_text_file(&workflow_path, iflow_workflow_md()) {
    return InstallTargetResult {
      id: "iflow".to_string(),
      success: false,
      skipped: false,
      cli_found: None,
      written_files,
      stdout: String::new(),
      stderr: String::new(),
      error: Some(error),
    };
  }
  written_files.push(pretty_path(&workflow_path));

  let skill_path = home.join(".iflow").join("skills").join("maple").join("SKILL.md");
  if let Err(error) = write_text_file(&skill_path, iflow_skill_md()) {
    return InstallTargetResult {
      id: "iflow".to_string(),
      success: false,
      skipped: false,
      cli_found: None,
      written_files,
      stdout: String::new(),
      stderr: String::new(),
      error: Some(error),
    };
  }
  written_files.push(pretty_path(&skill_path));

  // Only create the skills index if it doesn't exist to avoid overwriting user content.
  let skill_index_path = home.join(".iflow").join("skills").join("SKILL.md");
  if !skill_index_path.exists() {
    let index_md = r#"---
name: maple
description: "Project-local maple skill index."
---

# maple

Use `~/.iflow/skills/maple/SKILL.md` for the full maple execution skill.
"#;
    if let Err(error) = write_text_file(&skill_index_path, index_md) {
      return InstallTargetResult {
        id: "iflow".to_string(),
        success: false,
        skipped: false,
        cli_found: None,
        written_files,
        stdout: String::new(),
        stderr: String::new(),
        error: Some(error),
      };
    }
    written_files.push(pretty_path(&skill_index_path));
  }

  let (cli_found, registered, stdout, stderr, reg_error) = run_registration_commands(
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

  if cli_found == Some(false) {
    return InstallTargetResult {
      id: "iflow".to_string(),
      success: true,
      skipped: false,
      cli_found,
      written_files,
      stdout,
      stderr,
      error: None,
    };
  }

  InstallTargetResult {
    id: "iflow".to_string(),
    success: registered && reg_error.is_none(),
    skipped: false,
    cli_found,
    written_files,
    stdout,
    stderr,
    error: reg_error,
  }
}

fn install_windsurf(home: &Path) -> InstallTargetResult {
  let mut written_files = Vec::new();

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
  if let Err(error) = write_text_file(&config_path, &(json_text + "\n")) {
    return InstallTargetResult {
      id: "windsurf".to_string(),
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

  InstallTargetResult {
    id: "windsurf".to_string(),
    success: true,
    skipped: false,
    cli_found: None,
    written_files,
    stdout: String::new(),
    stderr: String::new(),
    error: None,
  }
}

pub fn install_mcp_and_skills(options: InstallMcpSkillsOptions) -> Result<InstallMcpSkillsReport, String> {
  let home = maple_fs::user_home_dir()?;
  let mut targets = Vec::new();

  if options.codex {
    targets.push(install_codex(&home));
  }
  if options.claude {
    targets.push(install_claude(&home));
  }
  if options.iflow {
    targets.push(install_iflow(&home));
  }
  if options.windsurf {
    targets.push(install_windsurf(&home));
  }

  Ok(InstallMcpSkillsReport {
    mcp_url: MAPLE_MCP_URL.to_string(),
    targets,
  })
}
