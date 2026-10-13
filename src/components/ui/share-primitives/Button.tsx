"use client";

import { Loader2 } from "lucide-react";

import type { ShareButtonProps } from "@/components/share/types";

/**
 * Adapter for the share blocks (contract: share-ui/HOST-CONTRACT.md in
 * beyondles-ai/beyondles-shared). Same look as the template's own buttons
 * (the brand gradient for primary, white with a line for secondary). `isLoading` shows a spinner and makes
 * the button unclickable.
 */
const VARIANTS = {
  primary: "bg-linear-120 from-brand via-brand-blue to-brand-turquoise text-white hover:opacity-90",
  secondary: "border border-line bg-card text-heading hover:border-brand-light",
  danger: "border border-err bg-card text-err hover:bg-err-soft",
} as const;

export function Button({
  type = "button",
  variant = "primary",
  size,
  isLoading = false,
  disabled = false,
  className,
  onClick,
  children,
}: ShareButtonProps) {
  const scale = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
        "focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        scale,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
