import type { ComponentProps, Components } from "@blocknote/react";

/**
 * Maple 定制的 BlockNote 组件上下文。
 *
 * @blocknote/react 0.46.x 只导出了 ComponentsContext，却从不提供默认值：
 * 内置斜杠菜单渲染时会先 useComponentsContext() 再读 .SuggestionMenu，
 * 导致 "Cannot read properties of undefined (reading 'SuggestionMenu')"。
 * 这里按应用的设计语言（Notion 风格 + 主题 CSS 变量）补齐这些组件，
 * 让斜杠菜单、文件面板等默认 UI 真正可用。
 *
 * 其余默认 UI（格式化工具条、链接工具条、侧边菜单、表格手柄、评论等）
 * 已在 TaskDetailsEditor 中通过 props 显式关闭，不会渲染，因此无需实现，
 * 类型上仅做一次显式断言补全。
 */

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Suggestion menu（斜杠菜单） ─────────────────────────────── */

function SuggestionMenuRoot({
  id,
  className,
  children,
}: ComponentProps["SuggestionMenu"]["Root"]) {
  return (
    <div
      id={id}
      className={cn(
        className,
        "min-w-[220px] max-w-[300px] overflow-y-auto rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_65%,transparent)] bg-[color-mix(in_srgb,var(--color-base-100)_94%,transparent)] p-1.5 shadow-[0_2px_2px_color-mix(in_srgb,var(--color-primary)_10%,transparent)] backdrop-blur-xl"
      )}
    >
      {children}
    </div>
  );
}

function SuggestionMenuItem({
  className,
  id,
  isSelected,
  onClick,
  item,
}: ComponentProps["SuggestionMenu"]["Item"]) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={cn(
        className,
        "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[7px] text-left transition-colors duration-100",
        isSelected
          ? "bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)]"
          : "hover:bg-[color:var(--btn-hover)]"
      )}
    >
      {item.icon ? (
        <span className="shrink-0 text-[16px] leading-none text-[color:var(--color-secondary)]">
          {item.icon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] text-[color:var(--color-base-content)]",
          isSelected && "font-medium"
        )}
      >
        {item.title}
      </span>
      {item.subtext ? (
        <span className="shrink-0 truncate text-[11px] text-[color:var(--color-secondary)]">
          {item.subtext}
        </span>
      ) : null}
      {item.badge ? (
        <span className="shrink-0 rounded-[6px] border border-[color-mix(in_srgb,var(--color-base-300)_70%,transparent)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-secondary)]">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

function SuggestionMenuLabel({
  className,
  children,
}: ComponentProps["SuggestionMenu"]["Label"]) {
  return (
    <div
      className={cn(
        className,
        "px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-secondary)]"
      )}
    >
      {children}
    </div>
  );
}

function SuggestionMenuEmptyItem({
  className,
  children,
}: ComponentProps["SuggestionMenu"]["EmptyItem"]) {
  return (
    <div
      className={cn(
        className,
        "px-2 py-2 text-[12px] text-[color:var(--color-secondary)]"
      )}
    >
      {children}
    </div>
  );
}

function SuggestionMenuLoader({ className }: ComponentProps["SuggestionMenu"]["Loader"]) {
  return (
    <div
      className={cn(
        className,
        "flex items-center gap-2 px-2 py-2 text-[12px] text-[color:var(--color-secondary)]"
      )}
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] border-t-[color:var(--color-primary)]" />
      <span>加载中…</span>
    </div>
  );
}

/* ── Grid suggestion menu（emoji 选择器，当前未启用） ─────────── */

function GridSuggestionMenuRoot({
  id,
  className,
  columns,
  children,
}: ComponentProps["GridSuggestionMenu"]["Root"]) {
  return (
    <div
      id={id}
      className={cn(
        className,
        "rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_65%,transparent)] bg-[color-mix(in_srgb,var(--color-base-100)_94%,transparent)] p-1.5 shadow-[0_2px_2px_color-mix(in_srgb,var(--color-primary)_10%,transparent)] backdrop-blur-xl"
      )}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 2,
      }}
    >
      {children}
    </div>
  );
}

function GridSuggestionMenuItem({
  className,
  id,
  isSelected,
  onClick,
  item,
}: ComponentProps["GridSuggestionMenu"]["Item"]) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={cn(
        className,
        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] text-[18px] leading-none transition-colors",
        isSelected
          ? "bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)]"
          : "hover:bg-[color:var(--btn-hover)]"
      )}
    >
      {item.icon}
    </button>
  );
}

function GridSuggestionMenuEmptyItem({
  className,
  columns,
  children,
}: ComponentProps["GridSuggestionMenu"]["EmptyItem"]) {
  return (
    <div
      className={cn(
        className,
        "col-span-full px-2 py-2 text-[12px] text-[color:var(--color-secondary)]"
      )}
      style={{ gridColumn: `span ${columns} / span ${columns}` }}
    >
      {children}
    </div>
  );
}

