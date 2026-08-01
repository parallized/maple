import { isAbsolute, relative, resolve, sep } from "node:path";

const STATIC_SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'"
  ].join("; "),
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
} as const;

const INSTALLER_PATHS = new Set([
  "/install.ps1",
  "/install.sh",
  "/install-local.ps1",
  "/install-local.sh"
]);

function notFound(message: string): Response {
  return Response.json({ error: { code: "not_found", message } }, { status: 404 });
}

function safeFilePath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = resolve(root, decoded.replace(/^\/+/, "").replaceAll("/", sep));
  const childPath = relative(root, candidate);
  if (childPath.startsWith("..") || isAbsolute(childPath)) return null;
  return candidate;
}

function fileResponse(file: ReturnType<typeof Bun.file>, immutable: boolean): Response {
  const headers = new Headers(STATIC_SECURITY_HEADERS);
  headers.set("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  return new Response(file, { headers });
}

export class DashboardAssets {
  readonly root: string;
  private readonly indexFile: ReturnType<typeof Bun.file>;

  constructor(root: string, private readonly publicUrl = "") {
    this.root = resolve(root);
    this.indexFile = Bun.file(resolve(this.root, "index.html"));
  }

  async handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (INSTALLER_PATHS.has(pathname)) {
      const installer = Bun.file(resolve(this.root, pathname.slice(1)));
      if (!await installer.exists()) return notFound("安装脚本尚未构建。");
      const serverUrl = (this.publicUrl || new URL(request.url).origin).replace(/\/$/, "");
      const content = (await installer.text()).replaceAll("__MAPLE_SERVER_URL__", serverUrl);
      return new Response(content, {
        headers: {
          ...STATIC_SECURITY_HEADERS,
          "cache-control": "no-store",
          "content-type": pathname.endsWith(".ps1")
            ? "text/plain; charset=utf-8"
            : "text/x-shellscript; charset=utf-8"
        }
      });
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return notFound("API 接口不存在。");
    }

    if (pathname !== "/") {
      const requestedPath = safeFilePath(this.root, pathname);
      if (!requestedPath) return notFound("看板资源不存在。");

      const requestedFile = Bun.file(requestedPath);
      if (await requestedFile.exists()) {
        return fileResponse(requestedFile, pathname.startsWith("/assets/"));
      }

      if (pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname)) {
        return notFound("看板资源不存在。");
      }
    }

    if (await this.indexFile.exists()) return fileResponse(this.indexFile, false);

    return new Response("Maple 看板资源尚未构建，请重新构建并发布完整的 Server 产物。", {
      status: 503,
      headers: {
        ...STATIC_SECURITY_HEADERS,
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
}
