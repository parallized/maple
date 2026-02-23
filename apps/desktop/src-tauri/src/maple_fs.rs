use std::path::PathBuf;

pub fn maple_home_dir() -> Result<PathBuf, String> {
  let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 目录".to_string())?;
  Ok(PathBuf::from(home).join(".maple"))
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

