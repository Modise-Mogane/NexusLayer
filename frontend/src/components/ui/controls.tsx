"use client";

/* NexusLayer engineering form controls (Stage C1).
   Controlled inputs with units, validation states, and accessible semantics.
   See /design for the live showcase. */

import { useEffect, useId, useRef, useState } from "react";

const BASE =
  "w-full rounded-md border bg-nx-raised px-2.5 py-1.5 text-xs text-nx-ink placeholder:text-nx-muted focus:outline-none focus:ring-1 focus:ring-nx-accent/40 transition-colors duration-150";
const OK_BORDER = "border-nx-line focus:border-nx-accent";
const ERR_BORDER = "border-nx-bad/70 focus:border-nx-badink";

export function NxField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="nx-label mb-1 block">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[11px] text-nx-badink">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-nx-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function UnitWrap({
  unit,
  error,
  children,
}: {
  unit?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex items-stretch overflow-hidden rounded-md border bg-nx-raised transition-colors duration-150 focus-within:border-nx-accent focus-within:ring-1 focus-within:ring-nx-accent/40 ${
        error ? "border-nx-bad/70 focus-within:border-nx-badink" : "border-nx-line"
      }`}
    >
      <span className="min-w-0 flex-1 [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-2.5 [&>input]:py-1.5 [&>input]:text-xs [&>input]:outline-none">
        {children}
      </span>
      {unit && (
        <span className="flex shrink-0 items-center border-l border-nx-line bg-nx-panel px-2 font-mono text-[11px] text-nx-muted">
          {unit}
        </span>
      )}
    </span>
  );
}

export function NxTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
  error,
  readOnly,
  ...rest
}: {
  id?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string | null;
  readOnly?: boolean;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "id">) {
  const auto = useId();
  return (
    <textarea
      id={id ?? auto}
      value={value}
      placeholder={placeholder}
      rows={rows}
      readOnly={readOnly}
      aria-invalid={!!error}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${BASE} ${error ? ERR_BORDER : OK_BORDER} resize-y leading-relaxed ${readOnly ? "cursor-default bg-nx-workspace text-nx-muted" : ""}`}
      {...rest}
    />
  );
}

export function NxTextInput({
  id,
  value,
  onChange,
  placeholder,
  unit,
  error,
  readOnly,
  ...rest
}: {
  id?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  unit?: string;
  error?: string | null;
  readOnly?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id">) {
  const auto = useId();
  const inputId = id ?? auto;
  const input = (
    <input
      id={inputId}
      type="text"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-invalid={!!error}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${BASE} ${error ? ERR_BORDER : OK_BORDER} ${readOnly ? "cursor-default text-nx-muted" : ""}`}
      {...rest}
    />
  );
  if (!unit) return input;
  // Unit variant restyles through the wrapper; strip the standalone border.
  return (
    <UnitWrap unit={unit} error={error}>
      <input
        id={inputId}
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-invalid={!!error}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full text-nx-ink placeholder:text-nx-muted ${readOnly ? "cursor-default text-nx-muted" : ""}`}
        {...rest}
      />
    </UnitWrap>
  );
}

export function NxNumberInput({
  id,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  error,
  hint,
}: {
  id?: string;
  value: number | "";
  onChange?: (v: number | "") => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number | string;
  error?: string | null;
  hint?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const [text, setText] = useState(value === "" ? "" : String(value));
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    setText(value === "" ? "" : String(value));
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      setLocalError(null);
      onChange?.("");
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setLocalError("Enter a number.");
      return;
    }
    if (min !== undefined && n < min) {
      setLocalError(`Minimum ${min}${unit ? ` ${unit}` : ""}.`);
      return;
    }
    if (max !== undefined && n > max) {
      setLocalError(`Maximum ${max}${unit ? ` ${unit}` : ""}.`);
      return;
    }
    setLocalError(null);
    onChange?.(n);
  };

  const shown = error ?? localError;
  return (
    <span className="block">
      <UnitWrap unit={unit} error={shown}>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step ?? "any"}
          aria-invalid={!!shown}
          onChange={(e) => {
            setText(e.target.value);
            if (localError) setLocalError(null);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          }}
          className="w-full font-mono text-nx-ink placeholder:text-nx-muted"
        />
      </UnitWrap>
      {shown ? (
        <span role="alert" className="mt-1 block text-[11px] text-nx-badink">
          {shown}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-nx-muted">{hint}</span>
      ) : null}
    </span>
  );
}

export function NxSelect({
  id,
  value,
  onChange,
  options,
  error,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string | null;
  ariaLabel?: string;
}) {
  const auto = useId();
  return (
    <select
      id={id ?? auto}
      aria-label={ariaLabel}
      aria-invalid={!!error}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${BASE} ${error ? ERR_BORDER : OK_BORDER} cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22><path d=%22M1 1l4 4 4-4%22 stroke=%22%238b949e%22 fill=%22none%22 stroke-width=%221.5%22/></svg>')] bg-[position:right_0.6rem_center] bg-no-repeat pr-7`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NxToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-nx-accent bg-nx-accent" : "border-nx-line bg-nx-workspace hover:border-nx-muted"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all duration-150 ${
          checked ? "left-[18px] bg-white" : "left-[3px] bg-nx-muted"
        }`}
      />
    </button>
  );
}

export function NxSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange?: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-nx-line bg-nx-workspace p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange?.(o.value)}
            className={`rounded px-2.5 transition-colors duration-150 ${
              size === "sm" ? "py-0.5 text-[11px]" : "py-1 text-xs"
            } ${active ? "bg-nx-accent/20 font-medium text-nx-accent" : "text-nx-muted hover:text-nx-body"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function NxSlider({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  ariaLabel,
}: {
  id?: string;
  value: number;
  onChange?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  ariaLabel: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <span className="flex items-center gap-2">
      <input
        id={inputId}
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="nx-range min-w-0 flex-1"
      />
      <span className="w-24 shrink-0">
        <NxNumberInput value={value} onChange={(v) => typeof v === "number" && onChange?.(v)} unit={unit} min={min} max={max} step={step} />
      </span>
    </span>
  );
}

export function NxSearchSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  ariaLabel,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(query.toLowerCase()) ||
      (o.hint ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        className={`${BASE} ${OK_BORDER} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "" : "text-nx-muted"}`}>{selected ? selected.label : placeholder}</span>
        <span aria-hidden className="font-mono text-[10px] text-nx-muted">
          ▾
        </span>
      </button>
      {open && (
        <div className="nx-pop absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-nx-line bg-nx-raised">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter…"
            aria-label={`${ariaLabel} filter`}
            className="w-full border-b border-nx-line bg-nx-workspace px-2.5 py-1.5 text-xs text-nx-ink outline-none placeholder:text-nx-muted"
          />
          <div role="listbox" className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 && <p className="px-2 py-1.5 text-[11px] text-nx-muted">No matches.</p>}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange?.(o.value);
                  setOpen(false);
                }}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                  o.value === value ? "bg-nx-accent/15 text-nx-accent" : "text-nx-body hover:bg-nx-raised"
                }`}
              >
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-[10px] text-nx-muted">{o.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
