"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUpRight, Buildings, GlobeHemisphereEast, Mountains } from "@phosphor-icons/react";
import { LogoMark } from "@/components/layout/Logo";
import { ExploreLink } from "@/components/layout/ExploreLink";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { BEAT, CHAPTERS, chapterAt, span } from "./world/story";
import type { Pane, Readout, World } from "./world/engine";

const MANIFESTO =
  "We put the whole planet on the first screen. Your route is drawn from where you stand, over real terrain, to where you want to be. Then we build the trip around it.";

/** The lenses round the satellite: each one is a way the site sees the world, and the beam draws the cloud below that way. */
const LENSES = [
  {
    tag: "Engine",
    scan: "Imaging swath",
    Icon: GlobeHemisphereEast,
    title: "CesiumJS globe",
    text: "The planet in true latitude and longitude, drawn live in your browser.",
  },
  {
    tag: "Cities",
    scan: "Tile stream",
    Icon: Buildings,
    title: "Photoreal 3D cities",
    text: "Google’s 3D Tiles stream in, tile by tile, below about 2,400 km.",
  },
  {
    tag: "Terrain",
    scan: "Radar relief",
    Icon: Mountains,
    title: "Real terrain & buildings",
    text: "Cesium World Terrain and OSM Buildings: real heights, real streets.",
  },
];

const NUM = new Intl.NumberFormat("en-US");
const coords = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
/** Which lens the beam follows as you scroll through "How it works", if none is hovered or chosen. */
const autoScan = (p: number) => (p < 0.6 || p > 0.785 ? -1 : p < 0.655 ? 0 : p < 0.71 ? 1 : 2);

/**
 * The About page: one full-screen stage that scrolls through a single story.
 * A grey moon comes alive as the Earth, starting from Chandigarh; the camera
 * falls through its cloud into dusk above a sea of cloud, where the story is
 * told; a satellite glides in among lenses of glass and shines down on the
 * cloud the way each lens sees the world, while night falls round it (it turns
 * slowly, and can be spun by hand); then down through the cloud into the Kullu
 * valley (a living photo), which draws into a porthole back to orbit, where
 * the planet is yours to turn.
 *
 * The 3D world (world/engine.ts) and the words over it follow one damped
 * progress value, so they always move together. With reduced motion the
 * chapters cut between still frames. Without WebGL the words still play
 * over a poster.
 */
