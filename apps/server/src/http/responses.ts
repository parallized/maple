import type { ApiError } from "@maple/protocol";

export function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function unauthorized(): Response {
  return apiError(401, "unauthorized", "认证信息无效或已过期。");
}

export function forbidden(message = "当前会话无权执行这个操作。"): Response {
  return apiError(403, "forbidden", message);
}

export function notFound(message: string): Response {
  return apiError(404, "not_found", message);
}

export function conflict(message: string): Response {
  return apiError(409, "conflict", message);
}
