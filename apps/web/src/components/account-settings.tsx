import { Icon } from "@iconify/react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SettingsExtraTab } from "@maple/board-ui";
import type { AuthSessionResponse, SecurityEvent, WebSessionSummary } from "@maple/protocol";
import type { DashboardApi } from "../api/client";

interface AccountSettingsProps {
  api: DashboardApi;
  session: AuthSessionResponse;
  onSession: (session: AuthSessionResponse) => void;
  onSignedOut: () => void;
}

/** 账户 / 工作区 / 安全三个设置页签,样式与内置设置页一致(行式布局、弱分隔)。 */
export function buildAccountSettingsTabs(props: AccountSettingsProps): SettingsExtraTab[] {
  const tabs: SettingsExtraTab[] = [
    { id: "account", label: "账户", icon: "mingcute:user-3-line", content: <AccountSettings {...props} /> },
    { id: "workspace", label: "工作区", icon: "mingcute:briefcase-line", content: <WorkspaceSettings {...props} /> }
  ];
  if (props.session.deploymentMode !== "standalone") {
    tabs.push({ id: "security", label: "安全", icon: "mingcute:safe-shield-line", content: <SecuritySettings {...props} /> });
  }
  return tabs;
}

/* ── 与 SettingsView 一致的基础构件 ── */

function SectionHeader({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1 mb-8 px-1">
      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
        <Icon icon={icon} className="text-sm" />
        {title}
      </h3>
      <p className="text-xs text-muted/60 leading-relaxed mt-1">{description}</p>
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 group px-1">
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="text-[14px] font-bold text-base-content/90">{label}</span>
        {description ? <span className="text-[12px] text-muted/50 leading-relaxed max-w-[300px]">{description}</span> : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

const inputClass = "ui-input h-10 w-[240px] bg-base-300/10 border-base-300/10 text-[14px]";
const quietBtnClass = "flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-base-300/20 px-4 text-[13px] font-medium text-base-content/80 transition-colors hover:bg-base-300/35 disabled:opacity-40";
const subtleTextBtnClass = "text-[12px] text-muted transition-colors hover:text-(--color-error) disabled:opacity-40";

function Message({ text }: { text: string }) {
  if (!text) return null;
  const ok = /成功|已/.test(text);
  return (
    <p className={`m-0 px-1 flex items-center gap-2 text-[12px] ${ok ? "text-(--color-success)" : "text-(--color-error)"}`}>
      <Icon icon={ok ? "mingcute:check-circle-line" : "mingcute:warning-line"} className="shrink-0" />
      {text}
    </p>
  );
}

/* ── 账户 ── */

function AccountSettings({ api, session, onSession }: AccountSettingsProps) {
  const [name, setName] = useState(session.user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <SectionHeader icon="mingcute:idcard-line" title="个人资料" description={session.deploymentMode === "standalone" ? "名称会显示在任务报告与执行记录中；头像使用本机管理员标识。" : "名称与头像会显示在任务报告与执行记录中。"} />
        <form
          onSubmit={(event) => { event.preventDefault(); void run(async () => { const next = await api.updateProfile({ name }); api.setCsrfToken(next.csrfToken); onSession(next); }, "名称已更新"); }}
          className="flex flex-col gap-6"
        >
          <Row label="名称">
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={inputClass} />
            <button type="submit" disabled={busy || name.trim() === session.user.name} className={quietBtnClass}>保存</button>
          </Row>
          {session.deploymentMode !== "standalone" ? (<>
          <Row label="头像" description="PNG / JPEG / WebP,显示在侧栏与报告署名处。">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={quietBtnClass}>
              <Icon icon="mingcute:pic-line" />
              更换头像
            </button>
          </Row>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void run(async () => { const next = await api.uploadAvatar(file); api.setCsrfToken(next.csrfToken); onSession(next); }, "头像已更新"); event.currentTarget.value = ""; }} />
          </>) : null}
          <Message text={message} />
        </form>
      </section>

      {session.deploymentMode !== "standalone" ? <section>
        <SectionHeader icon="mingcute:lock-line" title="修改密码" description="修改成功后,其他已登录设备会自动退出。" />
        <form
          onSubmit={(event: FormEvent) => { event.preventDefault(); void run(async () => { await api.changePassword({ currentPassword, newPassword }); setCurrentPassword(""); setNewPassword(""); }, "密码已更新,其他设备已退出"); }}
          className="flex flex-col gap-6"
        >
          <Row label="当前密码">
            <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className={inputClass} required />
          </Row>
          <Row label="新密码" description="至少 10 位。">
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} maxLength={200} autoComplete="new-password" className={inputClass} required />
          </Row>
          <div className="flex justify-end px-1">
            <button type="submit" disabled={busy || !currentPassword || newPassword.length < 10} className={quietBtnClass}>更新密码</button>
          </div>
        </form>
      </section> : null}
    </div>
  );
}

/* ── 工作区 ── */