function GridSuggestionMenuLoader({
  className,
  columns,
}: ComponentProps["GridSuggestionMenu"]["Loader"]) {
  return (
    <div
      className={cn(
        className,
        "flex items-center gap-2 px-2 py-2 text-[12px] text-[color:var(--color-secondary)]"
      )}
      style={{ gridColumn: `span ${columns} / span ${columns}` }}
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] border-t-[color:var(--color-primary)]" />
      <span>加载中…</span>
    </div>
  );
}

/* ── File panel（文件面板） ─────────────────────────────────── */

function FilePanelRoot({
  className,
  tabs,
  openTab,
  setOpenTab,
  loading,
}: ComponentProps["FilePanel"]["Root"]) {
  const activeTab = tabs.find((tab) => tab.name === openTab) ?? tabs[0];
  return (
    <div
      className={cn(
        className,
        "w-[280px] overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_65%,transparent)] bg-[color-mix(in_srgb,var(--color-base-100)_94%,transparent)] p-2 shadow-[0_2px_2px_color-mix(in_srgb,var(--color-primary)_10%,transparent)] backdrop-blur-xl"
      )}
    >
      <div className="mb-2 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.name}
            type="button"
            onClick={() => setOpenTab(tab.name)}
            className={cn(
              "cursor-pointer rounded-[8px] px-2.5 py-1 text-[12px] transition-colors",
              tab.name === openTab
                ? "bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] font-medium text-[color:var(--color-base-content)]"
                : "text-[color:var(--color-secondary)] hover:bg-[color:var(--btn-hover)]"
            )}
          >
            {tab.name}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="px-2 py-1 text-[12px] text-[color:var(--color-secondary)]">
          上传中…
        </div>
      ) : (
        activeTab?.tabPanel
      )}
    </div>
  );
}

function FilePanelButton({
  className,
  onClick,
  children,
  label,
}: ComponentProps["FilePanel"]["Button"]) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "cursor-pointer rounded-[8px] bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_22%,transparent)]"
      )}
    >
      {children ?? label}
    </button>
  );
}

function FilePanelFileInput({
  className,
  accept,
  placeholder,
  onChange,
}: ComponentProps["FilePanel"]["FileInput"]) {
  return (
    <label
      className={cn(
        className,
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[color-mix(in_srgb,var(--color-base-300)_75%,transparent)] px-3 py-7 text-center transition-colors hover:border-[color-mix(in_srgb,var(--color-primary)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]"
      )}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onChange(event.currentTarget.files?.[0] ?? null)}
      />
      <span className="text-[12px] text-[color:var(--color-secondary)]">
        {placeholder}
      </span>
    </label>
  );
}

function FilePanelTabPanel({
  className,
  children,
}: ComponentProps["FilePanel"]["TabPanel"]) {
  return <div className={cn(className, "flex flex-col gap-2")}>{children}</div>;
}

function FilePanelTextInput({
  className,
  placeholder,
  value,
  onChange,
  onKeyDown,
}: ComponentProps["FilePanel"]["TextInput"]) {
  return (
    <div className="relative">
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className={cn(
          className,
          "w-full rounded-[8px] border border-[color-mix(in_srgb,var(--color-base-300)_70%,transparent)] bg-transparent px-2.5 py-1.5 text-[13px] text-[color:var(--color-base-content)] outline-none transition-colors placeholder:text-[color:var(--color-secondary)] focus:border-[color-mix(in_srgb,var(--color-primary)_55%,transparent)]"
        )}
      />
    </div>
  );
}

/**
 * 提供给 ComponentsContext 的组件集合。其余默认 UI 组件在
 * TaskDetailsEditor 中已通过 props 关闭，不会渲染，无需实现。
 */
export const mapleBlockNoteComponents = {
  SuggestionMenu: {
    Root: SuggestionMenuRoot,
    Item: SuggestionMenuItem,
    Label: SuggestionMenuLabel,
    EmptyItem: SuggestionMenuEmptyItem,
    Loader: SuggestionMenuLoader,
  },
  GridSuggestionMenu: {
    Root: GridSuggestionMenuRoot,
    Item: GridSuggestionMenuItem,
    EmptyItem: GridSuggestionMenuEmptyItem,
    Loader: GridSuggestionMenuLoader,
  },
  FilePanel: {
    Root: FilePanelRoot,
    Button: FilePanelButton,
    FileInput: FilePanelFileInput,
    TabPanel: FilePanelTabPanel,
    TextInput: FilePanelTextInput,
  },
} as unknown as Components;
