import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import type { AuthSessionResponse } from "@maple/protocol";
import type { DashboardApi } from "../api/client";
import { LightPillar } from "./LightPillar";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0b10] px-5 py-10 text-(--color-base-content)">
      {/* 背景:Light Pillar 光柱,与 authorize / login 同款,黑白灰紫配色 */}
      <LightPillar className="absolute inset-0" topColor="#4c3d99" bottomColor="#c9c9d4" intensity={0.55} pillarRotation={30} pillarWidth={1.7} zoom={1.5} quality="high" />

      <section className="auth-screen-enter relative w-full max-w-[440px]">
        <style>{`
          @keyframes auth-screen-enter {
            from { opacity: 0; transform: translateY(10px); filter: blur(4px); }
            to { opacity: 1; transform: none; filter: blur(0); }
          }
          /* fill-mode 必须是 backwards:both 会让终帧 filter:blur(0) 永久挂在 section 上,
             祖先存在非 none 的 filter 时 Chromium 会让卡片的 backdrop-filter 完全失效。 */
          .auth-screen-enter { animation: auth-screen-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards; }
        `}</style>

        {/* 卡片:微透明深色卡,发丝描边 + 顶部高光 */}
        <div className="rounded-[20px] border border-white/15 bg-[rgba(10,8,20,0.82)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_64px_-32px_rgba(0,0,0,0.5)] sm:p-7">
          {/* 品牌 */}
          <div className="mb-6 flex items-center justify-center gap-2">
            <Icon icon="mingcute:quill-pen-ai-fill" className="text-[20px] text-(--color-primary)" />
            <div className="text-[16px] font-semibold tracking-tight">
              <span className="text-white">Maple</span>
              <span className="logo-code-gradient">Code</span>
            </div>
          </div>

          <div className="flex flex-col">
            <h1 className="m-0 text-center text-[16px] font-semibold tracking-tight text-white">确认这次登录</h1>
            <p className="m-0 mt-3 text-center text-[13px] leading-6 text-white/60">
              这次登录来自新的位置或浏览器。请在已登录设备的账户安全中确认后继续。
            </p>

            {/* 设备信息:与配对码同款的居中展示 */}
            <dl className="m-0 mt-6 flex flex-col gap-2.5 rounded-[12px] bg-white/[0.05] px-4 py-3.5 text-[13px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-white/50">设备</dt>
                <dd className="m-0 truncate font-medium text-white">{session.session.deviceLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-white/50">地址</dt>
                <dd className="m-0 truncate font-medium text-white">{session.session.ipAddress}</dd>
              </div>
            </dl>

            {/* 轮询提示:5 秒自动检查一次,不需要用户一直点 */}
            <p className="m-0 mt-5 flex items-center justify-center gap-2 text-[12px] text-white/55">
              <Icon icon="mingcute:loading-3-line" className="animate-spin text-[13px] text-white/35" />
              每 5 秒自动检查确认状态
            </p>

            {error ? (
              <p className="m-0 mt-4 flex items-start gap-2 rounded-[12px] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] px-3 py-2.5 text-[12px] leading-5 text-(--color-error)" role="alert">
                <Icon icon="mingcute:warning-line" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            {/* 操作:与 authorize 同款的小号右对齐按钮 */}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex h-9 shrink-0 items-center justify-center rounded-lg px-3 text-[12px] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                退出登录
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={checking}
                className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[12px] font-medium text-black transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-40"
              >
                <Icon icon={checking ? "mingcute:loading-3-line" : "mingcute:refresh-2-line"} className={checking ? "animate-spin" : ""} />
                {checking ? "检查中" : "检查状态"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
