import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import type { AuthSessionResponse } from "@maple/protocol";
import type { DashboardApi } from "../api/client";

export function SecurityReviewScreen({
  api,
  session,
  onApproved,
  onSignedOut
}: {
  api: DashboardApi;
  session: AuthSessionResponse;
  onApproved: (session: AuthSessionResponse) => void;
  onSignedOut: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setChecking(true);
    setError("");
    try {
      const next = await api.session();
      if (next.authenticated) {
        api.setCsrfToken(next.csrfToken);
        if (next.session.trust === "trusted") onApproved(next);
      } else {
        onSignedOut();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, []);

  async function signOut() {
    try { await api.logout(); } finally { onSignedOut(); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-(--color-base-200) px-5 text-(--color-base-content)">
      <section className="w-full max-w-[440px] border-y border-(--color-base-300) bg-(--color-base-100) px-2 py-8 sm:border sm:px-8">
        <Icon icon="mingcute:safe-shield-line" className="mb-5 text-3xl text-(--color-warning)" />
        <h1 className="font-serif text-2xl">确认这次登录</h1>
        <p className="mt-3 text-sm leading-6 text-(--color-secondary)">
          这次登录来自新的位置或浏览器。请在已登录设备的账户安全中确认后继续。
        </p>
        <dl className="mt-6 divide-y divide-(--color-base-300) border-y border-(--color-base-300) text-sm">
          <div className="flex justify-between gap-4 py-3"><dt className="text-(--color-secondary)">设备</dt><dd>{session.session.deviceLabel}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-(--color-secondary)">地址</dt><dd>{session.session.ipAddress}</dd></div>
        </dl>
        {error ? <p className="mt-4 text-sm text-(--color-error)">{error}</p> : null}
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={checking} className="flex h-10 flex-1 items-center justify-center gap-2 bg-(--color-base-content) px-4 text-sm font-medium text-(--color-base-100) disabled:opacity-60">
            <Icon icon={checking ? "mingcute:loading-3-line" : "mingcute:refresh-2-line"} className={checking ? "animate-spin" : ""} />
            检查状态
          </button>
          <button type="button" onClick={() => void signOut()} className="flex size-10 items-center justify-center border border-(--color-base-300)" title="退出登录" aria-label="退出登录">
            <Icon icon="mingcute:exit-line" />
          </button>
        </div>
      </section>
    </main>
  );
}