export function AboutJourney() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const target = useRef(0);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const snapTo = useRef<(p: number) => void>(() => {});

  const scrollToRest = (i: number, instant = false) => {
    const el = stage.current;
    if (!el) return;
    const calm = window.matchMedia(MOTION_QUERIES.reduce).matches;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const y = top + CHAPTERS[i].rest * (el.offsetHeight - window.innerHeight);
    const far = Math.abs(y - window.scrollY) / window.innerHeight;
    if (instant || calm) {
      window.scrollTo({ top: y, behavior: "instant" });
      snapTo.current(calm ? CHAPTERS[i].calm : CHAPTERS[i].rest);
      return;
    }
    gsap.to(window, { scrollTo: { y, autoKill: true }, duration: Math.min(3.2, 1 + far * 0.32), ease: "power2.inOut" });
  };

  // The words: one paused timeline, 1 second long, whose time is the story's progress.
  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: stage.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => void (target.current = self.progress),
        onRefresh: (self) => void (target.current = self.progress),
      });

      const tl = gsap.timeline({ paused: true, defaults: { ease: "none", immediateRender: false } });
      // Masked text moves by yPercent; its y is pinned to 0 too, because GSAP reads any transform
      // it finds (say, one left by a remount) back as pixels, which would offset it for good.
      const ft = (sel: string, from: gsap.TweenVars, to: gsap.TweenVars, at: number, dur: number) => tl.fromTo(sel, from, { ...to, duration: dur }, at);

      // 01 · The hero leaves as the dive begins.
      ft(".ab-hero-copy", { y: 0, opacity: 1 }, { y: -70, opacity: 0, ease: "power1.in" }, 0.252, 0.05);
      ft(".ab-hero-base", { opacity: 1 }, { opacity: 0 }, 0.245, 0.04);
      ft(".ab-hero", { opacity: 1 }, { opacity: 0 }, 0.302, 0.001);

      // 02 · The story, told over the cloud once the fog has lifted.
      ft(".ab-story", { opacity: 0 }, { opacity: 1 }, 0.36, 0.001);
      ft(".ab-story .ab-pill", { y: 18, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.008 }, 0.372, 0.03);
      ft(".ab-mf", { y: 90, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out" }, 0.375, 0.05);
      const words = gsap.utils.toArray<HTMLElement>(".ab-mf .ab-w");
      ft(".ab-mf .ab-w", { opacity: 0.16 }, { opacity: 1, stagger: 0.085 / words.length }, 0.4, 0.012);
      ft(".ab-story-side", { y: 24, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.01 }, 0.43, 0.035);
      ft(".ab-story-in", { y: 0, yPercent: 0, opacity: 1 }, { y: 0, yPercent: -55, opacity: 0, ease: "power1.in" }, 0.505, 0.05);
      ft(".ab-story-side", { opacity: 1 }, { opacity: 0 }, 0.51, 0.035);
      ft(".ab-story", { opacity: 1 }, { opacity: 0 }, 0.56, 0.001);

      // 03 · A satellite glides in among the lenses.
      ft(".ab-works", { opacity: 0 }, { opacity: 1 }, 0.52, 0.001);
      ft(".ab-wordmark > span", { y: 0, yPercent: 110 }, { y: 0, yPercent: 0, ease: "power3.out" }, 0.535, 0.05);
      ft(".ab-lens-card", { y: 70, opacity: 0 }, { y: 0, opacity: 1, ease: "power3.out", stagger: 0.016 }, 0.575, 0.05);
      ft(".ab-leads", { opacity: 0 }, { opacity: 1 }, 0.6, 0.03);
      ft(".ab-works-foot > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.01 }, 0.625, 0.035);
      ft(".ab-works-foot > *, .ab-leads", { opacity: 1 }, { opacity: 0 }, 0.742, 0.022);
      ft(".ab-lens-card", { y: 0, opacity: 1 }, { y: -60, opacity: 0, ease: "power1.in", stagger: 0.008 }, 0.748, 0.036);
      ft(".ab-wordmark > span", { y: 0, yPercent: 0 }, { y: 0, yPercent: -110, ease: "power2.in" }, 0.765, 0.035);
      ft(".ab-works", { opacity: 1 }, { opacity: 0 }, 0.81, 0.001);

      // 04 · Under the cloud, the valley; back out to orbit; the planet, and how to reach us.
      ft(".ab-arrive", { opacity: 0 }, { opacity: 1 }, 0.828, 0.001);
      ft(".ab-arrived > *", { y: 20, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.006 }, 0.852, 0.024);
      ft(".ab-arrived > *", { y: 0, opacity: 1 }, { y: -16, opacity: 0, ease: "power1.in" }, 0.896, 0.014);
      ft(".ab-earth-l > span", { y: 0, yPercent: 112 }, { y: 0, yPercent: 0, ease: "power3.out", stagger: 0.0045 }, 0.94, 0.04);
      ft(".ab-final-rise", { y: 26, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.007 }, 0.955, 0.032);
      ft(".ab-dock", { y: 30, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out" }, 0.958, 0.03);
      ft(".ab-dock > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", stagger: 0.006 }, 0.962, 0.03);
      tl.set({}, {}, 1);
      timeline.current = tl;
      // A paused timeline only applies a tween's starting values once the playhead reaches it;
      // run it to the end and back so every element starts where its first tween says (the
      // cards hidden below, the wordmark under its mask) rather than in its resting place.
      tl.progress(1).progress(0);
      return () => {
        timeline.current = null;
      };
    },
    { scope: root },
  );

  useEffect(() => {
    const el = root.current!;
    const panel = el.querySelector<HTMLElement>(".ab-panel")!;
    const canvas = el.querySelector<HTMLCanvasElement>(".ab-canvas")!;
    const dip = el.querySelector<HTMLElement>(".ab-dip")!;
    const pin = el.querySelector<HTMLElement>(".ab-pin")!;
    const fill = el.querySelector<HTMLElement>(".ab-rail-fill")!;
    const hudLabel = el.querySelector<HTMLElement>(".ab-hud-label")!;
    const hudValue = el.querySelector<HTMLElement>(".ab-hud-value")!;
    const chips = Array.from(el.querySelectorAll<HTMLElement>(".ab-chip"));
    const cards = Array.from(el.querySelectorAll<HTMLElement>(".ab-lens-card"));
    const leads = Array.from(el.querySelectorAll<SVGGElement>(".ab-lead"));
    const leadsSvg = el.querySelector<SVGSVGElement>(".ab-leads")!;
    const scanName = el.querySelector<HTMLElement>(".ab-scan-name")!;
    const craftTag = el.querySelector<HTMLElement>(".ab-craft")!;
    const craftStatus = el.querySelector<HTMLElement>(".ab-craft-status")!;
    const works = el.querySelector<HTMLElement>(".ab-works")!;
    const hit = el.querySelector<HTMLElement>(".ab-globe-hit")!;
    const reticle = el.querySelector<HTMLElement>(".ab-reticle")!;
    const reticleText = el.querySelector<HTMLElement>(".ab-reticle-text")!;
    const drop = el.querySelector<HTMLElement>(".ab-drop")!;
    const dropText = el.querySelector<HTMLElement>(".ab-drop-coords")!;
    const reduce = window.matchMedia(MOTION_QUERIES.reduce);
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const lite = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;

    let world: World | null = null;
    let disposed = false;
    let width = 1;
    let height = 1;
    let panelLeft = 0;
    let panelTop = 0;
    const base = cards.map(() => [0, 0, 0, 0]);
    const measure = () => {
      width = panel.clientWidth;
      height = panel.clientHeight;
      const pr = panel.getBoundingClientRect();
      panelLeft = pr.left;
      panelTop = pr.top;
      // Where each lens sits with its own scroll animation taken out.
      cards.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        base[i] = [r.left - pr.left - Number(gsap.getProperty(c, "x")), r.top - pr.top - Number(gsap.getProperty(c, "y")), c.offsetWidth, c.offsetHeight];
      });
      leadsSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      world?.resize(width, height);
    };

    // ── State ──
    let smooth = -1;
    let shown = -1;
    let dipping = false;
    let lastP = -1;
    let lastChapter = -1;
    let time = 0;
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    let ppx = -999;
    let ppy = -999;
    let scale = 1;
    let acc = 0;
    let frames = 0;
    let frameNo = 0;
    let lastRaise = 0;
    // The lenses: which one the pointer (or focus) is on, which one was chosen with a click.
    let hoverLens = -1;
    let chosenLens = -1;
    let shownScan = -2;
    const hoverAmt = cards.map(() => 0);
    const activeAmt = cards.map(() => 0);
    const panes: Pane[] = cards.map(() => ({ x: 0, y: 0, w: 0, h: 0, a: 0, hover: 0, active: 0 }));
    // The planet in the finale.
    let dragging = false;
    let dragX = 0;
    let dragT = 0;
    let downX = 0;
    let downY = 0;
    let dropTimer = 0;
    // The satellite, turned by hand.
    let turning = false;
    let turnX = 0;
    let turnY = 0;
    let turnT = 0;
    let turnDownX = 0;
    let turnDownY = 0;
    let shownLit = -1;
    snapTo.current = (p) => {
      smooth = p;
    };

    // With reduced motion: no flights, a short fade through dark between chapters.
    const calmProgress = (t: number) => {
      const c = chapterAt(t);
      if (shown < 0) shown = c;
      if (c !== shown && !dipping) {
        dipping = true;
        dip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out", fill: "forwards" }).onfinish = () => {
          shown = chapterAt(target.current);
          dip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-out", fill: "forwards" }).onfinish = () => void (dipping = false);
        };
      }
      return CHAPTERS[shown].calm;
    };

    const hud = (p: number, r: Readout | null) => {
      if (p < BEAT.dive[0]) {
        hudLabel.textContent = "Lunar regolith → living Earth";
        hudValue.textContent = `${Math.round((r?.life ?? Math.min(1, p / 0.25)) * 100)}%`;
      } else if (p < BEAT.cut) {
        hudLabel.textContent = "Descent · Western Himalaya";
        hudValue.textContent = `${NUM.format(Math.round((r?.alt ?? 0) / 10) * 10)} km`;
      } else if (p < BEAT.down[1]) {
        hudLabel.textContent = `Over the cloud · ${p < 0.665 ? "Dusk" : p < 0.725 ? "Twilight" : "Night"}`;
        hudValue.textContent = `${NUM.format(Math.round((r?.alt ?? 4200) / 10) * 10)} m`;
      } else if (p < BEAT.port[0] + 0.012 || !r?.alt) {
        hudLabel.textContent = "Kullu Valley";
        hudValue.textContent = "32.24°N 77.19°E";
      } else {
        // The finale's day goes round: say which side of it is facing us.
        const side = !r || r.daylight > 0.3 ? "day side" : r.daylight < -0.3 ? "night side" : "twilight";
        hudLabel.textContent = p < BEAT.final ? "Pulling back to orbit" : `Live Earth · ${side}`;
        hudValue.textContent = `${NUM.format(Math.round((r?.alt ?? 0) / 10) * 10)} km`;
      }
    };

    // Leader lines from each lens to its spot where the beam lands.
    const drawLeads = (r: Readout, active: number) => {
      leads.forEach((g, i) => {
        const vis = r.anchors[i * 3 + 2];
        const a = panes[i].a;
        if (!vis || a < 0.01) {
          g.style.opacity = "0";
          return;
        }
        const ax = r.anchors[i * 3];
        const ay = r.anchors[i * 3 + 1];
        const rx = panes[i].x;
        const ry = panes[i].y;
        const rw = panes[i].w;
        const right = ax > rx + rw / 2;
        const sx = right ? rx + rw : rx;
        const sy = ry + 34;
        const ex = sx + (right ? 30 : -30);
        g.children[0].setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)}L${ex.toFixed(1)} ${sy.toFixed(1)}L${ax.toFixed(1)} ${ay.toFixed(1)}`);
        g.children[1].setAttribute("cx", ax.toFixed(1));
        g.children[1].setAttribute("cy", ay.toFixed(1));
        g.children[2].setAttribute("cx", ax.toFixed(1));
        g.children[2].setAttribute("cy", ay.toFixed(1));
        g.style.opacity = a.toFixed(3);
        g.dataset.active = String(i === active);
      });
    };

    // ── The loop ──
    let raf = 0;
    let running = false;
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
      last = now;
      frameNo++;
      const calm = reduce.matches;
      if (!calm) time += dt;
      const t = target.current;
      let p: number;
      if (calm) {
        p = calmProgress(t);
        smooth = p;
      } else {
        shown = -1;
        // The first frame lands where the page is (a reload or an anchor); after that, glide.
        smooth = smooth < 0 ? t : smooth + (t - smooth) * (1 - Math.exp(-dt * 4.2));
        if (Math.abs(t - smooth) < 2e-5) smooth = t;
        p = smooth;
      }

      if (Math.abs(p - lastP) > 1e-6) {
        timeline.current?.progress(p);
        fill.style.transform = `scaleY(${p.toFixed(4)})`;
        lastP = p;
      }
      const chapter = chapterAt(t);
      if (chapter !== lastChapter) {
        chips.forEach((c, i) => (i === chapter ? c.setAttribute("aria-current", "step") : c.removeAttribute("aria-current")));
        el.dataset.chapter = String(chapter);
        lastChapter = chapter;
      }

      if (fine && !calm) {
        px += (tx - px) * (1 - Math.exp(-dt * 2.6));
        py += (ty - py) * (1 - Math.exp(-dt * 2.6));
      } else {
        px = py = 0;
      }

      // Which lens the beam follows: the one under the pointer, else the one chosen, else the scroll's.
      const scan = p < 0.585 || p > 0.785 ? -1 : hoverLens >= 0 ? hoverLens : chosenLens >= 0 ? chosenLens : autoScan(p);
      if (scan !== shownScan) {
        cards.forEach((c, i) => (c.dataset.active = String(i === scan)));
        scanName.textContent = scan >= 0 ? `Scanning · ${LENSES[scan].scan}` : "";
        shownScan = scan;
      }

      let r: Readout | null = null;
      if (world && el.dataset.gl === "on") {
        if (frameNo % 30 === 0 && world.lost()) el.dataset.gl = "lost";
        const glass = p > 0.55 && p < 0.82;
        const k = 1 - Math.exp(-dt * 9);
        cards.forEach((c, i) => {
          const g = panes[i];
          hoverAmt[i] += ((hoverLens === i ? 1 : 0) - hoverAmt[i]) * k;
          activeAmt[i] += ((scan === i ? 1 : 0) - activeAmt[i]) * k;
          g.a = glass ? Number(gsap.getProperty(c, "opacity")) : 0;
          g.hover = calm ? (hoverLens === i ? 1 : 0) : hoverAmt[i];
          g.active = activeAmt[i];
          if (!g.a) return;
          const b = base[i];
          g.x = b[0] + Number(gsap.getProperty(c, "x"));
          g.y = b[1] + Number(gsap.getProperty(c, "y"));
          g.w = b[2];
          g.h = b[3];
        });
        r = world.frame({ p, time, dt, calm, pointer: [px, py], pointerPx: [ppx, ppy], panes, paneRadius: 20, scan, dragging, turning });
        if (glass) drawLeads(r, scan);
        // The satellite's tag rides just above it.
        const tag = glass ? r.craft[2] : 0;
        craftTag.style.opacity = tag.toFixed(3);
        if (tag > 0) craftTag.style.transform = `translate3d(${r.craft[0].toFixed(1)}px, ${r.craft[1].toFixed(1)}px, 0)`;
        // After sunset it stays in sunlight a while (it's higher than the cloud), until the
        // Earth's shadow climbs over it.
        const lit = r.craftLit > 0.5 ? 1 : 0;
        if (lit !== shownLit) {
          craftTag.dataset.lit = String(!!lit);
          craftStatus.textContent = lit ? "705 km · in sunlight" : "705 km · in the Earth’s shadow";
          shownLit = lit;
        }
        // Chandigarh: where life starts, and where the story ends up again.
        const show = Math.max(r.pin[2] * (1 - span(p, 0.07, 0.12)), r.pin[2] * span(p, BEAT.final - 0.005, BEAT.final + 0.015));
        pin.style.opacity = show.toFixed(3);
        if (show > 0) pin.style.transform = `translate3d(${r.pin[0].toFixed(1)}px, ${r.pin[1].toFixed(1)}px, 0)`;
        // A dropped pin's label rides round with the planet, and steps back as it turns away.
        if (drop.dataset.on === "true") {
          drop.style.transform = `translate3d(${r.drop[0].toFixed(1)}px, ${r.drop[1].toFixed(1)}px, 0)`;
          drop.style.opacity = r.drop[2].toFixed(3);
          drop.style.pointerEvents = r.drop[2] > 0.5 ? "" : "none";
        }
        // The finale's planet takes the pointer where it is on screen.
        const [gx, gy, gr] = r.globe;
        if (gr > 0) {
          hit.style.transform = `translate3d(${(gx - 100).toFixed(1)}px, ${(gy - 100).toFixed(1)}px, 0) scale(${(gr / 100).toFixed(4)})`;
          if (!el.dataset.final) el.dataset.final = "on";
        } else if (el.dataset.final) {
          delete el.dataset.final;
          world.clearAim();
          reticle.dataset.on = "false";
          drop.dataset.on = "false";
        }
        // Quality: the GPU's cost shows up as the time between frames. Below ~50 fps, render
        // fewer pixels (the clouds first of all); give them back when there's clear headroom.
        acc += Math.min(dt, 0.1);
        if (++frames >= 60) {
          const avg = (acc / frames) * 1000;
          if (avg > 20 && scale > 0.55) world.setScale((scale *= 0.85));
          else if (avg < 12.5 && scale < 1 && now - lastRaise > 4000) {
            world.setScale((scale = Math.min(1, scale / 0.9)));
            lastRaise = now;
          }
          acc = 0;
          frames = 0;
        }
      } else if (world && el.dataset.gl === "lost" && !world.lost()) {
        el.dataset.gl = "on";
      }
      if (frameNo % 4 === 0) hud(p, r);
    };
    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // ── The world, loaded after first paint so the words never wait for it ──
    import("./world/engine")
      .then(({ createWorld }) => {
        if (disposed) return;
        world = createWorld(canvas, { lite, budget: lite ? 1.4e6 : 3.2e6 });
        if (!world) {
          el.dataset.gl = "off";
          return;
        }
        world.resize(width, height);
        world.ready.then(
          () => void (!disposed && (el.dataset.gl = "on")),
          () => void (!disposed && (el.dataset.gl = "off")),
        );
      })
      .catch(() => void (el.dataset.gl = "off"));

    measure();
    let first = true;
    const ro = new ResizeObserver(() => {
      measure();
      if (first) return void (first = false);
      // Sizes the words were animated with may have changed.
      const tl = timeline.current;
      if (tl && lastP >= 0) tl.invalidate().progress(1).progress(0).progress(lastP);
    });
    ro.observe(panel);
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { rootMargin: "80px 0px" });
    io.observe(stage.current!);
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = -((e.clientY / window.innerHeight) * 2 - 1);
      ppx = e.clientX - panelLeft;
      ppy = e.clientY - panelTop;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    // Tabbing into a chapter that isn't showing brings it in.
    const onFocus = (e: FocusEvent) => {
      const ch = (e.target as HTMLElement).closest<HTMLElement>("[data-ch]");
      if (!ch) return;
      const i = Number(ch.dataset.ch);
      if (chapterAt(target.current) !== i) scrollToRest(i, true);
    };
    el.addEventListener("focusin", onFocus);

    // The lenses: hover or focus one to see the cloud its way; click to keep it.
    const lensOff: (() => void)[] = [];
    cards.forEach((c, i) => {
      const enter = () => void (hoverLens = i);
      const leave = () => void (hoverLens === i && (hoverLens = -1));
      const click = () => {
        chosenLens = chosenLens === i ? -1 : i;
        cards.forEach((o, j) => o.setAttribute("aria-pressed", String(j === chosenLens)));
      };
      c.addEventListener("pointerenter", enter);
      c.addEventListener("pointerleave", leave);
      c.addEventListener("focus", enter);
      c.addEventListener("blur", leave);
      c.addEventListener("click", click);
      lensOff.push(() => {
        c.removeEventListener("pointerenter", enter);
        c.removeEventListener("pointerleave", leave);
        c.removeEventListener("focus", enter);
        c.removeEventListener("blur", leave);
        c.removeEventListener("click", click);
      });
    });

    // The satellite: drag it to spin it (it coasts on), tap it to make its beam flare. The chapter
    // takes the pointer while it shows; only presses on the craft itself are ours.
    const onCraft = (e: PointerEvent) =>
      !!world && !(e.target as HTMLElement).closest(".ab-lens-card") && world.pickCraft(e.clientX - panelLeft, e.clientY - panelTop);
    const onTurnDown = (e: PointerEvent) => {
      if (e.button > 0 || !onCraft(e)) return;
      // No text selection while it's being turned.
      e.preventDefault();
      turning = true;
      turnX = turnDownX = e.clientX;
      turnY = turnDownY = e.clientY;
      turnT = performance.now();
      works.setPointerCapture(e.pointerId);
      works.dataset.turn = "grab";
    };
    const onTurnMove = (e: PointerEvent) => {
      if (turning && world) {
        const now = performance.now();
        world.turnCraft(e.clientX - turnX, e.clientY - turnY, now - turnT);
        turnX = e.clientX;
        turnY = e.clientY;
        turnT = now;
      } else if (e.pointerType === "mouse") {
        const over = onCraft(e);
        if (over !== (works.dataset.turn === "over")) works.dataset.turn = over ? "over" : "";
      }
    };
    const onTurnUp = (e: PointerEvent) => {
      if (!turning) return;
      turning = false;
      works.dataset.turn = e.pointerType === "mouse" ? "over" : "";
      if (Math.hypot(e.clientX - turnDownX, e.clientY - turnDownY) < 6) world?.tapCraft();
    };
    const onTurnCancel = () => {
      turning = false;
      works.dataset.turn = "";
    };
    works.addEventListener("pointerdown", onTurnDown);
    works.addEventListener("pointermove", onTurnMove);
    works.addEventListener("pointerup", onTurnUp);
    works.addEventListener("pointercancel", onTurnCancel);
    works.addEventListener("pointerleave", onTurnCancel);

    // The planet: drag to turn it; hover to read where you are; tap to drop a pin there.
    const local = (e: PointerEvent) => [e.clientX - panelLeft, e.clientY - panelTop] as const;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      dragX = downX = e.clientX;
      downY = e.clientY;
      dragT = performance.now();
      hit.setPointerCapture(e.pointerId);
      hit.dataset.drag = "true";
    };
    const onHitMove = (e: PointerEvent) => {
      if (!world) return;
      const [x, y] = local(e);
      if (dragging) {
        const now = performance.now();
        world.spinBy(e.clientX - dragX, now - dragT);
        dragX = e.clientX;
        dragT = now;
      }
      if (e.pointerType === "mouse") {
        const at = world.aim(x, y);
        reticle.dataset.on = String(!!at);
        if (at) {
          reticle.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          reticleText.textContent = coords(at.lat, at.lon);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!world) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      dragging = false;
      hit.dataset.drag = "false";
      if (moved < 6) {
        const [x, y] = local(e);
        const at = world.tap(x, y);
        if (at) {
          dropText.textContent = coords(at.lat, at.lon);
          drop.dataset.on = "true";
          window.clearTimeout(dropTimer);
          dropTimer = window.setTimeout(() => void (drop.dataset.on = "false"), 9000);
        }
      }
    };
    const onLeave = () => {
      world?.clearAim();
      reticle.dataset.on = "false";
    };
    const onCancel = () => {
      dragging = false;
      hit.dataset.drag = "false";
    };
    hit.addEventListener("pointerdown", onDown);
    hit.addEventListener("pointermove", onHitMove);
    hit.addEventListener("pointerup", onUp);
    hit.addEventListener("pointerleave", onLeave);
    hit.addEventListener("pointercancel", onCancel);

    return () => {
      disposed = true;
      stop();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      el.removeEventListener("focusin", onFocus);
      lensOff.forEach((f) => f());
      works.removeEventListener("pointerdown", onTurnDown);
      works.removeEventListener("pointermove", onTurnMove);
      works.removeEventListener("pointerup", onTurnUp);
      works.removeEventListener("pointercancel", onTurnCancel);
      works.removeEventListener("pointerleave", onTurnCancel);
      hit.removeEventListener("pointerdown", onDown);
      hit.removeEventListener("pointermove", onHitMove);
      hit.removeEventListener("pointerup", onUp);
      hit.removeEventListener("pointerleave", onLeave);
      hit.removeEventListener("pointercancel", onCancel);
      window.clearTimeout(dropTimer);
      world?.dispose();
    };
  }, []);

  const words = MANIFESTO.split(" ");

  return (
    <div ref={root} className="ab" data-gl="wait" data-chapter="0">
      <section ref={stage} className="ab-stage" aria-label="About Longitude" data-nav-clear="full">
        {CHAPTERS.map((c) => (
          <span key={c.id} id={c.id} className="ab-anchor" style={{ "--at": c.rest } as React.CSSProperties} aria-hidden="true" />
        ))}
        <div className="ab-view">
          <div className="ab-panel">
            <div className="ab-poster" aria-hidden="true" />
            <canvas className="ab-canvas" aria-hidden="true" />
            <div className="ab-scrim" aria-hidden="true" />
            <div className="ab-loading hud" aria-hidden="true">
              <span />
              Bringing the moon round
            </div>
            <div className="ab-pin" aria-hidden="true">
              <i />
              <span>
                <b>Chandigarh</b> Where Longitude began
              </span>
            </div>

            {/* 01 · Live Earth */}
            <div className="ab-ch ab-hero" data-ch="0">
              <div className="ab-hero-copy">
                <p className="ab-pill ab-hi hud" style={{ "--i": 0 } as React.CSSProperties}>
                  About Longitude
                </p>
                <h1 className="ab-h1">
                  {["A travel desk", "on a live", "Earth"].map((line, i) => (
                    <span key={line} className="ab-line">
                      <span style={{ "--i": i + 1 } as React.CSSProperties}>{line}</span>
                    </span>
                  ))}
                </h1>
                <button type="button" className="ab-more ab-hi" style={{ "--i": 4 } as React.CSSProperties} onClick={() => scrollToRest(1)}>
                  <span className="ab-more-mark">
                    <LogoMark className="h-5 w-5" />
                  </span>
                  <span className="hud">Find out more</span>
                  <ArrowDown size={13} weight="bold" aria-hidden />
                </button>
              </div>
              <div className="ab-hero-base">
                <p className="ab-hero-foot ab-hi" style={{ "--i": 5 } as React.CSSProperties}>
                  We started Longitude in Chandigarh because planning a trip on flat lists never showed us how far, how high or how close things really are.
                </p>
              </div>
            </div>

            {/* 02 · Our story */}
            <div className="ab-ch ab-story" data-ch="1">
              <div className="ab-story-in">
                <p className="ab-pills">
                  <span className="ab-pill ab-pill-on hud">Our story</span>
                  <span className="ab-pill hud">Chandigarh studio</span>
                </p>
                <h2 className="ab-mf" aria-label={MANIFESTO}>
                  {words.map((w, i) => (
                    <span key={i} className="ab-w" aria-hidden="true">
                      {w}{" "}
                    </span>
                  ))}
                </h2>
              </div>
              <figure className="ab-story-side ab-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/about/valley.webp" alt="The Kullu valley in the western Himalaya, a few hours north of our studio" width={2400} height={1170} loading="lazy" decoding="async" />
              </figure>
              <p className="ab-story-side ab-caption">
                Planned in Chandigarh, at the foot of the Himalaya. Every tour starts as a line on the globe, and ends with someone standing where the line ends.
              </p>
            </div>

            {/* 03 · How it works */}
            <div className="ab-ch ab-works" data-ch="2">
              <h2 className="ab-wordmark" aria-label="How the 3D Earth works">
                <span aria-hidden="true">Longitude</span>
              </h2>
              <div className="ab-craft" aria-hidden="true" data-lit="true">
                <i />
                <span>
                  <b>Landsat 8</b>
                  <small className="ab-craft-status">705 km · in sunlight</small>
                  <em>Drag to spin it</em>
                </span>
              </div>
              <svg className="ab-leads" aria-hidden="true">
                {LENSES.map((l) => (
                  <g key={l.tag} className="ab-lead">
                    <path />
                    <circle r="3.2" />
                    <circle r="9" className="ab-lead-ring" />
                  </g>
                ))}
              </svg>
              <ul className="ab-lenses">
                {LENSES.map(({ tag, Icon, title, text, scan }, i) => (
                  <li key={tag} className={`ab-lens ab-lens-${i}`}>
                    <button type="button" className="ab-lens-card" aria-pressed="false" data-active="false" aria-label={`${title}: ${text} Shows the satellite’s ${scan.toLowerCase()} on the cloud below.`}>
                      <span className="ab-lens-top" aria-hidden="true">
                        <Icon size={18} weight="light" />
                        <span className="hud">
                          0{i + 1} · {tag}
                        </span>
                        <span className="ab-lens-scan hud">{scan}</span>
                      </span>
                      <span className="ab-lens-title" aria-hidden="true">
                        {title}
                      </span>
                      <span className="ab-lens-text" aria-hidden="true">
                        {text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ab-works-foot">
                <p className="ab-scan-name hud" aria-live="polite" />
                <p className="ab-also hud">Hover a lens to see the cloud the way the site sees the world · Also: NASA Blue Marble &amp; VIIRS, GSAP, Next.js, PostgreSQL</p>
              </div>
            </div>

            {/* 04 · Arrive */}
            <div className="ab-ch ab-arrive" data-ch="3">
              <h2 className="sr-only">Plan a trip with us</h2>
              <p className="ab-arrived">
                <span className="hud">You’ve arrived</span>
                <span className="ab-arrived-place">Kullu Valley</span>
                <span className="hud">32.24°N 77.19°E · 2,050 m</span>
              </p>
              <div className="ab-globe-hit" aria-hidden="true" data-drag="false" />
              <div className="ab-reticle" aria-hidden="true" data-on="false">
                <svg viewBox="0 0 40 40">
                  <path d="M2 12V2h10M28 2h10v10M38 28v10H28M12 38H2V28" />
                </svg>
                <span className="ab-reticle-text hud" />
              </div>
              <div className="ab-drop" data-on="false" role="status" aria-live="polite">
                <i aria-hidden="true" />
                <span className="ab-drop-coords hud" />
                <ExploreLink className="ab-drop-go hud">
                  Plan a trip here <ArrowUpRight size={11} weight="bold" aria-hidden />
                </ExploreLink>
              </div>
              <div className="ab-final">
                <p className="ab-earth" aria-label="Earth.">
                  {"Earth.".split("").map((ch, i) => (
                    <span key={i} className="ab-earth-l" aria-hidden="true">
                      <span>{ch}</span>
                    </span>
                  ))}
                </p>
                <p className="ab-final-lead ab-final-rise">Plan your next trip from orbit.</p>
                <p className="ab-final-hint ab-final-rise hud">Drag the planet to turn it · tap anywhere to drop a pin</p>
                <ExploreLink className="ab-final-cta ab-final-rise">
                  <span className="hud">Plan on the globe</span>
                  <span className="ab-final-cta-icon">
                    <ArrowUpRight size={14} weight="bold" aria-hidden />
                  </span>
                </ExploreLink>
              </div>
              <div className="ab-dock">
                <div className="ab-dock-mark">
                  <LogoMark className="h-[18px] w-[18px]" />
                  <address>
                    SCO 214, Sector 35-C, Chandigarh 160022
                    <span>Mon–Sat · 10:00–19:00 IST</span>
                  </address>
                </div>
                <a className="ab-dock-link hud" href="tel:+911724602291">
                  +91 172 460 2291
                </a>
                <div className="ab-dock-bar">
                  <a href="mailto:trips@longitude.example">trips@longitude.example</a>
                  <a className="ab-dock-go hud" href="mailto:trips@longitude.example?subject=Planning%20a%20trip">
                    Talk to a planner
                  </a>
                </div>
              </div>
            </div>

            <nav className="ab-rail" aria-label="About chapters">
              <span className="ab-rail-track" aria-hidden="true">
                <i className="ab-rail-fill" />
              </span>
              <ol>
                {CHAPTERS.map((c, i) => (
                  <li key={c.id}>
                    <button type="button" className="ab-chip" aria-current={i === 0 ? "step" : undefined} onClick={() => scrollToRest(i)}>
                      <span className="ab-chip-label hud">{c.label}</span>
                      <span className="ab-chip-n hud">0{i + 1}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <p className="ab-hud" aria-live="off">
              <span className="ab-hud-label hud">Lunar regolith → living Earth</span>
              <span className="ab-hud-value">0%</span>
            </p>
            <div className="ab-dip" aria-hidden="true" />
          </div>
        </div>
      </section>
    </div>
  );
}
