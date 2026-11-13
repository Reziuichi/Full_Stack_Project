"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createFlightEngine, DURATION, type FlightEngine } from "./flight/engine";
import { buildJet } from "./flight/jetGeometry";

/** Where the jet flies: every link to this page, from anywhere on the site. */
const TARGET = "/destinations";
/** Keyframes for the wake's clip path (the browser interpolates between them). */
const FRAMES = 72;
/** Longest the jet waits for the new page to commit (a first visit in development compiles it). */
const MAX_HOLD = 6000;

type FlightWindow = Window & { __lgtFlight?: string };
type Router = ReturnType<typeof useRouter>;

const onTarget = () => window.location.pathname.replace(/\/$/, "") === TARGET;
const isTarget = (el: EventTarget | null) => {
  const a = (el as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  const url = new URL(a.href, window.location.href);
  return url.origin === window.location.origin && url.pathname.replace(/\/$/, "") === TARGET && !url.hash ? { a, url } : null;
};

// One WebGL2 probe per page load (a probe per click would leak contexts).
let webgl2: boolean | null = null;
function hasWebGL2() {
  if (webgl2 === null) {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2 = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webgl2;
}
const canFly = () =>
  typeof document.startViewTransition === "function" &&
  document.visibilityState === "visible" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
  hasWebGL2();

// A warm engine: created (shaders compiling in parallel) as soon as the
// pointer or focus reaches a destinations link, so the click flies at once.
type Warm = { canvas: HTMLCanvasElement; engine: FlightEngine; timer: number };
let warm: Warm | null = null;
function release() {
  warm?.engine.dispose();
  warm = null;
}
function newEngine(): Warm | null {
  const canvas = document.createElement("canvas");
  canvas.className = "flight-canvas";
  try {
    const engine = createFlightEngine(canvas);
    return engine ? { canvas, engine, timer: 0 } : null;
  } catch {
    return null;
  }
}
function warmUp() {
  if (warm) {
    window.clearTimeout(warm.timer);
    warm.timer = window.setTimeout(release, 20_000);
    return;
  }
  if (!canFly()) return;
  warm = newEngine();
  if (warm) warm.timer = window.setTimeout(release, 20_000);
}
function take() {
  if (!warm) return null;
  window.clearTimeout(warm.timer);
  const w = warm;
  warm = null;
  return w;
}

// In development a route compiles on its first request, which can take
// seconds; ask for it early so the click lands on a ready page.
let routeWarmed = false;
function warmRoute() {
  if (routeWarmed || process.env.NODE_ENV !== "development") return;
  routeWarmed = true;
  fetch(TARGET, { priority: "low" } as RequestInit).catch(() => undefined);
}

/** A frame, or 50 ms if frames are not being produced (a hidden or throttled tab). */
const tick = () =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(() => {
      cancelAnimationFrame(id);
      resolve();
    }, 50);
    const id = requestAnimationFrame(() => {
      window.clearTimeout(t);
      resolve();
    });
  });

let flying = false;

/**
 * One flight, run imperatively (outside React's lifecycle, so no re-render
 * can strand it half way). The route change fires the moment the old page
 * is captured; whatever happens after that (a skip, a lost GPU, a hidden
 * tab, a slow route), `finish` runs and the page opens. A watchdog makes
 * sure of it.
 */
