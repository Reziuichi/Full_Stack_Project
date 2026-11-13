"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export const EXPLORE_EVENT = "lgt:explore";

/**
 * "Explore" = fly to the "Where do you want to go?" scene and open the
 * destination picker.
 *
 * On the home page this is handled in place (no navigation): relying on a
 * `#explore` hash was unreliable — the target moves once the journey loads,
 * and the mobile menu's scroll lock swallowed the jump. From other pages we
 * navigate to `/#explore` and the journey runs the same action once ready.
 */
export function ExploreLink({
  className,
  children,
  onNavigate,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  onNavigate?: () => void;
  "aria-current"?: "page" | undefined;
}) {
  const pathname = usePathname();
  return (
    <Link
      href="/#explore"
      scroll={false}
      className={className}
      {...rest}
      onClick={(e) => {
        onNavigate?.();
        if (pathname !== "/") return; // navigate; the home page picks up #explore
        e.preventDefault();
        // Release any scroll lock (e.g. the mobile menu) before scrolling the page.
        document.documentElement.style.overflow = "";
        requestAnimationFrame(() => window.dispatchEvent(new Event(EXPLORE_EVENT)));
      }}
    >
      {children}
    </Link>
  );
}
