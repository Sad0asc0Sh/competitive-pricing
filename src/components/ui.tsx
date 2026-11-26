"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  IconCheckCircle,
  IconChevronDown,
  IconClose,
  IconInfo,
  IconSpinner,
  IconXCircle,
} from "./icons";

/* =========================================================
 * ۱) سیستم اعلان‌های Toast واکنش‌گرا (موبایل + دسکتاپ)
 * =======================================================*/
type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; text: string };

type ToastContextValue = {
  push: (tone: ToastTone, text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const noopToast: ToastContextValue = {
  push: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
};

const ToastContext = createContext<ToastContextValue>(noopToast);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, text: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, tone, text }]);
      const duration = tone === "error" ? 6500 : 4500;
      const t = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, t);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (text) => push("success", text),
      error: (text) => push("error", text),
      info: (text) => push("info", text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3.5 bottom-20 z-[70] flex flex-col gap-2 lg:bottom-6 lg:left-6 lg:right-auto lg:w-96"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => {
          const styles =
            item.tone === "success"
              ? "border-emerald-200 bg-emerald-950 text-white"
              : item.tone === "error"
                ? "border-rose-300 bg-rose-950 text-white"
                : "border-slate-700 bg-slate-900 text-white";
          return (
            <div
              key={item.id}
              role="status"
              className={`pointer-events-auto animate-toast-in flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-xs font-medium shadow-xl ${styles}`}
            >
              <span className="mt-0.5 shrink-0">
                {item.tone === "success" ? (
                  <IconCheckCircle className="h-4 w-4 text-emerald-400" />
                ) : item.tone === "error" ? (
                  <IconXCircle className="h-4 w-4 text-rose-400" />
                ) : (
                  <IconInfo className="h-4 w-4 text-indigo-300" />
                )}
              </span>
              <span className="min-w-0 flex-1 break-words leading-5">{item.text}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="بستن اعلان"
                className="shrink-0 rounded-lg p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* =========================================================
 * ۲) مودال واکنش‌گرا: Bottom Sheet در موبایل و Dialog در دسکتاپ
 * =======================================================*/
const modalWidths = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-4xl",
} as const;

export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = "lg",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: keyof typeof modalWidths;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/55 backdrop-blur-[2px] transition-opacity"
      />
      <div
        className={`relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl ${modalWidths[maxWidth]} animate-sheet-up`}
      >
        {/* دستگیره بصری شیت در موبایل */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره"
            className="btn-icon h-9 w-9 shrink-0"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>

        {footer ? (
          <div className="safe-bottom border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5">
            {footer}
          </div>
        ) : (
          <div className="safe-bottom sm:hidden" />
        )}
      </div>
    </div>
  );
}

/* =========================================================
 * ۳) دیالوگ تأیید سفارشی (جایگزین window.confirm)
 * =======================================================*/
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "تأیید و ادامه",
  cancelLabel = "انصراف",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalSheet open={open} onClose={busy ? () => {} : onCancel} title={title} maxWidth="sm">
      <p className="text-sm leading-7 text-slate-600">{description}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === "danger" ? "btn-danger" : "btn-primary"}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && <IconSpinner className="h-4 w-4" />}
          {confirmLabel}
        </button>
      </div>
    </ModalSheet>
  );
}

/* =========================================================
 * ۴) کلید کشویی مدرن (Switch) سازگار با RTL و تاچ موبایل
 * =======================================================*/
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const controlId = id ?? autoId;

  return (
    <div className="flex items-start justify-between gap-3">
      {(label || description) && (
        <label htmlFor={controlId} className="min-w-0 flex-1 cursor-pointer select-none">
          {label && <span className="block text-sm font-medium text-slate-800">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>}
        </label>
      )}
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        dir="ltr"
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-indigo-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/* =========================================================
 * ۵) بخش بازشو (Accordion / CollapsibleSection)
 * =======================================================*/
export function CollapsibleSection({
  title,
  subtitle,
  badge,
  icon,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className = "",
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  className?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? internalOpen;

  const toggle = () => {
    const next = !isOpen;
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={`card overflow-hidden p-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-right transition hover:opacity-85"
        >
          {icon && <span className="shrink-0 text-indigo-600">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900 sm:text-base">{title}</span>
              {badge}
            </span>
            {subtitle && <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span>}
          </span>
          <IconChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {isOpen && <div className="border-t border-slate-100 p-4 sm:p-5">{children}</div>}
    </div>
  );
}

/* =========================================================
 * ۶) تب‌های واکنش‌گرا (SegmentedTabs) با اسکرول لمسی روی موبایل
 * =======================================================*/
export type TabItem<T extends string = string> = {
  key: T;
  label: string;
  count?: number;
  icon?: ReactNode;
};

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className = "",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1.5 ${className}`}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
              active
                ? "bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/70"
                : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
            }`}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
            {item.count != null && (
              <span
                className={`num rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? "bg-indigo-100 text-indigo-800" : "bg-slate-200/80 text-slate-600"
                }`}
              >
                {item.count.toLocaleString("fa-IR")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================
 * ۷) وضعیت خالی استاندارد (EmptyState)
 * =======================================================*/
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state flex flex-col items-center justify-center gap-2">
      {icon && <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-xs">{icon}</div>}
      <div className="font-bold text-slate-700">{title}</div>
      {description && <p className="max-w-md text-xs leading-6 text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
