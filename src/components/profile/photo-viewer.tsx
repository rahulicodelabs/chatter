"use client";

import { useEffect } from "react";
import Image from "next/image";

/** Full-screen lightbox for a profile photo. */
export function PhotoViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  // Escape closes the viewer.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close photo"
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${alt} photo`}
        className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-3"
      >
        <button
          type="button"
          aria-label="Close photo"
          onClick={onClose}
          className="absolute -top-1 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
        >
          ✕
        </button>
        <div className="relative h-[70vh] w-full overflow-hidden rounded-2xl bg-black/40">
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 672px) 100vw, 672px"
            className="object-contain"
            priority
          />
        </div>
        <p className="text-sm text-white/70">{alt}</p>
      </div>
    </div>
  );
}
