"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../cn";
import { Icon } from "./icon";
import { IconButton } from "./button";

/**
 * Detail on demand: a bottom sheet on compact, a centred dialog at ≥900px.
 *
 * It is the same component either way, because the rule is about where detail
 * lives rather than how wide the screen is: rows stay one figure each and the
 * breakdown opens here.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  header,
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the dialog for assistive technology. */
  label: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] flex flex-col justify-end expanded:items-center expanded:justify-center expanded:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="np-scrim-in absolute inset-0 border-0 bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "np-sheet-in relative flex max-h-[82%] w-full flex-col gap-4 overflow-y-auto bg-surface px-4 pb-6 pt-2",
          "rounded-t-[var(--radius-sheet)] shadow-[var(--shadow-sheet)]",
          "max-w-[var(--sheet-max)] expanded:max-h-[80vh] expanded:rounded-lg expanded:p-6",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="mt-1 h-1 w-10 flex-none self-center rounded-full bg-surface-3 expanded:hidden"
        />
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col">{header}</div>
          <IconButton label="Close" onClick={onClose}>
            <Icon name="close" />
          </IconButton>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
