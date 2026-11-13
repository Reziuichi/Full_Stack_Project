"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Cube } from "@phosphor-icons/react";
import type { Attraction } from "@/lib/types";
import type { LoadedDestination } from "@/features/destinations/destinationService";
import { formatCoordinates } from "@/lib/geo";
import { PLANE_PATH } from "@/features/globe/route/plane";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { scrambleText } from "@/lib/textFx";
import { OutroGlobe } from "./OutroGlobe";
import { constellation, hashSeed, skyStars } from "./storySky";

// Scroll choreography, in timeline units (one unit ≈ VH_PER_UNIT of scrolling).
const TITLE_HOLD = 0.45; // the destination name, photo showing through the letters
const ZOOM = 1; // zoom through the word into the full-screen photo
const SETTLE = 1; // the photo settles into its plate; rail and copy arrive
const STEP = 1; // one landmark
const OUTRO = 1.9; // night falls: the last photo flies off and becomes a star
const TAIL = 0.35;
const VH_PER_UNIT = 62;
/** Share of a step spent transitioning (the rest holds still for reading). */
const TRANSITION = 0.6;
/** Shutter slats per photo. */
const SLATS = 6;
/** Stars in the outro's sky (every other one is dropped on small screens). */
const SKY_STARS = 150;

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Index numerals roll like an odometer: tens and ones are separate columns. */
const tensOf = (i: number) => Math.floor((i + 1) / 10);
/** Catalogue copy may use long dashes; the UI sticks to plain punctuation. */
const plain = (s: string) => s.replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, "-");
const cssUrl = (u: string) => `url("${u.replace(/"/g, "%22")}")`;

/**
 * Destination story: a pinned, scroll-scrubbed sequence. The destination's
 * name opens as a window onto the city; scrolling flies through it into a
 * photo plate that then changes landmark by landmark (shutter transitions)
 * beside giant rolling index numerals and mask-revealed names. Hovering the
 * plate tilts it toward the cursor with parallax and a moving glare.
 * Everything animates transform and opacity only.
 */
