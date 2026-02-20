import { Icon } from "@iconify/react";
import type { WorkerKind } from "../domain";
import { WORKER_KINDS } from "../lib/constants";
import { WorkerLogo } from "./WorkerLogo";

type WorkerPickerModalProps = {
  onSelect: (kind: WorkerKind) => void;
  onClose: () => void;
};

export function WorkerPickerModal({ onSelect, onClose }: WorkerPickerModalProps) {
  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="选择 Worker">
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel">
        <div className="ui-modal-body">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold m-0">选择 Worker</h3>
              <p className="text-muted text-sm mt-1">绑定后会执行当前项目的待办任务。</p>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <Icon icon="mingcute:close-line" />
            </button>
          </div>

          <div className="flex gap-2 flex-wrap mt-4">
            {WORKER_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                className="ui-btn ui-btn--sm ui-btn--outline gap-1"
                onClick={() => onSelect(kind)}
              >
                <WorkerLogo kind={kind} size={18} />
                {label}
              </button>
            ))}
          </div>

          <div className="flex justify-end mt-4">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
