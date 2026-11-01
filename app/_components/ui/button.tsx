"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const VARIANTS: Record<Variant, string> = {
  // `action` is ink in light and lime in dark, so the main action is always the
  // highest-contrast thing on the screen.
  primary: "bg-action text-on-action border border-transparent",
  secondary: "bg-surface text-text border border-border-strong",
  ghost: "bg-transparent text-positive border border-transparent",
};

const SIZES: Record<Size, string> = {
  md: "min-h-[var(--control-md)] px-4 text-[15px] leading-[22px]",
  sm: "min-h-[var(--control-sm)] px-3 text-[13px] leading-[18px]",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: Variant;
  /** `sm` is for pointer devices at ≥900px only; touch keeps `md`. */
  size?: Size;
  /** A screen's primary action is block in the sticky footer on compact. */
  block?: boolean;
  children: ReactNode;
  className?: string;
  href?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  children,
  className,
  href,
  ...props
}: ButtonProps) {
  const classes = cn(
    "np-press inline-flex items-center justify-center gap-2 rounded-sm font-semibold no-underline",
    "disabled:opacity-45 disabled:pointer-events-none",
    VARIANTS[variant],
    SIZES[size],
    block && "w-full",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}

/** An icon-only control: 44px square, and it always carries a label. */
export function IconButton({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "np-press grid h-[var(--tap-min)] w-[var(--tap-min)] flex-none place-items-center",
        "rounded-full bg-surface-2 text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}
