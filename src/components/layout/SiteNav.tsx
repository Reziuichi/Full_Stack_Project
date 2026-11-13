"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { List, X, ArrowUpRight } from "@phosphor-icons/react";
import { Logo } from "./Logo";
import { HudClock } from "./HudClock";
import { ExploreLink } from "./ExploreLink";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/#explore", label: "Explore" },
  { href: "/destinations", label: "Destinations" },
  { href: "/tours", label: "Tours" },
  { href: "/about", label: "About" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nav link with special handling for Explore (journey action) and Home (scroll to top). */
function NavLink({
  href,
  pathname,
  className,
  onNavigate,
  children,
}: {
  href: string;
  pathname: string;
  className: string;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  if (href === "/#explore") {
    return (
      <ExploreLink className={className} onNavigate={onNavigate}>
        {children}
      </ExploreLink>
    );
  }
  return (
    <Link
      href={href}
      aria-current={isActive(pathname, href) ? "page" : undefined}
      className={className}
      onClick={(e) => {
        onNavigate?.();
        if (href === "/" && pathname === "/") {
          // Already home: glide back to the top of the journey instead of a hard jump.
          e.preventDefault();
          document.documentElement.style.overflow = "";
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
    >
      {children}
    </Link>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const barRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);

  // Transparent over the globe; solid once the page has scrolled.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const threshold = pathname === "/" ? window.innerHeight * 0.6 : 12;
      // An immersive stage (data-nav-clear) keeps the bar clear while it fills the top of the screen;
      // data-nav-clear="full" only while it fills the whole screen (its content runs to the bottom edge).
      const el = document.querySelector<HTMLElement>("[data-nav-clear]");
      const stage = el?.getBoundingClientRect();
      const until = el?.dataset.navClear === "full" ? window.innerHeight - 1 : 64;
      const overStage = !!stage && stage.top <= 0 && stage.bottom > until;
      bar.dataset.solid = window.scrollY > threshold && !overStage ? "true" : "false";
      bar.dataset.clear = !!stage && stage.top <= 1 && stage.bottom > until ? "true" : "false";
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/auth/session")
        .then((r) => r.json())
        .then((j: { user: { name: string } | null }) => !cancelled && setUser(j.user))
        .catch(() => {});
    void load();
    window.addEventListener("lgt:auth", load);
    return () => {
      cancelled = true;
      window.removeEventListener("lgt:auth", load);
    };
  }, [pathname]);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  // Close the menu on navigation (state adjusted during render, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <header
        ref={barRef}
        data-solid="false"
        className="group fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color] duration-500 data-[solid=true]:border-line data-[solid=true]:bg-space/[0.92]"
      >
        <nav
          aria-label="Primary"
          className="mx-auto grid h-16 max-w-[1600px] grid-cols-[1fr_auto] items-center gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8"
        >
          <div className="hidden items-start gap-8 text-muted lg:flex">
            <div className="hud leading-[1.6]">
              <div>
                <span className="text-dim">Orbital-travel-desk</span> <span className="ml-3">L-26</span>
              </div>
              <div>
                Cycle <span className="text-dim">• 0412</span> <span className="ml-3">Time</span>{" "}
                <HudClock className="text-dim" />
              </div>
            </div>
          </div>

          <Link href="/" aria-label="Longitude home" className="justify-self-start lg:justify-self-center">
            <Logo />
          </Link>

          <div className="flex items-center justify-end gap-1">
            <ul className="hidden items-center gap-0.5 lg:flex">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <NavLink
                    href={link.href}
                    pathname={pathname}
                    className="hud rounded-md px-2.5 py-2 text-muted transition-colors hover:text-fg aria-[current=page]:text-fg"
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
              <li className="ml-2">
                <Link
                  href="/account"
                  aria-current={isActive(pathname, "/account") ? "page" : undefined}
                  className="hud inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2 text-fg transition-colors hover:bg-fg hover:text-space"
                >
                  {user ? "Profile" : "Login"}
                  <ArrowUpRight size={12} weight="bold" aria-hidden />
                </Link>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="grid h-11 w-11 place-items-center rounded-full border border-line-strong lg:hidden"
            >
              <List size={18} />
            </button>
          </div>
        </nav>
      </header>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        data-open={open}
        className="fixed inset-0 z-[55] flex flex-col bg-space/[0.98] px-4 pb-10 pt-4 opacity-0 transition-opacity duration-500 data-[open=false]:invisible data-[open=false]:pointer-events-none data-[open=true]:opacity-100 sm:px-6 lg:hidden"
      >
        <div className="flex h-12 items-center justify-between">
          <Logo />
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-full border border-line-strong">
            <X size={18} />
          </button>
        </div>
        <ul className="mt-12 flex flex-col">
          {[...LINKS, { href: "/account", label: user ? "Profile" : "Login" }].map((link, i) => (
            <li
              key={link.href}
              style={{ transitionDelay: open ? `${i * 55 + 80}ms` : "0ms" }}
              className={`border-b border-line transition-all duration-700 ${open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
            >
              <NavLink
                href={link.href}
                pathname={pathname}
                onNavigate={() => setOpen(false)}
                className="flex items-baseline justify-between py-5 font-mono text-3xl font-light uppercase tracking-tight"
              >
                {link.label}
                <span className="hud text-faint">{String(i + 1).padStart(2, "0")}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="hud mt-auto text-faint">
          <HudClock />
        </div>
      </div>
    </>
  );
}
