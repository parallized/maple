use std::path::PathBuf;

fn read_env_non_empty(key: &str) -> Option<String> {
  let value = std::env::var(key).ok()?;
  let trimmed = value.trim().to_string();
  if trimmed.is_empty() { None } else { Some(trimmed) }
}

pub fn user_home_dir() -> Result<PathBuf, String> {
  if let Some(home) = dirs::home_dir() {
    return Ok(home);
  }
  if let Some(home) = read_env_non_empty("HOME") {
    return Ok(PathBuf::from(home));
  }
  if let Some(profile) = read_env_non_empty("USERPROFILE") {
    return Ok(PathBuf::from(profile));
  }
  let drive = read_env_non_empty("HOMEDRIVE");
  let path = read_env_non_empty("HOMEPATH");
  if let (Some(drive), Some(path)) = (drive, path) {
    return Ok(PathBuf::from(format!("{drive}{path}")));
  }
  Err("无法获取用户 Home 目录".to_string())
}

pub fn maple_home_dir() -> Result<PathBuf, String> {
  Ok(user_home_dir()?.join(".maple"))
}

pub fn asset_dir() -> Result<PathBuf, String> {
  let dir = maple_home_dir()?.join("assets");
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建 assets 目录失败: {e}"))?;
  Ok(dir)
}

pub fn is_valid_asset_file_name(value: &str) -> bool {
  let trimmed = value.trim();
  if trimmed.len() < 66 || trimmed.len() > 73 {
    return false;
  }
  if trimmed.contains('/') || trimmed.contains('\\') {
    return false;
  }
  let mut parts = trimmed.splitn(2, '.');
  let Some(hash) = parts.next() else { return false };
  let Some(ext) = parts.next() else { return false };
  if hash.len() != 64 || ext.is_empty() || ext.len() > 8 {
    return false;
  }
  if !hash.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
    return false;
  }
  if !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
    return false;
  }
  true
}

