import { Icon } from "@iconify/react";
import { useEffect, useId, useRef, useState } from "react";

export type PopoverMenuItem =
  | {
      kind: "heading";
      label: string;
    }
  | {
      kind: "item";
      key: string;
      label: string;
      icon: string;
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

type PopoverMenuProps = {
  label: string;
  icon: string;
  items: PopoverMenuItem[];
  align?: "left" | "right";
};

export function PopoverMenu({ label, icon, items, align = "right" }: PopoverMenuProps) {
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
    <div ref={rootRef} className="popover">
      <button
        type="button"
        className={`ui-btn ui-btn--sm ui-btn--outline ui-icon-btn ${open ? "popover-trigger active" : "popover-trigger"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon icon={icon} className="text-base" />
        {label ? <span className="sr-only">{label}</span> : null}
      </button>

      {open ? (
        <div id={menuId} role="menu" className={align === "right" ? "popover-menu right" : "popover-menu left"}>
          {items.map((item, index) => {
            if (item.kind === "heading") {
              return (
                <div key={`heading-${index}`} className="px-2 py-1.5 mt-1 text-muted text-xs font-medium uppercase tracking-wider" role="presentation">
                  {item.label}
                </div>
              );
            }

            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="popover-item ui-btn ui-btn--sm ui-btn--ghost justify-start gap-2 w-full border border-transparent rounded-[8px] font-medium"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="w-5 inline-flex justify-center" aria-hidden="true">
                  <Icon icon={item.icon} />
                </span>
                <span>{item.label}</span>
                <span className="ml-auto w-5 inline-flex justify-end text-(--color-primary)" aria-hidden="true">
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
