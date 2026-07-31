import { Icon } from "@iconify/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DeepSeekConnectionStatus } from "../domain";
import type { UiLanguage } from "../lib/constants";
import { WorkerLogo } from "./WorkerLogo";

type DeepSeekConnectionDialogProps = {
  open: boolean;
  status: DeepSeekConnectionStatus | null;
  statusLoading: boolean;
  statusError: string;
  uiLanguage: UiLanguage;
  onClose: () => void;
  onReload: () => Promise<void>;
  onConnect: (apiKey: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

export function DeepSeekConnectionDialog({
  open,
  status,
  statusLoading,
  statusError,
  uiLanguage,
  onClose,
  onReload,
  onConnect,
  onDisconnect,
}: DeepSeekConnectionDialogProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const inputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState("");

  const environmentManaged = status?.source === "environment";
  const canEdit = status?.supported === true && !environmentManaged;

  useEffect(() => {
    if (!open) {
      setApiKey("");
      setRevealed(false);
      setActionError("");
      return;
    }
    setApiKey("");
    setRevealed(false);
    setActionError("");
    if (!status && !statusLoading) void onReload();
  }, [open]);

  useEffect(() => {
    if (!open || !canEdit || statusLoading) return;
    inputRef.current?.focus();
  }, [open, canEdit, statusLoading]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting && !disconnecting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, submitting, disconnecting, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = apiKey.trim();
    if (!value || submitting || !canEdit) return;
    setActionError("");
    setSubmitting(true);
    try {
      await onConnect(value);
      setApiKey("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("连接失败，请稍后重试。", "Connection failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting || !status?.configured || environmentManaged) return;
    setActionError("");
    setDisconnecting(true);
    try {
      await onDisconnect();
      setApiKey("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("断开失败，请稍后重试。", "Could not disconnect. Please try again."));
    } finally {
      setDisconnecting(false);
    }
  }

  const busy = submitting || disconnecting;
  const error = actionError || statusError;

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="DeepSeek Flash">
      <div className="ui-modal-backdrop" onClick={() => { if (!busy) onClose(); }} />
      <div className="ui-modal-panel" style={{ maxWidth: 480 }}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-primary/15 bg-primary/5 text-primary">
              <WorkerLogo kind="deepseek" size={20} />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="m-0 text-[15px] font-semibold text-base-content">DeepSeek Flash</h3>
              <p className="m-0 max-w-[350px] text-[12px] leading-relaxed text-muted/60">
                {t(
                  "通过 Codex 运行。API Key 只保存在当前 Windows 用户的凭据管理器中。",
                  "Runs through Codex. Your API key is stored only in Windows Credential Manager for this user."
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn flex-none"
            onClick={onClose}
            disabled={busy}
            aria-label={t("关闭", "Close")}
          >
            <Icon icon="mingcute:close-line" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
          {statusLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-base-300/20 px-3 py-3 text-[12px] text-muted/65">
              <Icon icon="mingcute:loading-3-line" className="animate-spin text-[15px]" />
              {t("正在检查连接状态…", "Checking connection…")}
            </div>
          ) : status?.supported === false ? (
            <div className="flex items-start gap-2 rounded-xl border border-base-300/20 bg-base-300/5 px-3 py-3 text-[12px] leading-relaxed text-muted/70">
              <Icon icon="mingcute:information-line" className="mt-0.5 flex-none text-[15px]" />
              <span>{status.message || t("请在 Maple Local 中连接 DeepSeek。", "Connect DeepSeek from Maple Local.")}</span>
            </div>
          ) : environmentManaged ? (
            <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-3 text-[12px] leading-relaxed text-base-content/75">
              <Icon icon="mingcute:shield-line" className="mt-0.5 flex-none text-[15px] text-primary" />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">{t("由 Runner 环境管理", "Managed by the Runner environment")}</span>
                <span className="text-muted/60">{t("如需更换，请在 Runner 环境中更新 DEEPSEEK_API_KEY。", "Update DEEPSEEK_API_KEY in the Runner environment to replace it.")}</span>
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {status?.configured ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-2.5 text-[12px] text-base-content/75">
                  <Icon icon="mingcute:check-circle-line" className="text-[15px] text-emerald-500" />
                  <span>{t("已连接于此设备", "Connected on this device")}</span>
                </div>
              ) : null}

              <label className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-base-content/80">
                  {status?.configured ? t("更换 API Key", "Replace API key") : "API Key"}
                </span>
                <span className="relative flex items-center">
                  <input
                    ref={inputRef}
                    type={revealed ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    className="w-full rounded-xl border border-base-300/25 bg-base-100 px-3 py-2.5 pr-10 font-mono text-[13px] text-base-content outline-none transition-colors placeholder:text-muted/30 focus:border-primary/35"
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="absolute right-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted/55 transition-colors hover:bg-base-300/15 hover:text-base-content"
                    onClick={() => setRevealed((value) => !value)}
                    disabled={busy}
                    aria-label={revealed ? t("隐藏 API Key", "Hide API key") : t("显示 API Key", "Show API key")}
                  >
                    <Icon icon={revealed ? "mingcute:eye-close-line" : "mingcute:eye-2-line"} className="text-[16px]" />
                  </button>
                </span>
              </label>

              <div className="flex items-center justify-between gap-3">
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted/60 transition-colors hover:text-primary"
                >
                  {t("获取 DeepSeek API Key", "Get a DeepSeek API key")}
                  <Icon icon="mingcute:external-link-line" className="text-[12px]" />
                </a>
                <button
                  type="submit"
                  className="ui-btn ui-btn--sm ui-btn--primary gap-1.5"
                  disabled={!apiKey.trim() || busy}
                >
                  {submitting ? <Icon icon="mingcute:loading-3-line" className="animate-spin" /> : <Icon icon="mingcute:link-2-line" />}
                  {t("连接并验证", "Connect and verify")}
                </button>
              </div>
            </form>
          )}

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-red-500/85" role="alert">
              <Icon icon="mingcute:warning-line" className="mt-0.5 flex-none text-[14px]" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-base-300/15 pt-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted/45">
              <Icon icon="mingcute:shield-line" className="text-[12px]" />
              {t("Maple 不会回显或写入项目数据库", "Maple never echoes or stores the key in the project database")}
            </span>
            {status?.configured && !environmentManaged ? (
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost text-red-500/75 hover:text-red-500"
                onClick={() => void handleDisconnect()}
                disabled={busy}
              >
                {disconnecting ? t("正在断开…", "Disconnecting…") : t("断开连接", "Disconnect")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
