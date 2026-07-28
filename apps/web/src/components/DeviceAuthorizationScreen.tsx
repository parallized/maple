import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import type { AuthSessionResponse, DeviceAuthorizationReview } from "@maple/protocol";
import type { DashboardApi } from "../api/client";
import { LightPillar } from "./LightPillar";

export function DeviceAuthorizationScreen({
  api,
  session,
  userCode,
  onDone
}: {
  api: DashboardApi;
  session: AuthSessionResponse;
  userCode: string;
  onDone: () => void;
}) {
  const [review, setReview] = useState<DeviceAuthorizationReview | null>(null);
  const [runnerName, setRunnerName] = useState("");
  const [approvedName, setApprovedName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    api.deviceAuthorization(userCode).then((result) => {
      setReview(result);
      setRunnerName(result.runnerName);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [api, userCode]);

  async function approve() {
    setSubmitting(true);
    setError("");
    try {
      const result = await api.approveDevice(userCode, runnerName.trim() || undefined);
      setApprovedName(result.runnerName);
      setApproved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0b10] px-5 py-10 text-(--color-base-content)">
      {/* 背景:Light Pillar 光柱,黑白灰紫配色,参数对齐 reactbits 默认,整体亮度压暗 */}
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

        {/* 卡片:微透明深色卡(无模糊),发丝描边 + 顶部高光 */}
        <div className="rounded-[20px] border border-white/15 bg-[rgba(10,8,20,0.82)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_64px_-32px_rgba(0,0,0,0.5)] sm:p-7">
          {/* 品牌:Maple logo + 文字标志,收进卡片顶部 */}
          <div className="mb-6 flex items-center justify-center gap-2">
            <Icon icon="mingcute:quill-pen-ai-fill" className="text-[20px] text-(--color-primary)" />
            <div className="text-[16px] font-semibold tracking-tight">
              <span className="text-white">Maple</span>
              <span className="logo-code-gradient">Code</span>
            </div>
          </div>
          {approved ? (
            <div className="flex flex-col items-center py-2 text-center">
              <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]">
                <Icon icon="mingcute:check-line" className="text-[24px] text-(--color-success)" />
              </div>
              <h1 className="text-[17px] font-semibold tracking-tight text-white">Runner 已接入</h1>
              <p className="mt-2 text-[13px] leading-6 text-white/60">
                主机「{approvedName}」已作为 Runner 提供给工作区「{session.workspace.name}」，可以关闭此页面并返回终端。
              </p>
              <button
                type="button"
                onClick={onDone}
                className="mt-6 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white text-[12px] font-medium text-black transition-opacity hover:opacity-85"
              >
                <Icon icon="mingcute:layout-grid-line" />
                进入看板
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* 标题:单纯的主机接入,不搞 OAuth 那套话术 */}
              <h1 className="m-0 text-center text-[16px] font-semibold tracking-tight text-white">
                正在接入<span className="font-bold text-white">「{session.workspace.name}」</span>
              </h1>

              {/* 配对码:整行展示,与终端核对 */}
              <p className="m-0 mt-6 text-center font-mono text-[22px] font-semibold tracking-[0.28em] text-white">
                {userCode}
              </p>
              <p className="m-0 mt-2 text-center text-[11px] text-white/60">请与终端中显示的配对码核对一致</p>

              {/* 主机名称:label 左 / 输入框右,单行 */}
              <label className="mt-6 flex items-center gap-4">
                <span className="shrink-0 text-[13px] text-white/60">主机名称</span>
                <input
                  value={runnerName}
                  onChange={(event) => setRunnerName(event.target.value)}
                  maxLength={80}
                  disabled={!review || submitting}
                  aria-label="主机名称"
                  placeholder={review ? "命名这台主机" : "加载中"}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-[14px] font-medium text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/30 disabled:opacity-50"
                />
              </label>

              {/* 安全提示:保留唯一一行 */}
              <p className="m-0 mt-5 flex items-start gap-2 px-1 text-[12px] leading-5 text-white/55">
                <Icon icon="mingcute:safe-shield-line" className="mt-[3px] shrink-0 text-[13px] text-white/35" />
                授权后，工作区成员可向这台主机派发并执行任务
              </p>

              {error ? (
                <p className="m-0 mt-4 flex items-start gap-2 rounded-[12px] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] px-3 py-2.5 text-[12px] leading-5 text-(--color-error)" role="alert">
                  <Icon icon="mingcute:warning-line" className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              ) : null}

              {/* 操作:小号按钮,右对齐(页面固定深色,不跟随主题变量) */}
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onDone}
                  className="flex h-9 shrink-0 items-center justify-center rounded-lg px-3 text-[12px] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={!review || submitting || !runnerName.trim()}
                  className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[12px] font-medium text-black transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-40"
                >
                  <Icon icon={submitting ? "mingcute:loading-3-line" : "mingcute:check-line"} className={submitting ? "animate-spin" : ""} />
                  {submitting ? "接入中" : "确认接入"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
