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

fn extract_asset_file_name(uri: &tauri::http::Uri) -> Option<&str> {
  let authority = uri.authority().map(|value| value.as_str()).unwrap_or("");
  let path = uri.path();

  if authority == "asset" {
    return Some(path.strip_prefix('/').unwrap_or(path));
  }

  path.strip_prefix("/asset/")
}

pub fn handle<R: tauri::Runtime>(
  _ctx: tauri::UriSchemeContext<'_, R>,
  request: tauri::http::Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
  let Some(file_name) = extract_asset_file_name(request.uri()).map(|value| value.trim()) else {
    return text_response(StatusCode::NOT_FOUND, "Not Found");
  };

  if !maple_fs::is_valid_asset_file_name(file_name) {
    return text_response(StatusCode::BAD_REQUEST, "无效的 asset 文件名。");
  }

  let dir = match maple_fs::asset_dir() {
    Ok(value) => value,
    Err(_) => {
      return text_response(StatusCode::INTERNAL_SERVER_ERROR, "无法创建 assets 目录。");
    }
  };
  let path = dir.join(file_name);
  if !path.exists() {
    return text_response(StatusCode::NOT_FOUND, "asset 文件不存在。");
  }

  let ext = file_name.split('.').nth(1).unwrap_or_default();
  let mime = mime_from_extension(ext);

  match std::fs::read(&path) {
    Ok(bytes) => Response::builder()
      .status(StatusCode::OK)
      .header(header::CONTENT_TYPE, mime)
      .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
      .body(Cow::Owned(bytes))
      .unwrap_or_else(|_| text_response(StatusCode::INTERNAL_SERVER_ERROR, "响应构建失败。")),
    Err(_) => text_response(StatusCode::INTERNAL_SERVER_ERROR, "读取 asset 文件失败。"),
  }
}

