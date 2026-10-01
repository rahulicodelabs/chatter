import Image from "next/image";
import { initials } from "@/lib/format";

const SIZES = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-24 w-24 text-3xl",
} as const;

export function Avatar({
  src,
  name,
  size = "md",
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (src) {
    return (
      <span
        className={`relative inline-block shrink-0 overflow-hidden rounded-full bg-muted ${SIZES[size]} ${className}`}
      >
        <Image
          src={src}
          alt={name}
          fill
          sizes="96px"
          className="object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent ${SIZES[size]} ${className}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