export function DestinationStory({
  data,
  attractions,
  tourCount,
  onView,
}: {
  data: LoadedDestination;
  attractions: Attraction[];
  tourCount: number;
  onView: (index: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const d = data.destination;
  const n = attractions.length;
  const hero = d.heroImage || attractions[0]?.imageUrl || "";
  const tensDigits = Array.from(new Set(attractions.map((_, i) => tensOf(i))));
  const seed = hashSeed(d.slug);
  const sky = useMemo(() => skyStars(seed, SKY_STARS), [seed]);
  const stars = useMemo(() => constellation(attractions, seed), [attractions, seed]);

  const settleAt = TITLE_HOLD + ZOOM * 0.55;
  const settleEnd = settleAt + SETTLE;
  const outroAt = settleEnd + (n - 1) * STEP + 0.15;
  const total = outroAt + OUTRO + TAIL;
  const stepAt = useCallback((k: number) => settleEnd + (k - 1) * STEP, [settleEnd]);

  // -1 intro · 0..n-1 landmark · n outro.
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const outroDecode = useRef<gsap.core.Tween | null>(null);
  const outroShown = useRef(false);
  const skyRef = useRef<HTMLDivElement>(null);
  const skyOn = useRef(false);

  const track = useCallback(
    (progress: number) => {
      const unit = progress * total;
      // The sky's twinkling only runs while it can be seen.
      const sky = unit >= outroAt - 0.1;
      if (sky !== skyOn.current) {
        skyOn.current = sky;
        skyRef.current?.toggleAttribute("data-on", sky);
      }
      const showOutro = unit >= outroAt + 1.05;
      if (showOutro !== outroShown.current) {
        outroShown.current = showOutro;
        if (showOutro) outroDecode.current?.restart();
        else outroDecode.current?.pause(0);
      }
      let next: number;
      if (unit >= outroAt + 0.3) next = n;
      else if (unit < settleAt + 0.5) next = -1;
      else if (unit < settleEnd) next = 0;
      else next = Math.min(n - 1, Math.floor((unit - settleEnd - TRANSITION / 2) / STEP) + 1);
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
    },
    [n, outroAt, settleAt, settleEnd, total],
  );

  /** Scroll to where landmark `k` is fully shown. */
  const jumpTo = useCallback(
    (k: number) => {
      const el = root.current;
      if (!el) return;
      const unit = k === 0 ? settleEnd - 0.05 : stepAt(k) + TRANSITION + 0.1;
      const top = el.getBoundingClientRect().top + window.scrollY + (unit / total) * (el.offsetHeight - window.innerHeight);
      gsap.to(window, { scrollTo: top, duration: 1.1, ease: "power3.inOut" });
    },
    [settleEnd, stepAt, total],
  );

  useGSAP(
    () => {
      const el = root.current;
      if (!el || n === 0) return;
      const all = (s: string, scope: Element = el) => gsap.utils.toArray<HTMLElement>(`[data-s="${s}"]`, scope);
      const one = (s: string) => all(s)[0];
      const viewport = one("viewport");
      const plate = one("plate");
      const layers = all("layer"); // [hero?, ...attractions]
      const heroLayer = layers.find((l) => l.dataset.hero === "true");
      const photoLayers = layers.filter((l) => l.dataset.hero !== "true");
      const slatsOf = (layer: HTMLElement) => all("slat", layer);
      const names = all("name");
      const groups = all("group");
      const ticks = all("tick");

      // Layout box relative to the pinned viewport (ignores transforms).
      const box = (node: HTMLElement) => {
        let x = 0;
        let y = 0;
        let cur: HTMLElement | null = node;
        while (cur && cur !== viewport) {
          x += cur.offsetLeft;
          y += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        return { x, y, w: node.offsetWidth, h: node.offsetHeight };
      };
      // Plate transform that fills the whole screen with it (for the zoom-through).
      const cover = () => {
        const b = box(plate);
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        return { x: vw / 2 - (b.x + b.w / 2), y: vh / 2 - (b.y + b.h / 2), scale: Math.max(vw / b.w, vh / b.h) * 1.04 };
      };
      const rowH = () => one("index-row")?.offsetHeight ?? 0;
      const tickY = (k: number) => (ticks[k] ? box(ticks[k]).y + ticks[k].offsetHeight / 2 : 0);
      const nameBox = () => one("names")?.offsetHeight ?? 0;

      const mm = gsap.matchMedia();
      mm.add({ ...MOTION_QUERIES, hover: "(hover: hover) and (pointer: fine)" }, (context) => {
        const full = Boolean(context.conditions?.full);
        const canHover = Boolean(context.conditions?.hover) && full;
        const move = (px: number) => (full ? px : 0);

        const titleIn = gsap.fromTo(
          one("title-word"),
          { yPercent: full ? 105 : 0, opacity: full ? 1 : 0 },
          { yPercent: 0, opacity: 1, duration: 1.3, ease: "expo.out", paused: true },
        );
        const subIn = gsap.fromTo(one("title-sub"), { opacity: 0, y: move(16) }, { opacity: 1, y: 0, duration: 1, ease: "expo.out", delay: 0.35, paused: true });
        const outroTitle = scrambleText(one("outro-title"), { duration: 1.1, paused: true });
        outroDecode.current = outroTitle.tween;
        outroShown.current = false;

        // The rail's airplane faces the way you are scrolling: nose down going
        // forward, turning around smoothly when you scroll back up.
        const planeDir = one("plane-dir");
        let heading = 1;
        const turn = (direction: number) => {
          if (!direction || direction === heading) return;
          heading = direction;
          gsap.to(planeDir, { rotation: direction > 0 ? 0 : 180, duration: 0.7, ease: "power3.inOut", overwrite: true });
        };

        // ── Base state ──────────────────────────────────────────────────────
        // Photos wait behind their slats; the first shows through if there is no hero.
        photoLayers.forEach((layer, i) => {
          const shown = i === 0 && !heroLayer;
          if (full) gsap.set(slatsOf(layer), { yPercent: (j: number) => (shown ? 0 : j % 2 ? -101 : 101) });
          else gsap.set(layer, { opacity: shown ? 1 : 0 });
        });
        gsap.set(names, { y: () => nameBox() + 8, opacity: full ? 1 : 0 });
        gsap.set(groups, { opacity: 0, y: move(16) });

        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom bottom",
            scrub: full ? 0.8 : true,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              track(self.progress);
              turn(self.direction);
            },
            onRefresh: (self) => track(self.progress),
          },
        });
        // The title rises in on its own clock as the section scrolls into view
        // (before it pins), and resets once the section is below the fold again.
        gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: "top 78%",
            onEnter: () => {
              titleIn.restart();
              subIn.restart();
            },
            onLeaveBack: () => {
              titleIn.pause(0);
              subIn.pause(0);
            },
          },
        });
        if (el.getBoundingClientRect().top < window.innerHeight * 0.78) {
          titleIn.progress(1);
          subIn.progress(1);
        }

        // ── Zoom through the name into the photo ────────────────────────────
        tl.to(one("title"), { scale: full ? 3.6 : 1, opacity: 0, duration: ZOOM, ease: "power2.in", transformOrigin: "32% 50%" }, TITLE_HOLD)
          .fromTo(plate, { opacity: 0 }, { opacity: 1, duration: ZOOM * 0.35, ease: "none" }, TITLE_HOLD + ZOOM * 0.3)
          .fromTo(
            plate,
            full ? { x: () => cover().x, y: () => cover().y, scale: () => cover().scale } : { x: 0, y: 0, scale: 1 },
            { x: 0, y: 0, scale: 1, duration: SETTLE, ease: "power3.inOut" },
            settleAt,
          )
          .fromTo(one("rail"), { opacity: 0, x: move(-24) }, { opacity: 1, x: 0, duration: SETTLE * 0.6, ease: "power3.out" }, settleAt + 0.4)
          .fromTo(one("copy"), { opacity: 0, x: move(60) }, { opacity: 1, x: 0, duration: SETTLE * 0.6, ease: "power3.out" }, settleAt + 0.35)
          .to(names[0], { y: 0, opacity: 1, duration: SETTLE * 0.55, ease: "power4.out" }, settleAt + 0.45)
          .to(groups[0], { opacity: 1, y: 0, duration: SETTLE * 0.5, ease: "power3.out" }, settleAt + 0.55);
        if (heroLayer) {
          // Hero → first landmark through the shutter.
          if (full) {
            tl.to(slatsOf(photoLayers[0]), { yPercent: 0, duration: 0.4, stagger: 0.05, ease: "power3.inOut" }, settleAt + 0.55).to(
              heroLayer,
              { scale: 1.08, duration: 0.6 },
              settleAt + 0.55,
            );
          } else tl.to(photoLayers[0], { opacity: 1, duration: 0.5 }, settleAt + 0.55);
        }

        // ── One step per landmark ───────────────────────────────────────────
        for (let k = 1; k < n; k++) {
          const at = stepAt(k);
          const w = STEP * TRANSITION;
          if (full) {
            tl.to(slatsOf(photoLayers[k]), { yPercent: 0, duration: w * 0.55, stagger: w * 0.075, ease: "power3.inOut" }, at).to(
              photoLayers[k - 1],
              { scale: 1.08, duration: w },
              at,
            );
          } else {
            tl.to(photoLayers[k], { opacity: 1, duration: w }, at);
          }
          if (tensOf(k) !== tensOf(k - 1)) {
            const row = tensDigits.indexOf(tensOf(k));
            tl.to(one("index-tens"), { y: () => -row * rowH(), duration: w, ease: "power3.inOut" }, at);
          }
          tl.to(one("index-col"), { y: () => -k * rowH(), duration: w, ease: "power3.inOut" }, at)
            .to(names[k - 1], { y: () => -nameBox() - 8, opacity: full ? 1 : 0, duration: w * 0.7, ease: "power3.in" }, at)
            .to(names[k], { y: 0, opacity: 1, duration: w * 0.7, ease: "power4.out" }, at + w * 0.3)
            .to(groups[k - 1], { opacity: 0, y: move(-12), duration: w * 0.4, ease: "power2.in" }, at)
            .to(groups[k], { opacity: 1, y: 0, duration: w * 0.5, ease: "power3.out" }, at + w * 0.45)
            .to(one("node"), { y: () => tickY(k) - tickY(0), duration: w, ease: "power3.inOut" }, at)
            .to(one("progress"), { scaleY: k / Math.max(1, n - 1), duration: w, ease: "power3.inOut" }, at);
        }

        // ── Outro: night falls ──────────────────────────────────────────────
        // The camera pulls back into a night sky, the last photo flies off
        // and becomes a star, and the landmarks light up as a constellation
        // drawn in the order you visited them. Then the globe emblem.
        const cStars = all("c-star");
        const cLines = all("c-line");
        const lastStar = cStars[cStars.length - 1];
        const toStar = () => {
          const s = box(lastStar);
          const b = box(plate);
          return { x: s.x - (b.x + b.w / 2), y: s.y - (b.y + b.h / 2) };
        };
        const O = outroAt;
        tl.to(one("copy"), { opacity: 0, x: move(40), duration: 0.5, ease: "power2.in" }, O)
          .to(one("rail"), { opacity: 0, duration: 0.4 }, O)
          .to(one("spot"), { opacity: 0, duration: 0.6 }, O)
          .fromTo(one("sky"), { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power1.out" }, O + 0.05)
          .fromTo(one("sky-field"), { scale: full ? 1.18 : 1 }, { scale: 1, duration: 1.5, ease: "power2.out" }, O + 0.05);
        if (full) {
          tl.to(plate, { x: () => toStar().x, y: () => toStar().y, scale: 0.02, rotation: -8, duration: 0.8, ease: "power3.inOut" }, O + 0.1).to(
            plate,
            { opacity: 0, duration: 0.12, ease: "none" },
            O + 0.78,
          );
        } else {
          tl.to(plate, { opacity: 0, duration: 0.5 }, O + 0.1);
        }
        const earlier = cStars.slice(0, -1);
        if (earlier.length) {
          tl.fromTo(earlier, { opacity: 0, scale: full ? 0.3 : 1 }, { opacity: 1, scale: 1, duration: 0.3, stagger: 0.07, ease: "back.out(2)" }, O + 0.4);
        }
        tl.fromTo(lastStar, { opacity: 0, scale: full ? 0.3 : 1 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, O + 0.84)
          .fromTo(one("c-flare"), { opacity: 0, scale: 0.4 }, { opacity: 1, scale: full ? 1.5 : 1, duration: 0.14, ease: "power2.out" }, O + 0.84)
          .to(one("c-flare"), { opacity: 0, scale: full ? 0.9 : 1, duration: 0.35, ease: "power2.inOut" }, O + 0.98);
        cLines.forEach((line, i) => {
          const at = O + 0.5 + i * 0.12;
          if (full) {
            const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((a) => Number(line.getAttribute(a)));
            tl.fromTo(line, { attr: { x2: x1, y2: y1 }, opacity: 1 }, { attr: { x2, y2 }, opacity: 1, duration: 0.16, ease: "power1.inOut" }, at);
          } else {
            tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.2 }, at);
          }
        });
        tl.fromTo(
          one("outro-globe"),
          { opacity: 0, scale: full ? 0.7 : 1, y: move(14) },
          { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" },
          O + 0.95,
        )
          .fromTo(one("outro-title"), { opacity: 0 }, { opacity: 1, duration: 0.2 }, O + 1.05)
          .fromTo(one("outro-sub"), { opacity: 0, y: move(14) }, { opacity: 1, y: 0, duration: 0.4 }, O + 1.2)
          .to({}, { duration: Math.max(0, total - tl.duration()) });

        // ── Hover: the plate pops toward the cursor ─────────────────────────
        let unhover = () => {};
        if (canHover) {
          const tilt = one("tilt");
          const par = one("parallax");
          const glare = one("glare");
          const fx = all("hover-fx", plate);
          const quick = (target: HTMLElement, prop: string, duration = 0.8) => gsap.quickTo(target, prop, { duration, ease: "power3.out" });
          const rx = quick(tilt, "rotationX");
          const ry = quick(tilt, "rotationY");
          const px = quick(par, "x", 1);
          const py = quick(par, "y", 1);
          const gx = quick(glare, "x", 0.5);
          const gy = quick(glare, "y", 0.5);
          const live = () => activeRef.current >= 0 && activeRef.current < n;
          let lifted = false;
          const onMove = (e: PointerEvent) => {
            if (!live()) return;
            if (!lifted) {
              lifted = true;
              lift(true);
            }
            const r = plate.getBoundingClientRect();
            const nx = (e.clientX - r.left) / r.width - 0.5;
            const ny = (e.clientY - r.top) / r.height - 0.5;
            rx(-ny * 10);
            ry(nx * 12);
            px(-nx * 28);
            py(-ny * 22);
            gx(nx * r.width);
            gy(ny * r.height);
          };
          // Lift + zoom on enter/leave (scale is set once, the tilt follows the cursor).
          const lift = (on: boolean) => {
            gsap.to(tilt, { scale: on ? 1.045 : 1, duration: 0.8, ease: "power3.out", overwrite: "auto" });
            gsap.to(par, { scale: on ? 1.07 : 1, duration: 1, ease: "power3.out", overwrite: "auto" });
            gsap.to(fx, { opacity: on ? 1 : 0, duration: on ? 0.45 : 0.6, ease: "power2.out", overwrite: "auto" });
          };
          const onLeave = () => {
            lifted = false;
            rx(0);
            ry(0);
            px(0);
            py(0);
            lift(false);
          };
          plate.addEventListener("pointermove", onMove);
          plate.addEventListener("pointerleave", onLeave);
          unhover = () => {
            plate.removeEventListener("pointermove", onMove);
            plate.removeEventListener("pointerleave", onLeave);
          };
        }

        return () => {
          unhover();
          titleIn.kill();
          subIn.kill();
          outroTitle.tween.kill();
          outroTitle.restore();
          outroDecode.current = null;
        };
      });
    },
    { scope: root, dependencies: [n], revertOnUpdate: true },
  );

  if (n === 0) return null;

  return (
    <div ref={root} className="relative" style={{ height: `calc(100dvh + ${Math.round(total * VH_PER_UNIT)}vh)` }}>
      <div data-s="viewport" className="sticky top-0 h-[100dvh] overflow-hidden">
        <div data-s="spot" className="story-spot" aria-hidden />

        {/* Title card: the destination's name as a window onto the city */}
        <div data-s="title" className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-center px-4 sm:px-6 lg:px-12">
          <div className="overflow-hidden pb-[0.04em]">
            <h2
              id="dossier-title"
              data-s="title-word"
              className="story-title"
              style={{ "--chars": d.name.length, "--title-img": hero ? cssUrl(hero) : "none" } as CSSProperties}
            >
              {d.name}
            </h2>
          </div>
          <p data-s="title-sub" className="mt-4 max-w-[46ch] text-base leading-relaxed text-dim md:text-lg">
            {plain(d.tagline || d.summary)}
          </p>
        </div>

        {/* Stage */}
        <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-5 px-4 pb-6 pt-20 sm:px-6 lg:grid lg:grid-cols-[minmax(0,0.95fr)_64px_minmax(0,1fr)] lg:gap-x-8 lg:px-8 lg:pb-8 lg:pt-24">
          {/* Photo plate */}
          <div className="relative h-[42dvh] shrink-0 lg:h-full">
            <div data-s="plate" className="story-plate absolute inset-0">
              <div data-s="tilt" className="story-tilt absolute inset-0">
                <div className="story-plate-inner absolute inset-0 overflow-hidden rounded-[var(--radius-card)] bg-ink">
                  <div data-s="parallax" className="absolute -inset-[5%]">
                    {d.heroImage && <div data-s="layer" data-hero="true" className="story-layer" style={{ backgroundImage: cssUrl(d.heroImage) }} />}
                    {attractions.map((a) => (
                      <div key={a.slug} data-s="layer" className="story-layer">
                        {Array.from({ length: SLATS }, (_, j) => (
                          <div
                            key={j}
                            data-s="slat"
                            className="story-slat"
                            style={{
                              backgroundImage: cssUrl(a.imageUrl),
                              clipPath: `inset(0 ${Math.max(0, 100 - ((j + 1) * 100) / SLATS - 0.4).toFixed(2)}% 0 ${Math.max(0, (j * 100) / SLATS - 0.4).toFixed(2)}%)`,
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="story-vignette" aria-hidden />
                  <div data-s="glare" className="story-glare" aria-hidden>
                    <span data-s="hover-fx" className="story-glare-spot" />
                  </div>
                </div>
                <span data-s="hover-fx" className="story-edge" aria-hidden />
              </div>
            </div>
          </div>

          {/* Rail: one tick per landmark; hover previews it, click jumps to it */}
          <nav data-s="rail" aria-label={`${d.name} landmarks`} className="relative hidden lg:block">
            <span className="story-rail-track" aria-hidden />
            <span data-s="progress" className="story-rail-progress" aria-hidden />
            <ol className="absolute inset-y-6 left-0 right-0 flex flex-col justify-between">
              {attractions.map((a, i) => (
                <li key={a.slug} className="relative flex justify-center">
                  <button
                    type="button"
                    data-s="tick"
                    className="story-tick"
                    data-active={active === i}
                    data-passed={i < active}
                    aria-current={active === i ? "step" : undefined}
                    aria-label={`Show ${a.name}`}
                    onClick={() => jumpTo(i)}
                  >
                    <span className="story-tick-num">{pad2(i + 1)}</span>
                    <span className="story-preview" aria-hidden>
                      <span className="story-preview-img" style={{ backgroundImage: cssUrl(a.imageUrl) }} />
                      <span className="story-preview-name">{a.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {/* The travelling airplane: flies the rail, leaving a contrail behind it. */}
            <span data-s="node" className="story-rail-plane" aria-hidden>
              <span className="story-rail-plane-halo" />
              <span data-s="plane-dir" className="story-rail-plane-dir">
                <span className="story-rail-plane-bank">
                  <svg viewBox="0 0 24 24" className="story-rail-plane-svg" focusable="false">
                    <path d={PLANE_PATH} />
                  </svg>
                </span>
              </span>
            </span>
          </nav>

          {/* Copy */}
          <div data-s="copy" className="relative flex min-h-0 flex-1 flex-col lg:justify-between lg:py-2">
            <div className="flex items-start gap-3">
              <div className="story-index" aria-hidden>
                <span className="story-index-aura" />
                <div className="story-index-digits">
                  <div data-s="index-tens" className="story-index-col">
                    {tensDigits.map((t) => (
                      <div key={t} className="story-index-row">
                        {t}
                      </div>
                    ))}
                  </div>
                  <div data-s="index-col" className="story-index-col">
                    {attractions.map((a, i) => (
                      <div key={a.slug} data-s="index-row" className="story-index-row">
                        {(i + 1) % 10}
                      </div>
                    ))}
                  </div>
                </div>
                <span className="story-index-total">/{pad2(n)}</span>
                <span className="story-index-tint" />
              </div>
            </div>

            <div className="mt-3 lg:mt-0">
              <div data-s="names" className="story-names">
                {attractions.map((a, i) => (
                  <h3 key={a.slug} data-s="name" className="story-name" aria-hidden={active !== i}>
                    {a.name}
                  </h3>
                ))}
              </div>

              <div className="mt-5 grid lg:mt-7">
                {attractions.map((a, i) => (
                  <div key={a.slug} data-s="group" className="[grid-area:1/1]" aria-hidden={active !== i} inert={active !== i}>
                    <p className="hud text-faint">
                      {a.category} · {formatCoordinates(a, 2)}
                    </p>
                    <p className="mt-3 line-clamp-3 max-w-[46ch] text-[15px] leading-relaxed text-dim">{plain(a.summary)}</p>
                    <dl className="mt-6 hidden max-w-[34rem] grid-cols-2 gap-8 border-t border-line pt-4 lg:grid">
                      <div className="min-w-0">
                        <dt className="hud text-faint">Best time</dt>
                        <dd className="mt-1.5 text-sm text-fg">{plain(a.bestTime)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="hud text-faint">Time needed</dt>
                        <dd className="mt-1.5 text-sm text-fg">{plain(a.visitDuration)}</dd>
                      </div>
                    </dl>
                    <button type="button" onClick={() => onView(i)} className="btn btn-ghost mt-6 lg:mt-7">
                      <Cube size={15} aria-hidden /> View in 3D <ArrowUpRight size={13} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Outro sky: a slowly drifting star field that zooms out as night falls */}
        <div ref={skyRef} data-s="sky" className="story-sky" aria-hidden>
          <div data-s="sky-field" className="story-sky-field">
            <div className="story-sky-drift">
              {sky.map((star, i) => (
                <i
                  key={i}
                  className="sky-star"
                  data-tw={star.twinkle ? "" : undefined}
                  style={
                    {
                      left: star.left,
                      top: star.top,
                      width: star.size,
                      height: star.size,
                      background: star.color,
                      "--tw": star.twinkle?.duration,
                      "--td": star.twinkle?.delay,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </div>
        </div>

        {/* Outro: the landmarks as a constellation, the globe emblem, the handoff */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center" aria-hidden={active !== n}>
          <div className="story-constellation" aria-hidden>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
              {stars.slice(1).map((star, i) => (
                <line key={attractions[i + 1].slug} data-s="c-line" x1={stars[i].u} y1={stars[i].v} x2={star.u} y2={star.v} />
              ))}
            </svg>
            {stars.map((star, i) => (
              <span
                key={attractions[i].slug}
                data-s="c-star"
                data-side={star.side}
                className="story-cstar"
                style={{ left: `${star.u}%`, top: `${star.v}%`, "--tw": star.twinkle.duration, "--td": star.twinkle.delay } as CSSProperties}
              >
                {i === n - 1 && <span data-s="c-flare" className="story-cflare" />}
                <span className="story-cstar-core" />
                <span className="story-cstar-label">
                  <b>{pad2(i + 1)}</b>
                  <span className="story-cstar-name">{attractions[i].name}</span>
                </span>
              </span>
            ))}
          </div>
          <div data-s="outro-globe" className="story-globe opacity-0">
            <OutroGlobe lat={d.lat} lng={d.lng} running={active === n} />
          </div>
          <p data-s="outro-title" className="mt-5 font-mono text-2xl uppercase tracking-[-0.02em] opacity-0 md:text-4xl">
            Your journey continues
          </p>
          <p data-s="outro-sub" className="mt-3 max-w-[40ch] text-sm leading-relaxed text-dim opacity-0">
            {tourCount > 0
              ? `${tourCount} ${tourCount === 1 ? "tour" : "tours"} in ${d.name}, planned day by day. Pick the one that fits, just below.`
              : `Tell us your dates and we'll plan ${d.name} around you, just below.`}
          </p>
        </div>
      </div>
    </div>
  );
}
