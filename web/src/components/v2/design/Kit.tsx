"use client";

/**
 * mioX design kit: the shared page vocabulary for conversation views and settings sections.
 *
 * Every inner page composes the same few pieces so the product reads as one surface:
 *   <Page> → <PageHead> → <Section> → <Card> → <Row> / <Facts> / <Metrics>, plus
 *   <FilterBar> for mutually exclusive or toggled filters (quiet text filters, no chip groups),
 *   <Dot> / <Badge> for state, <Empty> / <Notice> / <Skeleton> for non-content states.
 *
 * Styling lives in Kit.module.css and uses the DSH token set only.
 */
import * as React from "react";

import { Menu, MenuItemButton } from "@/vendor/dsh/primitives/Menu";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconEllipsisOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./Kit.module.css";

/** Semantic tone shared by Dot, Badge and Notice. */
export type KitTone = "neutral" | "success" | "warning" | "danger" | "info" | "done";

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/* ---------------- Page ---------------- */

export interface PageProps {
  children: React.ReactNode;
  /** `reading` (default) centres a 920px column; `wide` uses the full width; `fill` gives a canvas the full height. */
  width?: "reading" | "wide" | "fill";
  /** Tighter vertical rhythm for dense pages. */
  dense?: boolean;
  className?: string;
  /** Extra data attributes for verification hooks, e.g. `{ "data-view": "intents" }`. */
  data?: Record<`data-${string}`, string>;
}

/**
 * Scrolling page column.
 * @param props.children - page content (PageHead, Sections).
 * @param props.width - column width mode.
 * @param props.dense - tighter section rhythm.
 * @returns the scrolling container.
 */
