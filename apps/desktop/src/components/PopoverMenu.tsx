import { Icon } from "@iconify/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type PopoverMenuItem =
  | {
      kind: "heading";
      label: string;
    }
  | ({
      kind: "item";
      key: string;
      label: string;
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    } & ({ icon: string; iconNode?: never } | { icon?: never; iconNode: ReactNode }));

type PopoverMenuProps = {
  label: string;
  icon?: string;
  triggerText?: string;
  triggerNode?: ReactNode;
  items: PopoverMenuItem[];
  align?: "left" | "right";
  style?: React.CSSProperties;
};

export function PopoverMenu({ label, icon, triggerText, triggerNode, items, align = "right", style }: PopoverMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      if (event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="popover" style={style}>
      {triggerNode ? (
        <div 
          role="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((previous) => !previous)}
          className="cursor-pointer"
        >
          {triggerNode}
        </div>
      ) : (
        <button
          type="button"
          className={`ui-btn ui-btn--sm ui-btn--outline ${triggerText ? "gap-2 px-3" : "ui-icon-btn"} ${open ? "popover-trigger active" : "popover-trigger"}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((previous) => !previous)}
        >
          {icon ? <Icon icon={icon} className="text-base" /> : null}
          {triggerText ? (
            <>
              <span className="text-[12px] font-sans">{triggerText}</span>
              <Icon icon="mingcute:down-line" className="text-[14px] opacity-60" />
            </>
          ) : label ? (
            <span className="sr-only">{label}</span>
          ) : null}
        </button>
      )}

      {open ? (
        <div id={menuId} role="menu" className={align === "right" ? "popover-menu right" : "popover-menu left"}>
          {items.map((item, index) => {
            if (item.kind === "heading") {
              return (
                <div key={`heading-${index}`} className="px-3 py-1.5 mt-1 text-muted text-[10.5px] font-semibold uppercase tracking-wider opacity-60" role="presentation">
                  {item.label}
                </div>
              );
            }

            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="popover-item ui-btn ui-btn--sm ui-btn--ghost justify-start gap-2.5 w-full border border-transparent rounded-[8px] font-medium text-[13px] px-3 transition-colors"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="w-4 inline-flex justify-center text-[16px] opacity-70 shrink-0" aria-hidden="true">
                  {"iconNode" in item ? item.iconNode : (item.icon ? <Icon icon={item.icon} /> : null)}
                </span>
                <span className="flex-1 truncate text-left">{item.label}</span>
                <span className="ml-auto w-4 inline-flex justify-end text-(--worker-color,var(--color-primary)) text-[14px]" aria-hidden="true">
                  {item.checked ? <Icon icon="mingcute:check-line" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