async function fly(href: string, router: Router) {
  flying = true;
  const w = window as FlightWindow;
  const root = document.documentElement;
  w.__lgtFlight = "covering";

  let done = false;
  let pushed = false;
  let vt: ViewTransition | null = null;
  let raf = 0;
  const pre = take() ?? newEngine();
  const overlay = document.createElement("div");
  overlay.className = "flight";
  overlay.setAttribute("aria-hidden", "true");

  const push = () => {
    if (pushed) return;
    pushed = true;
    router.push(href);
  };
  const reveal = () => {
    if (w.__lgtFlight === "revealing") return;
    w.__lgtFlight = "revealing";
    window.dispatchEvent(new Event("lgt:flight-reveal"));
  };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(watchdog);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", onPointer, true);
    push();
    reveal();
    root.classList.remove("flight-vt");
    delete w.__lgtFlight;
    pre?.engine.dispose();
    overlay.remove();
    flying = false;
  };
  const skip = () => (vt ? vt.skipTransition() : finish());
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && skip();
  const onPointer = () => skip();
  const watchdog = window.setTimeout(() => {
    vt?.skipTransition();
    finish();
  }, MAX_HOLD + DURATION * 1000 + 2500);
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", onPointer, true);

  try {
    if (!pre) return;
    const { canvas, engine: eng } = pre;
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    // Shaders compile in parallel (usually done on hover, before the click).
    const t0 = performance.now();
    while (!done && eng.status() === "pending" && performance.now() - t0 < 700) await tick();
    if (done || eng.status() !== "ready") return;

    const clip = eng.plan(FRAMES);
    eng.render(0);
    root.classList.add("flight-vt");
    // Capture the old page as it stands and change route straight away: the
    // new layer is live, so the page appears inside the wake once it commits.
    vt = document.startViewTransition(() => {
      push();
      reveal();
    });
    await vt.ready;
    if (done) return;

    const duration = DURATION * 1000;
    const wake = root.animate(
      clip.map((c, i) => ({ clipPath: c, offset: i / (clip.length - 1) })),
      { duration, easing: "linear", fill: "both", pseudoElement: "::view-transition-new(root)" },
    );
    wake.pause();
    // The old page sinks back at once (compositor-driven: smooth whatever
    // the main thread is doing) while the jet holds below the screen.
    root.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0.4, transform: "scale(0.965)" },
      ],
      { duration, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "both", pseudoElement: "::view-transition-old(root)" },
    );
    // The jet runs on the wake's own clock, so the two never drift apart.
    // A late frame steps the clock back by the lost time: the flight pauses
    // for an instant instead of jumping.
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const lost = now - last - 34;
      last = now;
      if (lost > 0 && wake.playState === "running") wake.currentTime = Math.max(0, Number(wake.currentTime ?? 0) - lost);
      eng.render(Number(wake.currentTime ?? 0) / 1000);
    };
    raf = requestAnimationFrame(frame);

    // Take off once the new page has committed and settled (three frames on
    // time in a row), so the flight runs on a quiet thread.
    const held = performance.now();
    let prev = held;
    let calm = 0;
    while (!done && calm < 3 && performance.now() - held < MAX_HOLD) {
      await tick();
      const now = performance.now();
      calm = onTarget() && now - prev < 40 ? calm + 1 : 0;
      prev = now;
    }
    if (done) return;
    last = performance.now();
    wake.play();
    await vt.finished;
  } catch {
    // Skipped or unsupported mid-way: fall through to a plain arrival.
  } finally {
    finish();
  }
}

/**
 * The flight transition to the destinations page, built on the View
 * Transitions API. Any link to the page is intercepted; the browser freezes
 * the old page and the new one renders live beneath it. An airliner climbs
 * up the screen through a banked turn and its wake opens behind it: a V
 * born at the wingtips, widening as it ages, through which the new page
 * shows. Vortex hairlines trace the cut, its edge shades the page beneath,
 * the old page sinks back, and once the jet is gone the wake spreads to the
 * edges. The page waits for "lgt:flight-reveal" to start its entrance.
 * Click or Escape skips. Reduced motion, a hidden tab, no WebGL2 or no view
 * transitions: plain navigation.
 */
export function FlightTransition() {
  const router = useRouter();

  // Loft the airliner while the browser is idle, so a click starts at once.
  useEffect(() => {
    if (typeof window.requestIdleCallback !== "function") {
      const id = window.setTimeout(buildJet, 1500);
      return () => window.clearTimeout(id);
    }
    const id = window.requestIdleCallback(() => buildJet(), { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  // Warm up on intent; intercept plain left-clicks on links to the destinations page.
  useEffect(() => {
    router.prefetch(TARGET);
    const onIntent = (e: Event) => {
      if (flying || onTarget() || !isTarget(e.target)) return;
      warmRoute();
      warmUp();
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const hit = isTarget(e.target);
      if (!hit || (hit.a.target && hit.a.target !== "_self") || hit.a.hasAttribute("download")) return;
      if (flying || onTarget() || !canFly()) return;
      e.preventDefault();
      e.stopPropagation();
      void fly(hit.url.pathname + hit.url.search, router);
    };
    document.addEventListener("pointerover", onIntent, { capture: true, passive: true });
    document.addEventListener("focusin", onIntent, true);
    document.addEventListener("touchstart", onIntent, { capture: true, passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerover", onIntent, true);
      document.removeEventListener("focusin", onIntent, true);
      document.removeEventListener("touchstart", onIntent, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);

  return null;
}
