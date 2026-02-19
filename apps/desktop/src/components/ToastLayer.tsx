import { Icon } from "@iconify/react";

type ToastLayerProps = {
  permissionPrompt: { workerId: string; question: string } | null;
  notice: string;
  onAnswerPermission: (workerId: string, answer: string) => void;
  onDismissPermission: () => void;
};

export function ToastLayer({ permissionPrompt, notice, onAnswerPermission, onDismissPermission }: ToastLayerProps) {
  if (permissionPrompt) {
    return (
      <div className="toast-container" role="alert">
        <div className="toast toast--permission">
          <Icon icon="mingcute:shield-line" className="text-base" />
          <span className="flex-1 text-left">{permissionPrompt.question}</span>
          <button
            type="button"
            className="ui-btn ui-btn--xs ui-btn--outline gap-1 toast-permission-btn"
            onClick={() => onAnswerPermission(permissionPrompt.workerId, "y")}
          >
            允许
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--xs ui-btn--ghost gap-1"
            onClick={() => onAnswerPermission(permissionPrompt.workerId, "n")}
          >
            拒绝
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
            onClick={onDismissPermission}
            aria-label="忽略"
          >
            <Icon icon="mingcute:close-line" />
          </button>
        </div>
      </div>
    );
  }

  if (notice) {
    return (
      <div className="toast-container" role="alert">
        <div className="toast">
          <Icon icon="mingcute:information-line" />
          <span>{notice}</span>
        </div>
      </div>
    );
  }

  return null;
}
