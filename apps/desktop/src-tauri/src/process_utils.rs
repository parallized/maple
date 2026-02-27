use std::process::Command;

pub fn build_cli_command(executable: &str, args: &[String]) -> Command {
  #[cfg(target_os = "windows")]
  {
    let trimmed = executable.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower == "wsl" || lower.ends_with("\\wsl.exe") || lower.ends_with("/wsl.exe") {
      let mut command = Command::new(trimmed);
      command.args(args);
      apply_no_window(&mut command);
      return command;
    }

    let mut command = Command::new("cmd");
    command.arg("/D").arg("/C").arg(executable);
    command.args(args);
    maybe_apply_claude_git_bash_env(&mut command, executable);
    apply_no_window(&mut command);
    return command;
  }

  #[cfg(not(target_os = "windows"))]
  {
    let mut command = Command::new(executable);
    command.args(args);
    command
  }
}

pub fn apply_no_window(command: &mut Command) {
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
}

pub fn kill_process_tree(pid: u32) {
  #[cfg(target_os = "windows")]
  {
    let mut command = Command::new("taskkill");
    command.arg("/PID").arg(pid.to_string()).arg("/T").arg("/F");
    apply_no_window(&mut command);
    let _ = command.output();
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).output();
  }
}

#[cfg(target_os = "windows")]
fn maybe_apply_claude_git_bash_env(command: &mut Command, executable: &str) {
  if !is_claude_executable(executable) {
    return;
  }

  let Some(bash_path) = resolve_git_bash_path() else {
    return;
  };

  command.env("CLAUDE_CODE_GIT_BASH_PATH", bash_path);
}

#[cfg(not(target_os = "windows"))]
fn maybe_apply_claude_git_bash_env(_command: &mut Command, _executable: &str) {}

#[cfg(target_os = "windows")]
fn is_claude_executable(executable: &str) -> bool {
  let trimmed = executable.trim().trim_matches('"').trim_matches('\'');
  if trimmed.is_empty() {
    return false;
  }

  let lower = trimmed.to_ascii_lowercase();
  let file_name = lower
    .rsplit(['\\', '/'])
    .next()
    .unwrap_or(lower.as_str());

  matches!(file_name, "claude" | "claude.exe" | "claude.cmd" | "claude.bat")
}

#[cfg(target_os = "windows")]
fn resolve_git_bash_path() -> Option<std::ffi::OsString> {
  use std::env;
  use std::ffi::OsString;
  use std::fs;
  use std::path::PathBuf;

  fn strip_wrapping_quotes(value: &OsString) -> OsString {
    let Some(text) = value.to_str() else {
      return value.clone();
    };
    let trimmed = text.trim();
    if trimmed.len() >= 2
      && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
      return OsString::from(&trimmed[1..trimmed.len() - 1]);
    }
    OsString::from(trimmed)
  }

  if let Some(raw) = env::var_os("CLAUDE_CODE_GIT_BASH_PATH") {
    let normalized = strip_wrapping_quotes(&raw);
    if PathBuf::from(&normalized).is_file() {
      return Some(normalized);
    }
  }

  let mut candidates: Vec<PathBuf> = Vec::new();

  for key in ["ProgramFiles", "ProgramFiles(x86)"] {
    if let Some(root) = env::var_os(key) {
      let base = PathBuf::from(root).join("Git");
      candidates.push(base.join("bin").join("bash.exe"));
      candidates.push(base.join("usr").join("bin").join("bash.exe"));
    }
  }

  if let Some(root) = env::var_os("LOCALAPPDATA") {
    let base = PathBuf::from(root).join("Programs").join("Git");
    candidates.push(base.join("bin").join("bash.exe"));
    candidates.push(base.join("usr").join("bin").join("bash.exe"));
  }

  if let Some(profile) = env::var_os("USERPROFILE") {
    let scoop_git = PathBuf::from(profile).join("scoop").join("apps").join("git");
    let current = scoop_git.join("current");
    candidates.push(current.join("bin").join("bash.exe"));
    candidates.push(current.join("usr").join("bin").join("bash.exe"));

    if scoop_git.is_dir() {
      let mut dirs: Vec<PathBuf> = fs::read_dir(&scoop_git)
        .ok()
        .into_iter()
        .flat_map(|iter| iter.filter_map(|entry| entry.ok()))
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|n| n.to_str()) != Some("current"))
        .collect();

      dirs.sort();
      for dir in dirs.into_iter().rev().take(4) {
        candidates.push(dir.join("bin").join("bash.exe"));
        candidates.push(dir.join("usr").join("bin").join("bash.exe"));
      }
    }
  }

  if let Some(path_var) = env::var_os("PATH") {
    for dir in env::split_paths(&path_var) {
      let lower = dir.to_string_lossy().to_ascii_lowercase();
      if lower.contains("\\windows\\system32") {
        continue;
      }

      let direct = dir.join("bash.exe");
      if direct.is_file() {
        return Some(direct.into_os_string());
      }

      if lower.ends_with("\\git\\cmd") || lower.ends_with("/git/cmd") {
        if let Some(parent) = dir.parent() {
          candidates.push(parent.join("bin").join("bash.exe"));
          candidates.push(parent.join("usr").join("bin").join("bash.exe"));
        }
      }
    }
  }

  candidates
    .into_iter()
    .find(|path| path.is_file())
    .map(|p| p.into_os_string())
}

