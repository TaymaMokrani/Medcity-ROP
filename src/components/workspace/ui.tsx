import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Workspace's quiet controls. Dark, hairline borders, one cyan accent.
 * Everything that is a number is set in tabular figures so columns line up.
 */

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-micro font-medium uppercase tracking-[0.18em] text-ink-3",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Eyebrow>{title}</Eyebrow>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-4 w-7 shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-accent/60 bg-accent/30"
          : "border-white/15 bg-white/[0.04]",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-all",
          checked ? "left-[14px] bg-accent" : "left-[2px] bg-white/45",
        )}
      />
    </button>
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  value: number;
  display?: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label className={cn("block", disabled && "opacity-40")}>
      {!compact && (
        <span className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-label text-ink/85">{label}</span>
          {display && (
            <span className="text-micro tabular-nums text-ink-3">{display}</span>
          )}
        </span>
      )}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-4 w-full cursor-pointer accent-accent disabled:cursor-not-allowed"
      />
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white/[0.02] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:text-white/20",
            size === "sm" ? "px-2 py-0.5 text-micro" : "px-3 py-1 text-label",
            value === option.value
              ? "bg-white/[0.09] text-ink"
              : "text-ink-3 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/15 bg-white/[0.05] px-1 font-body text-micro font-medium text-ink/80">
      {children}
    </kbd>
  );
}

/** A square tool button with a tooltip that names it and its shortcut. */
export function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30",
          active
            ? "bg-accent/15 text-accent ring-1 ring-accent/35"
            : "text-ink-3 hover:bg-white/[0.06] hover:text-ink",
        )}
      >
        <Icon className="size-[17px]" strokeWidth={1.6} />
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2.5 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-label text-ink opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </div>
  );
}

export function GhostButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
  tone = "default",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-label font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary"
          ? "border-accent/40 bg-accent/15 text-ink hover:bg-accent/25"
          : "border-line bg-white/[0.03] text-ink/90 hover:bg-white/[0.07]",
      )}
    >
      {Icon && <Icon className="size-3.5" strokeWidth={1.8} />}
      {children}
    </button>
  );
}

/** A number with its unit, and a label under it. */
export function Stat({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-body tabular-nums",
          muted ? "text-ink-3" : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-micro leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

export function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "amber" | "violet";
}) {
  return (
    <p
      className={cn(
        "border-l-2 pl-3 text-label leading-relaxed",
        tone === "amber" && "border-amber-400/60 text-amber-100/85",
        tone === "violet" && "border-violet-400/60 text-violet-100/85",
        tone === "muted" && "border-white/15 text-ink-3",
      )}
    >
      {children}
    </p>
  );
}
