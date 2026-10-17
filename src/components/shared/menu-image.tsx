import { cn } from "@/lib/utils";

/**
 * Menu photo. Uses a plain <img> because images may be local SVG placeholders
 * or admin-provided https URLs (validated on save); no remote optimisation
 * domains need to be configured.
 */
export function MenuImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || "/images/menu/placeholder.svg"}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
    />
  );
}
