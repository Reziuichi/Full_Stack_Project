"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "@/lib/gsap";

/** A tour's own page: /tours/<slug>. */
const TOUR = /^\/tours\/[^/]+\/?$/;
type TourWindow = Window & { __lgtTour?: string };
type Router = ReturnType<typeof useRouter>;

const hiRes = (src: string) => (src.includes("/thumb/") ? src.replace(/\/\d+px-([^/]+)$/, "/1280px-$1") : src);
let boarding = false;

/**
 * Boarding: the tour's photo lifts off the page where it was clicked and
 * opens out to fill the screen (a sharper copy fading in over it), with the
 * flight read out along the bottom. The route changes as it opens, so the
 * wait for the new page happens behind a full-screen photo instead of a
 * frozen one. When the tour page's hero (the same photo, framed the same
 * way) is ready, the overlay dissolves into it and "lgt:tour-arrive" starts
 * the page's entrance. Escape skips; a watchdog always cleans up.
 */
function board(link: HTMLAnchorElement, href: string, router: Router) {
  const card = link.closest<HTMLElement>("[data-tour-card]");
  const img = card?.querySelector<HTMLImageElement>("img[data-on]") ?? card?.querySelector<HTMLImageElement>("img") ?? null;
  const low = img?.currentSrc || img?.src || "";
  const high = link.dataset.tourPhoto || (low ? hiRes(low) : "");
  if (!high) return false;

  boarding = true;
  const w = window as TourWindow;
  w.__lgtTour = "boarding";
  const source = img?.closest<HTMLElement>("[data-tour-frame]") ?? img ?? link;
  const rect = source.getBoundingClientRect();
  const radius = getComputedStyle(source).borderRadius || "0px";

  const overlay = document.createElement("div");
  overlay.className = "tr";
  overlay.setAttribute("aria-hidden", "true");
  const back = document.createElement("div");
  back.className = "tr-back";
  const frame = document.createElement("div");
  frame.className = "tr-frame";
  const imgLow = document.createElement("img");
  const imgHigh = document.createElement("img");
  imgLow.alt = imgHigh.alt = "";
  imgHigh.className = "tr-high";
  const shade = document.createElement("div");
  shade.className = "tr-shade";
  frame.append(imgLow, imgHigh, shade);
  const hud = document.createElement("div");
  hud.className = "tr-hud";
  const line = (cls: string, text: string) => {
    const mask = document.createElement("span");
    mask.className = "tr-mask";
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    mask.append(el);
    hud.append(mask);
    return el;
  };
  line("tr-kicker", "Now boarding");
  line("tr-flight", link.dataset.tourFlight ?? "");
  line("tr-name", link.dataset.tourName ?? "");
  const bar = document.createElement("span");
  bar.className = "tr-bar";
  bar.append(document.createElement("i"));
  hud.append(bar);
  overlay.append(back, frame, hud);
  imgLow.src = low || high;
  imgHigh.src = high;
  document.body.append(overlay);

  let done = false;
  let ready = false;
  const onReady = () => (ready = true);
  const land = () => {
    if (done) return;
    done = true;
    window.removeEventListener("lgt:tour-ready", onReady);
    window.removeEventListener("keydown", onKey);
    window.clearTimeout(watchdog);
    window.dispatchEvent(new Event("lgt:tour-arrive"));
    gsap.to(hud, { autoAlpha: 0, y: -12, duration: 0.35, ease: "power2.in" });
    gsap.to(overlay, {
      autoAlpha: 0,
      duration: 0.75,
      delay: 0.1,
      ease: "power2.inOut",
      onComplete: () => {
        overlay.remove();
        delete w.__lgtTour;
        boarding = false;
      },
    });
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && land();
  const watchdog = window.setTimeout(land, 9000);
  window.addEventListener("lgt:tour-ready", onReady);
  window.addEventListener("keydown", onKey);
  imgHigh.decode?.().then(
    () => gsap.to(imgHigh, { opacity: 1, duration: 0.45, ease: "power1.out" }),
    () => undefined,
  );

  router.push(href);

  gsap.set(frame, { left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderRadius: radius });
  const opened = gsap
    .timeline()
    .to(back, { opacity: 1, duration: 0.55, ease: "power2.out" }, 0)
    .to(frame, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, borderRadius: 0, duration: 1.05, ease: "expo.inOut" }, 0.04)
    .to(shade, { opacity: 1, duration: 0.8, ease: "power2.out" }, 0.5)
    .fromTo(hud.querySelectorAll(".tr-mask > span"), { yPercent: 120 }, { yPercent: 0, duration: 0.9, stagger: 0.07, ease: "expo.out" }, 0.6)
    .fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "expo.out" }, 0.8);

  // Land once the photo has opened and the tour page's hero is ready.
  const wait = () => {
    if (done) return;
    if (opened.time() >= 1.3 && (ready || opened.time() > 7)) {
      window.setTimeout(land, 60);
      return;
    }
    window.setTimeout(wait, 40);
  };
  wait();
  return true;
}

/** Intercepts plain clicks on links to a tour's page and boards them. */
export function TourTransition() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || boarding) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !TOUR.test(url.pathname) || url.pathname === window.location.pathname) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState !== "visible") return;
      if (board(a, url.pathname + url.search, router)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
  return null;
}
