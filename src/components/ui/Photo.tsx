"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Remote photo with a graceful fallback. Served straight from the source
 * (Wikimedia) rather than through the Next image optimizer.
 */
export function Photo({
  src,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!src || failed) {
    return (
      <div className={`absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_10%,#1b2230_0%,#0b0d11_60%)] ${className}`} role="img" aria-label={alt}>
        <span className="hud absolute bottom-3 left-3 text-faint">No photo</span>
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized
      priority={priority}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`object-cover transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
    />
  );
}
