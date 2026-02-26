use std::borrow::Cow;

use tauri::http::{header, Response, StatusCode};

use crate::maple_fs;

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

fn text_response(status: StatusCode, message: &'static str) -> Response<Cow<'static, [u8]>> {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
    .body(Cow::Borrowed(message.as_bytes()))
    .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"")))
}

/// Extract the asset file name from a `maple://` URI.
///
/// Handles all URI variants across platforms:
///   maple://asset/filename.png   → authority="asset", path="/filename.png"
///   maple:///asset/filename.png  → authority="",      path="/asset/filename.png"
///   maple://asset/filename.png/  → trailing slash
///   maple://localhost/asset/...  → authority="localhost" (Windows WebView2)
fn extract_asset_file_name(uri: &tauri::http::Uri) -> Option<&str> {
  let authority = uri.authority().map(|value| value.as_str()).unwrap_or("");
  let path = uri.path();

  // maple://asset/<filename>
  if authority == "asset" {
    let stripped = path.strip_prefix('/').unwrap_or(path);
    let stripped = stripped.strip_suffix('/').unwrap_or(stripped);
    if !stripped.is_empty() {
      return Some(stripped);
    }
  }

  // maple://localhost/asset/<filename>  (Windows WebView2 may normalise this way)
  if authority == "localhost" {
    if let Some(rest) = path.strip_prefix("/asset/") {
      let rest = rest.strip_suffix('/').unwrap_or(rest);
      if !rest.is_empty() {
        return Some(rest);
      }
    }
  }

  // maple:///asset/<filename>  (triple-slash, empty authority)
  if let Some(rest) = path.strip_prefix("/asset/") {
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    if !rest.is_empty() {
      return Some(rest);
    }
  }

  // Fallback: try to find "asset/" anywhere in the path
  if let Some(idx) = path.find("asset/") {
    let rest = &path[idx + 6..];
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    if !rest.is_empty() {
      return Some(rest);
    }
  }

  None
}

pub fn handle<R: tauri::Runtime>(
  _ctx: tauri::UriSchemeContext<'_, R>,
  request: tauri::http::Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
  let uri = request.uri();

  let Some(file_name) = extract_asset_file_name(uri).map(|value| value.trim()) else {
    eprintln!("[maple-protocol] 404 — no asset file name in URI: {uri}");
    return text_response(StatusCode::NOT_FOUND, "Not Found");
  };

  if !maple_fs::is_valid_asset_file_name(file_name) {
    eprintln!("[maple-protocol] 400 — invalid asset file name: {file_name}");
    return text_response(StatusCode::BAD_REQUEST, "无效的 asset 文件名。");
  }

  let dir = match maple_fs::asset_dir() {
    Ok(value) => value,
    Err(e) => {
      eprintln!("[maple-protocol] 500 — cannot create assets dir: {e}");
      return text_response(StatusCode::INTERNAL_SERVER_ERROR, "无法创建 assets 目录。");
    }
  };
  let path = dir.join(file_name);
  if !path.exists() {
    eprintln!("[maple-protocol] 404 — asset file not found: {}", path.display());
    return text_response(StatusCode::NOT_FOUND, "asset 文件不存在。");
  }

  let ext = file_name.split('.').nth(1).unwrap_or_default();
  let mime = mime_from_extension(ext);

  match std::fs::read(&path) {
    Ok(bytes) => Response::builder()
      .status(StatusCode::OK)
      .header(header::CONTENT_TYPE, mime)
      .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
      .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
      .body(Cow::Owned(bytes))
      .unwrap_or_else(|_| text_response(StatusCode::INTERNAL_SERVER_ERROR, "响应构建失败。")),
    Err(e) => {
      eprintln!("[maple-protocol] 500 — failed to read asset: {e}");
      text_response(StatusCode::INTERNAL_SERVER_ERROR, "读取 asset 文件失败。")
    }
  }
}