export function Page({ children, width = "reading", dense = false, className, data }: PageProps): React.ReactNode {
  return (
    <div className={cx(css.page, className)} data-kit-page="" {...data}>
      <div
        className={cx(
          css.pageInner,
          width === "wide" && css.pageInnerWide,
          width === "fill" && css.pageInnerFill,
          dense && css.pageInnerTight,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Settings-section column: same rhythm as Page, no own scroll (the dialog panel scrolls).
 * @param props.children - section content.
 * @returns the column.
 */
export function SettingsPage({ children, className, data }: { children: React.ReactNode; className?: string; data?: Record<`data-${string}`, string> }): React.ReactNode {
  return (
    <div className={cx(css.pageInner, css.pageInnerSettings, className)} data-kit-settings-page="" {...data}>
      {children}
    </div>
  );
}

export interface PageHeadProps {
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Trailing controls (refresh, primary action). */
  actions?: React.ReactNode;
  /** Small element after the title (status badge). */
  adornment?: React.ReactNode;
}

/**
 * Page title block.
 * @returns the heading row.
 */
export function PageHead({ title, lead, actions, adornment }: PageHeadProps): React.ReactNode {
  return (
    <header className={css.pageHead} data-kit-page-head="">
      <div className={css.pageHeadText}>
        <div className={css.pageTitleRow}>
          <h2 className={css.pageTitle}>{title}</h2>
          {adornment}
        </div>
        {lead === undefined || lead === null || lead === "" ? null : <p className={css.pageLead}>{lead}</p>}
      </div>
      {actions === undefined ? null : <div className={css.pageActions}>{actions}</div>}
    </header>
  );
}

/* ---------------- Section ---------------- */

export interface SectionProps {
  title?: React.ReactNode;
  count?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  data?: Record<`data-${string}`, string>;
}

/**
 * A titled group of content on a page.
 * @returns the section.
 */
export function Section({ title, count, hint, actions, children, className, data }: SectionProps): React.ReactNode {
  const hasHead = title !== undefined || actions !== undefined || hint !== undefined;
  return (
    <section className={cx(css.section, className)} data-kit-section="" {...data}>
      {hasHead ? (
        <div className={css.sectionHead}>
          {title === undefined ? null : <span className={css.sectionTitle}>{title}</span>}
          {count === undefined || count === null ? null : <span className={css.sectionCount}>{count}</span>}
          {hint === undefined ? null : <span className={css.sectionHint}>{hint}</span>}
          {actions === undefined ? null : <span className={css.sectionActions}>{actions}</span>}
        </div>
      ) : null}
      <div className={css.sectionBody}>{children}</div>
    </section>
  );
}

/* ---------------- Card ---------------- */

export interface CardProps {
  children: React.ReactNode;
  /** Pad the card for free-form content (rows bring their own padding). */
  padded?: boolean;
  /** Lighter card for nested or secondary content. */
  quiet?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  data?: Record<`data-${string}`, string>;
  as?: "div" | "li" | "article";
}

/**
 * The settings-material card.
 * @returns the card element.
 */
export function Card({ children, padded = false, quiet = false, selected = false, onClick, className, data, as = "div" }: CardProps): React.ReactNode {
  const Tag = as;
  const interactive = onClick !== undefined;
  return (
    <Tag
      className={cx(
        css.card,
        padded && css.cardPadded,
        quiet && css.cardQuiet,
        interactive && css.cardInteractive,
        selected && css.cardSelected,
        className,
      )}
      data-kit-card=""
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event: React.KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              onClick?.();
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      {...data}
    >
      {children}
    </Tag>
  );
}

/* ---------------- Row ---------------- */

export interface RowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Leading glyph / dot / tile. */
  lead?: React.ReactNode;
  /** Element beside the label (badge). */
  labelAdornment?: React.ReactNode;
  /** Trailing control or value. */
  children?: React.ReactNode;
  /** Wider control column (text inputs, selects). */
  wideControl?: boolean;
  /** Put the control under the text (multi-line editors). */
  stacked?: boolean;
  /** Align to the top for multi-line descriptions. */
  top?: boolean;
  /** Dim the label (disabled / paused items). */
  muted?: boolean;
  onClick?: () => void;
  className?: string;
  data?: Record<`data-${string}`, string>;
}

/**
 * A settings-style row: label + description left, control right.
 * @returns the row element.
 */
export function Row({ label, description, lead, labelAdornment, children, wideControl = false, stacked = false, top = false, muted = false, onClick, className, data }: RowProps): React.ReactNode {
  return (
    <div
      className={cx(css.row, stacked && css.rowStack, top && css.rowTop, muted && css.rowMuted, onClick !== undefined && css.rowClickable, className)}
      data-kit-row=""
      onClick={onClick}
      {...data}
    >
      {lead === undefined ? null : <span className={css.rowLead}>{lead}</span>}
      <div className={css.rowText}>
        <div className={css.rowLabel}>
          <span className={css.rowLabelText}>{label}</span>
          {labelAdornment}
        </div>
        {description === undefined || description === null || description === "" ? null : (
          <div className={css.rowDesc}>{description}</div>
        )}
      </div>
      {children === undefined || children === null ? null : (
        <div className={cx(css.rowControl, wideControl && css.rowControlWide)}>{children}</div>
      )}
    </div>
  );
}

/** Right-aligned secondary value for a Row. */
export function RowValue({ children, mono = false }: { children: React.ReactNode; mono?: boolean }): React.ReactNode {
  return <span className={cx(css.rowValue, mono && css.mono)}>{children}</span>;
}

/* ---------------- Facts (definition grid) ---------------- */

export interface Fact {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Allow the value to wrap (long descriptions). */
  wrap?: boolean;
  mono?: boolean;
  key?: string;
  title?: string;
}

/**
 * Key/value grid for read-only facts.
 * @param props.items - facts to show.
 * @returns the grid.
 */
export function Facts({ items, columns }: { items: readonly Fact[]; columns?: number }): React.ReactNode {
  return (
    <dl
      className={css.facts}
      data-kit-facts=""
      style={columns === undefined ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item, index) => (
        <div className={css.fact} key={item.key ?? index}>
          <dt className={css.factLabel}>{item.label}</dt>
          <dd className={cx(css.factValue, item.wrap && css.factValueWrap, item.mono && css.mono)} title={item.title}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Metrics ---------------- */

export interface MetricItem {
  label: React.ReactNode;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: KitTone;
  /** Render the value dimmed (zero / unknown). */
  muted?: boolean;
  /** `text` renders a word value ("已配置") at 16px instead of the 24px numeral. */
  variant?: "number" | "text";
  key?: string;
}

/**
 * Responsive grid of metric tiles.
 * @param props.items - metrics to show.
 * @returns the grid.
 */
export function Metrics({ items }: { items: readonly MetricItem[] }): React.ReactNode {
  return (
    <div className={css.metrics} data-kit-metrics="">
      {items.map((item, index) => (
        <div className={css.metric} key={item.key ?? index} data-kit-metric="">
          <span className={css.metricHead}>
            {item.tone === undefined ? null : <Dot tone={item.tone} />}
            <span className={css.metricLabel}>{item.label}</span>
          </span>
          <span className={cx(css.metricValue, item.variant === "text" && css.metricValueText, item.muted && css.metricValueMuted)}>{item.value}</span>
          {item.foot === undefined ? null : <span className={css.metricFoot}>{item.foot}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Filter bar ---------------- */

export interface FilterOption<V extends string> {
  value: V;
  label: React.ReactNode;
  count?: number | string;
  disabled?: boolean;
  title?: string;
  /** Per-option data attributes (verification hooks), spread onto the option button. */
  data?: Record<`data-${string}`, string>;
}

export interface FilterBarProps<V extends string> {
  options: readonly FilterOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  /** Base id: each tab becomes `<id>-<value>` and controls `<id>-<value>-panel` (SegmentedControl-compatible). */
  id?: string;
  disabled?: boolean;
  className?: string | undefined;
  data?: Record<`data-${string}`, string>;
}

/**
 * Quiet single-choice filter: text items, the active one on a soft fill.
 * Replaces segmented controls and chip rows for view filters; accepts the
 * SegmentedControl props so it is a drop-in swap.
 * @returns a tablist.
 */
export function FilterBar<V extends string>({ options, value, onChange, label, id, disabled = false, className, data }: FilterBarProps<V>): React.ReactNode {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number): void => {
    const n = options.length;
    for (let step = 1; step <= n; step += 1) {
      const next = (((from + delta * step) % n) + n) % n;
      const option = options[next];
      if (option !== undefined && option.disabled !== true) {
        refs.current[next]?.focus();
        if (option.value !== value) onChange(option.value);
        return;
      }
    }
  };
  return (
    <div className={cx(css.filterBar, className)} role="tablist" aria-label={label} data-kit-filter-bar="" {...data}>
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={id === undefined ? undefined : `${id}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={id === undefined ? undefined : `${id}-${option.value}-panel`}
            tabIndex={active ? 0 : -1}
            className={cx(css.filter, active && css.filterActive)}
            disabled={disabled || option.disabled === true}
            title={option.title}
            data-kit-filter={option.value}
            {...option.data}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => o.disabled !== true);
                const target = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
                if (target !== undefined) {
                  refs.current[target.i]?.focus();
                  if (target.o.value !== value) onChange(target.o.value);
                }
              }
            }}
          >
            {option.label}
            {option.count === undefined ? null : <span className={css.filterCount}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Multi-select variant: every item toggles independently.
 * @returns a group of toggle buttons.
 */
export function FilterToggles<V extends string>({
  options,
  values,
  onToggle,
  label,
  className,
}: {
  options: readonly FilterOption<V>[];
  values: ReadonlySet<V> | readonly V[];
  onToggle: (value: V) => void;
  label: string;
  className?: string;
}): React.ReactNode {
  const has = (v: V): boolean => (Array.isArray(values) ? values.includes(v) : (values as ReadonlySet<V>).has(v));
  return (
    <div className={cx(css.filterBar, className)} role="group" aria-label={label} data-kit-filter-toggles="">
      {options.map((option) => {
        const active = has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={cx(css.filter, active && css.filterActive)}
            disabled={option.disabled === true}
            title={option.title}
            data-kit-filter={option.value}
            {...option.data}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
            {option.count === undefined ? null : <span className={css.filterCount}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Thin vertical separator inside a filter bar / toolbar. */
export function FilterSep(): React.ReactNode {
  return <span className={css.filterSep} aria-hidden="true" />;
}

/* ---------------- Toolbar ---------------- */

/**
 * Horizontal toolbar; children after `<ToolbarEnd>` align right.
 * @returns the toolbar.
 */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }): React.ReactNode {
  return <div className={cx(css.toolbar, className)}>{children}</div>;
}

export function ToolbarEnd({ children }: { children: React.ReactNode }): React.ReactNode {
  return <div className={css.toolbarEnd}>{children}</div>;
}

/* ---------------- State marks ---------------- */

/**
 * 8px semantic dot.
 * @param props.tone - state tone.
 * @param props.pulse - breathe while live.
 * @returns the dot (decorative; the caller names the state in text).
 */
export function Dot({ tone = "neutral", pulse = false, title }: { tone?: KitTone; pulse?: boolean; title?: string }): React.ReactNode {
  return <span className={css.dot} data-tone={tone} data-pulse={pulse ? "true" : undefined} aria-hidden={title === undefined} title={title} />;
}

/**
 * Small capsule for kinds and counts.
 * @returns the badge.
 */
export function Badge({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: KitTone; title?: string }): React.ReactNode {
  return (
    <span className={css.badge} data-tone={tone} title={title} data-kit-badge="">
      {children}
    </span>
  );
}

/** Glyph tile (32px or 24px). */
export function Tile({ children, small = false }: { children: React.ReactNode; small?: boolean }): React.ReactNode {
  return <span className={cx(css.tile, small && css.tileSm)}>{children}</span>;
}

/** Inline meta line: items separated by drawn middle dots. */
export function Meta({ items, className }: { items: ReadonlyArray<React.ReactNode>; className?: string }): React.ReactNode {
  const visible = items.filter((item) => item !== null && item !== undefined && item !== false && item !== "");
  return (
    <span className={cx(css.meta, className)}>
      {visible.map((item, index) => (
        <span className={css.metaItem} key={index}>
          {item}
        </span>
      ))}
    </span>
  );
}

/* ---------------- Non-content states ---------------- */

export interface EmptyProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  text?: React.ReactNode;
  action?: React.ReactNode;
  /** Inside a card (smaller). */
  inCard?: boolean;
  data?: Record<`data-${string}`, string>;
}

/**
 * Empty state.
 * @returns the centred block.
 */
export function Empty({ icon, title, text, action, inCard = false, data }: EmptyProps): React.ReactNode {
  return (
    <div className={cx(css.empty, inCard && css.emptyInCard)} data-kit-empty="" {...data}>
      {icon === undefined ? null : (
        <span className={css.emptyTile} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={css.emptyTitle}>{title}</span>
      {text === undefined ? null : <span className={css.emptyText}>{text}</span>}
      {action === undefined ? null : <span className={css.emptyAction}>{action}</span>}
    </div>
  );
}

/**
 * Inline notice (error / warning / info) with an optional trailing action.
 * @returns the notice.
 */
export function Notice({ children, tone = "neutral", action, data }: { children: React.ReactNode; tone?: KitTone; action?: React.ReactNode; data?: Record<`data-${string}`, string> }): React.ReactNode {
  return (
    <div className={css.notice} data-tone={tone} role={tone === "danger" ? "alert" : "status"} data-kit-notice="" {...data}>
      <span className={css.noticeBody}>{children}</span>
      {action === undefined ? null : <span className={css.noticeAction}>{action}</span>}
    </div>
  );
}

/** Three shimmering lines while content loads. */
export function Skeleton({ label = "加载中" }: { label?: string }): React.ReactNode {
  return (
    <div className={css.skeleton} role="status" aria-label={label} data-kit-skeleton="">
      <span className={css.skeletonLine} />
      <span className={css.skeletonLine} />
      <span className={css.skeletonLine} />
    </div>
  );
}

/* ---------------- Icon button ---------------- */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: React.ReactNode;
  spinning?: boolean;
}

/**
 * Quiet 28px icon button with an accessible name.
 * @returns the button.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, spinning = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(css.iconButton, className)}
      data-spin={spinning ? "true" : undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ---------------- Form editing ---------------- */

/**
 * Filled editing module (DSH Models `.editor`): groups of fields + an action bar.
 * @param props.inCard - inset it inside a Card below a Row.
 * @returns the editor surface.
 */
export function Editor({ children, inCard = false, data }: { children: React.ReactNode; inCard?: boolean; data?: Record<`data-${string}`, string> }): React.ReactNode {
  return (
    <div className={cx(css.editor, inCard && css.editorInCard)} data-kit-editor="" {...data}>
      {children}
    </div>
  );
}

/** A titled group of fields inside an Editor; groups are separated by a hairline. */
export function EditorGroup({ title, children }: { title?: React.ReactNode; children: React.ReactNode }): React.ReactNode {
  return (
    <div className={css.editorGroup}>
      {title === undefined ? null : <div className={css.editorGroupTitle}>{title}</div>}
      {children}
    </div>
  );
}

/** Two- or three-column field grid (collapses to one column on narrow panels). */
export function FieldGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }): React.ReactNode {
  return <div className={cx(css.fieldGrid, columns === 3 && css.fieldGrid3)}>{children}</div>;
}

export interface FieldProps {
  label: React.ReactNode;
  /** id of the control, for the label's htmlFor. */
  htmlFor?: string;
  hint?: React.ReactNode;
  optional?: boolean;
  /** Span every column of a FieldGrid. */
  span?: boolean;
  children: React.ReactNode;
}

/**
 * Stacked form field: 12px label, control, 11px hint.
 * @returns the field.
 */
export function Field({ label, htmlFor, hint, optional = false, span = false, children }: FieldProps): React.ReactNode {
  return (
    <div className={cx(css.field, span && css.fieldSpan)} data-kit-field="">
      <label className={css.fieldLabel} htmlFor={htmlFor}>
        {label}
        {optional ? <span className={css.fieldOptional}>可选</span> : null}
      </label>
      {children}
      {hint === undefined || hint === null || hint === "" ? null : <p className={css.fieldHint}>{hint}</p>}
    </div>
  );
}

/** Kit text input (32px). Pass `mono` for ids, URLs and keys. */
export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function TextInput({ mono = false, className, ...rest }, ref) {
    return <input ref={ref} className={cx(css.input, mono && css.inputMono, className)} {...rest} />;
  },
);

/** Input with a trailing unit label ("次", "ms", "K"). */
export function UnitInput({ unit, children }: { unit: React.ReactNode; children: React.ReactNode }): React.ReactNode {
  return (
    <span className={css.inputUnit}>
      {children}
      <span className={css.inputUnitSuffix}>{unit}</span>
    </span>
  );
}

/** Right-aligned action bar at the bottom of an Editor; `start` holds the destructive action on the left. */
export function EditorActions({ start, children }: { start?: React.ReactNode; children: React.ReactNode }): React.ReactNode {
  return (
    <div className={css.editorActions}>
      {start === undefined ? null : <span className={css.editorActionsStart}>{start}</span>}
      {children}
    </div>
  );
}

/**
 * Disclosure button for an advanced block (chevron rotates when open).
 * @returns the toggle button.
 */
export function Disclosure({ open, onToggle, children, hint, label }: { open: boolean; onToggle: () => void; children: React.ReactNode; hint?: React.ReactNode; label?: string }): React.ReactNode {
  return (
    <button type="button" className={css.disclosure} aria-expanded={open} aria-label={label} onClick={onToggle}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
      {hint === undefined ? null : <span className={css.disclosureHint}>{hint}</span>}
    </button>
  );
}

/** Ordered chain container (failover order, reasoning levels). */
export function Chain({ children, label }: { children: React.ReactNode; label: string }): React.ReactNode {
  return (
    <div className={css.chain} role="list" aria-label={label} data-kit-chain="">
      {children}
    </div>
  );
}

/** One step of a Chain: index badge + content (a select, a name) + trailing remove. */
export function ChainStep({ index, children, data }: { index: number; children: React.ReactNode; data?: Record<`data-${string}`, string> }): React.ReactNode {
  return (
    <span className={css.chainStep} role="listitem" {...data}>
      <span className={css.chainIndex} aria-hidden="true">
        {index}
      </span>
      {children}
    </span>
  );
}

/** Arrow between chain steps. */
export function ChainArrow(): React.ReactNode {
  return (
    <svg className={css.chainArrow} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6h7M7 3.5 9.5 6 7 8.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Dashed add button that ends a chain. */
export function ChainAdd({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }): React.ReactNode {
  return (
    <button type="button" className={css.chainAdd} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Full-width dashed "add" slot ending a list of cards. */
export function AddSlot({ children, onClick, disabled, data }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; data?: Record<`data-${string}`, string> }): React.ReactNode {
  return (
    <button type="button" className={css.addSlot} onClick={onClick} disabled={disabled} {...data}>
      {children}
    </button>
  );
}

/** Row of AddSlots sharing the width. */
export function AddSlots({ children }: { children: React.ReactNode }): React.ReactNode {
  return <div className={css.addSlots}>{children}</div>;
}

/* ---------------- Row menu / pager / text area ---------------- */

export interface RowMenuItem {
  label: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
  data?: Record<`data-${string}`, string>;
}

/**
 * Trailing ⋯ menu for a list row: secondary actions live here so the row face
 * keeps only its switch and key facts. Clicks do not reach the row.
 * @returns the anchored menu.
 */
export function RowMenu({ label, items, disabled = false, data }: { label: string; items: readonly RowMenuItem[]; disabled?: boolean; data?: Record<`data-${string}`, string> }): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      portal
      anchor={
        <IconButton
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          {...data}
        >
          <IconEllipsisOutlineRegular size={15} />
        </IconButton>
      }
    >
      {items.map((item, index) => (
        <MenuItemButton
          key={index}
          danger={item.danger}
          disabled={item.disabled}
          separatorBefore={item.separatorBefore}
          onSelect={() => {
            setOpen(false);
            item.onSelect();
          }}
          {...item.data}
        >
          {item.label}
        </MenuItemButton>
      ))}
    </Menu>
  );
}

/**
 * Card-footer pager: "range · total" on the left, previous / next icons on the right.
 * @returns the pager bar.
 */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  disabled = false,
  data,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (next: number) => void;
  disabled?: boolean;
  data?: Record<`data-${string}`, string>;
}): React.ReactNode {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={css.pager} data-kit-pager="" {...data}>
      <span className={css.pagerInfo}>
        {from}–{to} · 共 {total} 条 · 第 {page}/{Math.max(1, pageCount)} 页
      </span>
      <span className={css.pagerActions}>
        <IconButton label="上一页" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          <IconChevronLeftOutlineRegular size={14} />
        </IconButton>
        <IconButton label="下一页" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}>
          <IconChevronRightOutlineRegular size={14} />
        </IconButton>
      </span>
    </div>
  );
}

/** Kit multi-line input, same material as TextInput. */
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function TextArea({ mono = false, className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(css.input, css.textArea, mono && css.inputMono, className)} {...rest} />;
  },
);

/** Exposed for pages that need the raw class names (mono text etc.). */
export const kit = css;
