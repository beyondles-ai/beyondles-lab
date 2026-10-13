import type { ShareBadgeProps } from "@/components/share/types";

/**
 * Adapter for the share blocks (contract: share-ui/HOST-CONTRACT.md in
 * beyondles-ai/beyondles-shared). The template ships plain Tailwind and no
 * component library, so this draws with the Beyondles colour names from
 * src/app/globals.css. A Lab with its own badge component maps `variant` and `size`
 * onto it here and leaves the blocks alone.
 */
export function Badge({
  variant = "neutral",
  size = "sm",
  children,
}: ShareBadgeProps) {
  const tone =
    variant === "primary"
      ? "bg-lavender text-lavender-label"
      : "bg-canvas text-muted ring-1 ring-line ring-inset";
  const scale =
    size === "md" ? "gap-1.5 px-2.5 py-1 text-sm" : "gap-1 px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${tone} ${scale}`}
    >
      {children}
    </span>
  );
}
