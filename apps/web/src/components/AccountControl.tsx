import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import type { AuthSessionResponse } from "@maple/protocol";
import type { DashboardApi } from "../api/client";

export function AccountControl({
  api,
  session,
  onSession,
  onSignedOut,
  onOpenSettings
}: {
  api: DashboardApi;
  session: AuthSessionResponse;
  onSession: (session: AuthSessionResponse) => void;
  onSignedOut: () => void;
  onOpenSettings: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState({ left: 0, bottom: 0 });

  // 浮窗:点击外部 / ESC 关闭
  useEffect(() => {
    if (!popoverOpen) return;
    function onPointerDown(event: MouseEvent) {
      const node = event.target as Node;
      if (popoverRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      setPopoverOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  function togglePopover() {
    if (!popoverOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPos({ left: rect.left, bottom: window.innerHeight - rect.top + 12 });
    }
    setPopoverOpen((value) => !value);
  }

  async function switchWorkspace(workspaceId: string) {
    if (switching || workspaceId === session.workspace.id) {
      setPopoverOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const next = await api.switchWorkspace(workspaceId);
      api.setCsrfToken(next.csrfToken);
      onSession(next);
      setPopoverOpen(false);
    } catch {
      // 切换失败保持现状,浮窗留着让用户重试。
    } finally {
      setSwitching(false);
    }
  }

  async function signOut() {
    try { await api.logout(); } finally { onSignedOut(); }
  }

  const initials = session.user.name.slice(0, 1).toUpperCase();
  const standalone = session.deploymentMode === "standalone";
  const avatar = (size: string, iconClass: string) =>
    session.user.avatarUrl
      ? <img src={session.user.avatarUrl} alt="" className={`${size} shrink-0 object-cover`} />
      : standalone
        // Maple Local 以管理员图标作为本机身份标识，不再使用首字母占位。
        ? <span className={`${size} flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] text-(--color-primary)`}><Icon icon="mingcute:key-2-line" className={iconClass} /></span>
        : <span className={`${size} flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] font-semibold text-(--color-primary)`}>{initials}</span>;

  return (
    <>
      {/* 触发器:头像 + 工作区名 */}
      <button
        ref={triggerRef}
        type="button"
        onClick={togglePopover}
        className="group mt-1 flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--color-base-content)_5%,transparent)]"
      >
        {avatar("size-7 rounded-[9px]", "text-[18px]")}
        {/* 工作区名：小号字 + 紧行高 + 任意断行，两行填满不挂孤儿字；完整名见浮窗 */}
        <span className="min-w-0 flex-1 break-all text-[12px] font-medium leading-[1.3] text-(--color-base-content) line-clamp-2">{session.workspace.name}</span>
      </button>

      {/* Notion 风浮窗:设置 / 工作区切换 / 退出登录 */}
      {popoverOpen ? (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="账户菜单"
          className="account-popover fixed z-[130] w-[264px] overflow-hidden rounded-[16px] border border-[color-mix(in_srgb,var(--color-base-300)_55%,transparent)] bg-(--color-base-100) shadow-[0_12px_32px_-8px_color-mix(in_srgb,var(--color-base-content)_3%,transparent)]"
          style={{ left: popoverPos.left, bottom: popoverPos.bottom }}
        >
          <style>{`
            @keyframes account-popover-enter {
              from { opacity: 0; transform: translateY(6px) scale(0.98); }
              to { opacity: 1; transform: none; }
            }
            .account-popover { animation: account-popover-enter 0.18s cubic-bezier(0.22, 1, 0.36, 1) both; transform-origin: bottom left; }
          `}</style>

          {/* 头部:当前身份 */}
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            {avatar("size-10 rounded-[12px]", "text-[26px]")}
            <div className="min-w-0">
              <p className="m-0 break-words text-[14px] font-semibold leading-snug line-clamp-2">{session.workspace.name}</p>
              {!standalone ? <p className="m-0 truncate text-[12px] text-muted">{session.user.email}</p> : null}
            </div>
          </div>

          <div className="px-2 pb-2 pt-1">
            <PopoverItem
              icon="mingcute:settings-3-line"
              label="设置"
              onClick={() => { setPopoverOpen(false); onOpenSettings(); }}
            />
          </div>

          {!standalone ? (
            <>
              <div className="mx-3 my-1 border-t border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)]" />

              {/* 工作区切换 */}
              <div className="px-4 pb-1 pt-1.5 text-[12px] text-muted/60">{session.user.email}</div>
              <div className="max-h-[180px] overflow-y-auto px-2 pb-1">
                {session.workspaces.map((workspace) => {
                  const current = workspace.id === session.workspace.id;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      role="menuitem"
                      disabled={switching}
                      onClick={() => void switchWorkspace(workspace.id)}
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--color-base-content)_5%,transparent)] disabled:opacity-50"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[11px] font-semibold text-(--color-primary)">
                        {workspace.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      {current ? <Icon icon="mingcute:check-line" className="shrink-0 text-[15px] text-(--color-base-content)" /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="mx-3 my-1 border-t border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)]" />

              <div className="px-2 pb-2 pt-0.5">
                <PopoverItem icon="mingcute:exit-line" label="退出登录" onClick={() => void signOut()} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function PopoverItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--color-base-content)_5%,transparent)]"
    >
      <Icon icon={icon} className="text-[15px] text-muted" />
      <span>{label}</span>
    </button>
  );
}
