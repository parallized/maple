import type { AuthSessionResponse } from "@maple/protocol";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { DashboardApi, DashboardApiError } from "./api/client";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { DeviceAuthorizationScreen } from "./components/DeviceAuthorizationScreen";
import { DocsPage } from "./components/DocsPage";
import { HomePage } from "./components/HomePage";
import { SecurityReviewScreen } from "./components/SecurityReviewScreen";
import { defaultServerUrl } from "./lib/connection";

const DashboardPage = lazy(() => import("./DashboardPage").then((module) => ({ default: module.DashboardPage })));

function normalizePath(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function App() {
  const api = useMemo(() => {
    const client = new DashboardApi(defaultServerUrl());
    try {
      client.setWorkspaceId(sessionStorage.getItem("maple.web.tab-workspace") ?? "");
    } catch {
      // Session storage can be unavailable in hardened/private browsing contexts.
    }
    return client;
  }, []);
  const [session, setSession] = useState<AuthSessionResponse | null | undefined>(undefined);
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));
  /* dev 模式下根路径保留官网首页，让本地开发也能直接看到主页；生产构建 standalone 仍直接进看板。 */
  const isDev = import.meta.env.DEV;

  const navigate = useCallback((to: string) => {
    if (normalizePath(window.location.pathname) !== to) window.history.pushState({}, "", to);
    setPathname(to);
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const adoptSession = useCallback((next: AuthSessionResponse) => {
    api.setCsrfToken(next.csrfToken);
    api.setWorkspaceId(next.workspace.id);
    try {
      sessionStorage.setItem("maple.web.tab-workspace", next.workspace.id);
    } catch {
      // The selected workspace remains valid for the lifetime of this page.
    }
    setSession(next);
  }, [api]);

  const signedOut = useCallback(() => {
    api.setCsrfToken("");
    api.setWorkspaceId("");
    try {
      sessionStorage.removeItem("maple.web.tab-workspace");
    } catch {
      // Ignore unavailable storage.
    }
    setSession(null);
  }, [api]);

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      try {
        return await api.session();
      } catch (error) {
        if (!(error instanceof DashboardApiError) || error.code !== "workspace_not_found") throw error;
        api.setWorkspaceId("");
        try { sessionStorage.removeItem("maple.web.tab-workspace"); } catch { /* ignore */ }
        return api.session();
      }
    };
    loadSession()
      .then((result) => {
        if (!active) return;
        if (result.authenticated) adoptSession(result);
        else signedOut();
      })
      .catch(() => { if (active) signedOut(); });
    return () => { active = false; };
  }, [api, adoptSession, signedOut]);

  /* 路由守卫：未登录访问 /dashboard 回登录页；已登录访问 /login 进看板；未知路径回收。官网 / 对所有人开放。 */
  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      if (pathname === "/dashboard") navigate("/login");
      return;
    }
    if (session.session.trust !== "trusted") return;
    const allowAuthorize = pathname === "/authorize" && session.deploymentMode === "hosted";
    const docsPath = pathname === "/docs" || pathname.startsWith("/docs/");
    /* 本地一体版没有官网首页：生产构建打开根路径直接进看板；dev 模式下保留主页入口。 */
    if (session.deploymentMode === "standalone" && pathname === "/" && !isDev) {
      navigate("/dashboard");
      return;
    }
    if (pathname === "/login" || (pathname !== "/" && pathname !== "/dashboard" && !allowAuthorize && !docsPath)) {
      navigate("/dashboard");
    }
  }, [session, pathname, navigate]);

  if (session === undefined) {
    return <main className="flex min-h-screen items-center justify-center bg-(--color-base-200) text-(--color-secondary)">正在连接 Maple</main>;
  }
  if (!session) {
    /* 配对确认页也需要先登录，/authorize 与 /login 一样直接给登录页。 */
    if (pathname === "/login" || pathname === "/authorize") {
      return (
        <ConnectionScreen
          api={api}
          onAuthenticated={(next) => {
            adoptSession(next);
            if (pathname === "/login") navigate("/dashboard");
          }}
        />
      );
    }
    if (pathname === "/dashboard") return null;
    if (pathname === "/docs" || pathname.startsWith("/docs/")) {
      return <DocsPage subPath={pathname.slice(5)} onNavigate={navigate} onEnter={() => navigate("/login")} />;
    }
    return <HomePage api={api} onEnter={() => navigate("/login")} onDocs={() => navigate("/docs")} />;
  }
  if (session.session.trust === "review") {
    return <SecurityReviewScreen api={api} session={session} onApproved={adoptSession} onSignedOut={signedOut} />;
  }

  const authorizationCode = new URLSearchParams(window.location.search).get("code")?.trim() || "";
  if (session.deploymentMode === "hosted" && pathname === "/authorize" && authorizationCode) {
    return (
      <DeviceAuthorizationScreen
        api={api}
        session={session}
        userCode={authorizationCode}
        onDone={() => {
          window.history.replaceState({}, "", "/dashboard");
          window.location.reload();
        }}
      />
    );
  }

  /* 使用文档对所有人开放，已登录时 CTA 回看板。 */
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return <DocsPage subPath={pathname.slice(5)} onNavigate={navigate} onEnter={() => navigate("/dashboard")} />;
  }

  /* 已登录也可以回官网逛逛，CTA 直接带去看板。 */
  if (pathname === "/") {
    if (session.deploymentMode === "standalone" && !isDev) return null;
    return <HomePage api={api} authed onEnter={() => navigate("/dashboard")} onDocs={() => navigate("/docs")} />;
  }

  /* 其余路径由路由守卫重定向到 /dashboard，渲染前等待导航完成。 */
  if (pathname !== "/dashboard") return null;

  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-(--color-base-200) text-(--color-secondary)">正在打开看板</main>}>
      <DashboardPage api={api} session={session} onSession={adoptSession} onSignedOut={signedOut} onHome={() => navigate("/")} />
    </Suspense>
  );
}