function WorkspaceSettings({ api, session, onSession }: AccountSettingsProps) {
  const [rename, setRename] = useState(session.workspace.name);
  const [createdName, setCreatedName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const adopt = (next: AuthSessionResponse) => { api.setCsrfToken(next.csrfToken); onSession(next); };

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {session.deploymentMode !== "standalone" ? <section>
        <SectionHeader icon="mingcute:briefcase-line" title="当前工作区" description="不同工作区的项目、任务与执行端互相隔离。" />
        <div className="flex flex-col gap-6">
          <Row label="切换工作区">
            <select
              value={session.workspace.id}
              onChange={(event) => void run(async () => adopt(await api.switchWorkspace(event.target.value)), "工作区已切换")}
              disabled={busy}
              className={inputClass}
            >
              {session.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </Row>
          <Message text={message} />
        </div>
      </section> : null}

      <section>
        <SectionHeader icon="mingcute:edit-2-line" title="重命名" description={session.workspace.role === "owner" ? "修改当前工作区的显示名称。" : "仅工作区所有者可重命名。"} />
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await api.renameWorkspace(session.workspace.id, rename); const next = await api.session(); if (next.authenticated) adopt(next); }, "工作区已重命名"); }} className="flex flex-col gap-6">
          <Row label="名称">
            <input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={100} className={inputClass} />
            <button type="submit" disabled={busy || session.workspace.role !== "owner" || rename.trim() === session.workspace.name} className={quietBtnClass}>保存</button>
          </Row>
        </form>
      </section>

      {session.deploymentMode !== "standalone" ? <section>
        <SectionHeader icon="mingcute:add-line" title="新建工作区" description="创建后自动切换到新工作区。" />
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => { adopt(await api.createWorkspace(createdName)); setCreatedName(""); }, "工作区已创建"); }} className="flex flex-col gap-6">
          <Row label="名称">
            <input value={createdName} onChange={(event) => setCreatedName(event.target.value)} maxLength={100} placeholder="工作区名称" className={inputClass} required />
            <button type="submit" disabled={busy || !createdName.trim()} className={quietBtnClass}>
              <Icon icon="mingcute:add-line" />
              创建
            </button>
          </Row>
        </form>
      </section> : null}
    </div>
  );
}

/* ── 安全 ── */

function SecuritySettings({ api, onSignedOut }: AccountSettingsProps) {
  const [sessions, setSessions] = useState<WebSessionSummary[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [sessionResult, eventResult] = await Promise.all([api.accountSessions(), api.securityEvents()]);
    setSessions(sessionResult.sessions);
    setEvents(eventResult.events);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <SectionHeader icon="mingcute:device-line" title="登录设备" description="新位置登录需要确认后才可访问看板。" />
        <div className="flex flex-col gap-2 px-1">
          <div className="flex justify-end">
            <button type="button" onClick={() => void run(async () => { await api.revokeOtherSessions(); await reload(); }, "其他设备已退出")} disabled={busy} className={subtleTextBtnClass}>退出其他设备</button>
          </div>
          {sessions.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-[12px] bg-base-300/10 p-3 transition-colors hover:bg-base-300/15">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${item.trust === "review" ? "bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-(--color-warning)" : "bg-base-300/20 text-muted"}`}>
                <Icon icon={item.trust === "review" ? "mingcute:safe-shield-line" : "mingcute:device-line"} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[13px] font-medium">{item.deviceLabel}{item.current ? "(当前)" : ""}</p>
                <p className="m-0 text-[12px] text-muted/70">{item.ipAddress} · {new Date(item.lastSeenAt).toLocaleString()}</p>
              </div>
              {item.trust === "review" ? (
                <button type="button" onClick={() => void run(async () => { await api.approveSession(item.id); await reload(); }, "登录已确认")} disabled={busy} className="flex h-8 items-center rounded-[8px] bg-base-300/25 px-3 text-[12px] font-medium transition-colors hover:bg-base-300/40">确认</button>
              ) : null}
              <button type="button" onClick={() => void run(async () => { await api.revokeSession(item.id); if (item.current) onSignedOut(); else await reload(); }, "设备已移除")} disabled={busy} className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-(--color-error)/10 hover:text-(--color-error)" title="移除设备" aria-label="移除设备">
                <Icon icon="mingcute:delete-2-line" />
              </button>
            </div>
          ))}
          <Message text={message} />
        </div>
      </section>

      <section>
        <SectionHeader icon="mingcute:time-line" title="安全记录" description="最近的登录与账户变更事件。" />
        <div className="flex flex-col gap-1 px-1">
          {events.slice(0, 20).map((event) => (
            <div key={event.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)]">
              <Icon
                icon={event.severity === "critical" ? "mingcute:alert-octagon-line" : event.severity === "warning" ? "mingcute:warning-line" : "mingcute:check-circle-line"}
                className={`shrink-0 ${event.severity === "critical" ? "text-(--color-error)" : event.severity === "warning" ? "text-(--color-warning)" : "text-muted/60"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px]">{eventLabel(event.type)}</p>
                <p className="m-0 text-[12px] text-muted/70">{event.deviceLabel || event.ipAddress || "Server"} · {new Date(event.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = { "session.created": "登录成功", "session.review_required": "新位置登录待确认", "session.approved": "登录设备已确认", "session.revoked": "登录设备已移除", "login.failed": "登录失败", "account.password_changed": "密码已修改", "runner.authorization_approved": "CLI 已授权" };
  return labels[type] || type;
}
