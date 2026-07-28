import { Icon } from "@iconify/react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { AuthSessionResponse } from "@maple/protocol";
import type { DashboardApi } from "../api/client";
import { LightPillar } from "./LightPillar";

interface ConnectionScreenProps {
  api: DashboardApi;
  onAuthenticated: (session: AuthSessionResponse) => void;
}

export function ConnectionScreen({ api, onAuthenticated }: ConnectionScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const session = mode === "login"
        ? await api.login({ email: email.trim(), password })
        : await api.register({ email: email.trim(), password, name: name.trim() });
      api.setCsrfToken(session.csrfToken);
      onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0b10] px-5 py-10 text-(--color-base-content)">
      {/* 背景:Light Pillar 光柱,与授权页一致的黑白灰紫配色 */}
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

          {/* 模式切换:深色分段控件 */}
          <div className="mb-6 flex rounded-xl bg-white/[0.06] p-1" role="tablist">
            {([
              { id: "login", label: "登录", icon: "mingcute:entrance-line" },
              { id: "register", label: "注册", icon: "mingcute:user-add-2-line" }
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                onClick={() => { setMode(item.id); setError(""); }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${
                  mode === item.id
                    ? "bg-white text-black"
                    : "text-white/50 hover:text-white"
                }`}
              >
                <Icon icon={item.icon} className="text-base" />
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "register" ? (
              <Field icon="mingcute:user-3-line" label="名称">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] font-medium text-white outline-none placeholder:text-white/30"
                  placeholder="怎么称呼你"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </Field>
            ) : null}
            <Field icon="mingcute:mail-line" label="邮箱">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] font-medium text-white outline-none placeholder:text-white/30"
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
            </Field>
            <Field icon="mingcute:lock-line" label="密码">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] font-medium text-white outline-none placeholder:text-white/30"
                placeholder={mode === "register" ? "至少 10 位" : "输入密码"}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "register" ? 10 : 1}
                maxLength={200}
                required
              />
            </Field>

            {error ? (
              <p className="flex items-start gap-2 rounded-[12px] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] px-3 py-2.5 text-[12px] leading-5 text-(--color-error)" role="alert">
                <Icon icon="mingcute:warning-line" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[14px] font-medium text-black transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-40"
            >
              <Icon icon={submitting ? "mingcute:loading-3-line" : "mingcute:arrow-right-line"} className={submitting ? "animate-spin" : ""} />
              {submitting ? "请稍候" : mode === "login" ? "登录" : "创建账户"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-white/35">
          自托管部署 · 数据保存在你的服务器上
        </p>
      </section>
    </main>
  );
}

function Field({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
      <span className="text-white/60">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 transition-colors focus-within:border-white/30">
        <Icon icon={icon} className="shrink-0 text-base text-white/40" />
        {children}
      </span>
    </label>
  );
}
