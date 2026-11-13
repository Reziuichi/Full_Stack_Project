"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { scrambleText } from "@/lib/textFx";
import { LocalTime } from "@/features/journey/components/LocalTime";
import { createFlat } from "./flat";
import { createGl, type Renderer, type SurveyScene } from "./gl";
import { mosaic } from "./mosaic";
import { createStory, project, smooth, type SceneDef } from "./story";
import { loadSurvey, metersAt, route as traceRoute, SIZE, uvOf, worldOf, type Survey, type V3 } from "./terrain";

export type SurveySpot = {
  slug: string;
  name: string;
  category: string;
  summary: string;
  coords: string;
  lat: number;
  lng: number;
  image: string;
  credit: string;
  bestTime: string;
  visitDuration: string;
};

export type SurveyTour = {
  slug: string;
  name: string;
  summary: string;
  days: number;
  pace: string;
  priceInr: number;
  thumb: string;
  photo: string;
  flight: string;
};

export type SurveyData = {
  slug: string;
  name: string;
  country: string;
  region: string;
  tagline: string;
  summary: string;
  coords: string;
  lat: number;
  lng: number;
  elevation: number;
  timezone: string;
  bestSeason: string;
  hero: string;
  heroCredit: string;
  routeKm: string;
  fromPrice: string | null;
  spots: SurveySpot[];
  tours: SurveyTour[];
};

/** How much scrolling one chapter takes, as a share of the viewport. */
const STEP_VH = 110;
/** Scroll spent on the arrival before the first move, and on the route before the tours. */
const LEAD = 0.3;
const AFTER = 0.35;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pad = (n: number) => String(n).padStart(2, "0");
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const sized = (url: string, w: number) => {
  if (url.includes("/thumb/")) return url.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${w}px-${m[3]}` : url;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const units = (steps: number) => steps + LEAD + AFTER;
function storyAt(p: number, steps: number, hero: number) {
  const u = p * units(steps) - LEAD;
  if (u <= 0) return hero;
  const j = Math.floor(u);
  return Math.min(hero + steps, hero + j + smooth(0.05, 0.6, u - j));
}
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numberWord = (n: number) => WORDS[n] ?? String(n);

/**
 * A destination as an orbital survey, after a data-landscape aesthetic: the
 * real land round the city (from open elevation data) drawn as a point
 * cloud, contour lines and a wireframe, sea as moving waves, under a low
 * sun. Scrolling flies a camera over it: the arrival scans the land in,
 * the brief traces its contours, the strata slice it into layers (one per
 * landmark), each landmark rises on a pin with its photo decoding from
 * coarse blocks, and the route is drawn across the land with its elevation
 * profile. The tours then flow over the survey as it draws back into a
 * slowly turning object. An instrument panel tracks it all; the cursor
 * probes the land for coordinates and elevation.
 *
 * WebGL2 (three.js) draws it; if the GPU is lost or missing, a Canvas 2D
 * renderer draws the same frames. With reduced motion the chapters cut
 * between their views without flights.
 */
export function DestinationSurvey({ data }: { data: SurveyData }) {
  const A = data.spots.length;
  const HERO = 1;
  const BRIEF = 2;
  const STRATA = 3;
  const FIRST = 4;
  const ROUTE = FIRST + A;
  const STEPS = ROUTE - HERO;
  const chapters = [
    { at: HERO, name: "Acquire" },
    { at: BRIEF, name: "Brief" },
    { at: STRATA, name: "Strata" },
    ...data.spots.map((s, i) => ({ at: FIRST + i, name: s.name })),
    { at: ROUTE, name: "Route" },
  ];
  const code = String(hash(data.slug) % 9000 + 1000);
  const maxDays = Math.max(1, ...data.tours.map((t) => t.days));

  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const outro = useRef(0);

  const scrollToY = (y: number) =>
    gsap.to(window, { scrollTo: { y, autoKill: true }, duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 1.6, ease: "power3.inOut" });
  const jumpTo = (at: number) => {
    const el = stage.current;
    if (!el) return;
    const u = at <= HERO ? -LEAD * 0.5 : at - HERO - 1 + 0.8;
    const p = clamp((u + LEAD) / units(STEPS), 0, 1);
    scrollToY(el.getBoundingClientRect().top + window.scrollY + p * (el.offsetHeight - window.innerHeight));
  };

  // Scroll: the story through the stage, then the outro as the tours arrive; and the tours' own entrances.
  useGSAP(
    () => {
      const calm = window.matchMedia(MOTION_QUERIES.reduce).matches;
      ScrollTrigger.create({
        trigger: stage.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => void (progress.current = self.progress),
        onRefresh: (self) => void (progress.current = self.progress),
      });
      const after = root.current?.querySelector(".sv-tours");
      if (!after) return;
      ScrollTrigger.create({
        trigger: after,
        start: "top bottom",
        end: "top 25%",
        onUpdate: (self) => void (outro.current = self.progress),
        onRefresh: (self) => void (outro.current = self.progress),
      });
      const words = gsap.utils.toArray<HTMLElement>(".sv-tours-title .sv-word i");
      gsap.from(words, { yPercent: 110, duration: calm ? 0.01 : 1.1, ease: "expo.out", stagger: 0.06, scrollTrigger: { trigger: ".sv-tours-head", start: "top 82%", once: true } });
      gsap.from(".sv-tours-head .sv-tag, .sv-tours-head .sv-bracket", { opacity: 0, y: 14, duration: calm ? 0.01 : 0.9, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: ".sv-tours-head", start: "top 82%", once: true } });
      for (const row of gsap.utils.toArray<HTMLElement>(".sv-tour")) {
        const tl = gsap.timeline({ scrollTrigger: { trigger: row, start: "top 88%", once: true }, defaults: { ease: "expo.out" } });
        tl.from(row.querySelector(".sv-tour-rule"), { scaleX: 0, duration: calm ? 0.01 : 1.2 }, 0)
          .from(row.querySelectorAll(".sv-tour-fx"), { yPercent: 60, opacity: 0, duration: calm ? 0.01 : 1, stagger: 0.07 }, 0.1)
          .add(() => row.dispatchEvent(new CustomEvent("sv-in")), 0.15);
      }
      gsap.from(".sv-credits", { opacity: 0, duration: calm ? 0.01 : 1.2, ease: "power2.out", scrollTrigger: { trigger: ".sv-credits", start: "top 95%", once: true } });
    },
    { scope: root },
  );

  useEffect(() => {
    const el = root.current!;
    const view = el.querySelector<HTMLElement>(".sv-view")!;
    const host = el.querySelector<HTMLElement>(".sv-canvas")!;
    const calm = window.matchMedia(MOTION_QUERIES.reduce).matches;
    const seed = hash(data.slug);
    let cancelled = false;
    let teardown: (() => void) | null = null;

    // ── The tours' thumbnails decode as they come in. ─────────────────────
    const thumbs: { stop: () => void }[] = [];
    for (const row of el.querySelectorAll<HTMLElement>(".sv-tour")) {
      const canvas = row.querySelector<HTMLCanvasElement>(".sv-tour-mosaic");
      const img = row.querySelector<HTMLImageElement>(".sv-tour-img img");
      const price = row.querySelector<HTMLElement>(".sv-tour-price b");
      const target = Number(row.dataset.price || 0);
      if (!canvas || !img) continue;
      let m: ReturnType<typeof mosaic> | null = null;
      const start = () => {
        if (!m) m = mosaic(canvas, img, { still: calm });
        m.play();
        thumbs.push(m);
        if (price && target) {
          const o = { v: 0 };
          gsap.to(o, { v: target, duration: calm ? 0.01 : 1.4, ease: "expo.out", onUpdate: () => void (price.textContent = inr(o.v)) });
        }
      };
      row.addEventListener("sv-in", () => (img.complete && img.naturalWidth ? start() : img.addEventListener("load", start, { once: true })), { once: true });
    }

    void loadSurvey(data.slug, seed)
      .then((survey) => {
        if (cancelled) return;
        teardown = run(survey);
      })
      .catch(() => undefined);

    function run(survey: Survey) {
      const center: [number, number] = [data.lat, data.lng];
      const stops = data.spots.map((s) => uvOf(survey, s.lat, s.lng, center));
      const spots: V3[] = stops.map(([u, v]) => worldOf(survey, u, v));
      // The strata: one plane per landmark (up to eight), at contour heights spread through the relief.
      const LEVELS = 18;
      const P = Math.min(8, Math.max(3, A));
      const planes = Array.from({ length: P }, (_, i) => Math.round(((i + 1) / (P + 1)) * (LEVELS + 1)) / (LEVELS + 1));
      let top = 0;
      for (const y of survey.y) top = Math.max(top, y);
      const world: SurveyScene = { survey, spots, stops, planes, top };
      const scenes: SceneDef[] = [
        { kind: "void", spot: -1 },
        { kind: "acquire", spot: -1 },
        { kind: "brief", spot: -1 },
        { kind: "strata", spot: -1 },
        ...data.spots.map((_, i) => ({ kind: "spot" as const, spot: i })),
        { kind: "route", spot: -1 },
      ];
      const story = createStory(survey, scenes, spots, calm);
      const pointer = story.pointer;
      view.dataset.ready = "";

      // ── Renderers: WebGL2 first; Canvas 2D whenever the GPU isn't there. ──
      const images: (HTMLImageElement | null)[] = new Array(A).fill(null);
      let gl: Renderer | null = null;
      let flat: Renderer | null = null;
      let active: Renderer | null = null;
      let glCanvas: HTMLCanvasElement | null = null;
      let retries = 0;
      let retryTimer = 0;
      const feed = (r: Renderer) => images.forEach((img, i) => img && r.setPhoto(i, img));
      const canvas = (kind: "gl" | "2d") => {
        const c = document.createElement("canvas");
        c.className = `sv-gl is-${kind}`;
        c.setAttribute("aria-hidden", "true");
        host.append(c);
        return c;
      };
      const activate = (r: Renderer | null) => {
        active = r;
        host.dataset.renderer = r?.kind ?? "none";
      };
      const ensureFlat = () => {
        if (!flat) {
          flat = createFlat(canvas("2d"), world);
          if (flat) feed(flat);
        }
        return flat;
      };
      const retry = () => {
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (cancelled || gl?.status() === "ready") return;
          if (retries++ < 2 && !startGl()) retry();
        }, 2500);
      };
      const onLost = () => {
        activate(ensureFlat());
        retry();
      };
      const onRestored = () => {
        window.clearTimeout(retryTimer);
        if (gl?.status() === "ready") activate(gl);
      };
      function startGl() {
        gl?.dispose();
        glCanvas?.remove();
        gl = null;
        glCanvas = canvas("gl");
        const g = createGl(glCanvas, world, seed, { onLost, onRestored });
        if (!g) {
          glCanvas.remove();
          glCanvas = null;
          return false;
        }
        gl = g;
        feed(g);
        activate(g);
        return true;
      }
      if (!startGl()) {
        activate(ensureFlat());
        retry();
      }

      // Landmark photos, gently (Wikimedia throttles bursts), with one retry.
      const load = (src: string, tries = 2): Promise<HTMLImageElement> =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.decoding = "async";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = sized(src, 1280);
        }).catch((error) => {
          if (tries <= 1 || cancelled) throw error;
          return new Promise<HTMLImageElement>((r) => window.setTimeout(r, 1500)).then(() => load(src, tries - 1));
        });
      data.spots.forEach((s, i) =>
        window.setTimeout(() => {
          if (cancelled) return;
          load(s.image)
            .then((img) => {
              if (cancelled) return;
              images[i] = img;
              story.photo(i, img.naturalWidth / Math.max(1, img.naturalHeight));
              gl?.setPhoto(i, img);
              flat?.setPhoto(i, img);
            })
            .catch(() => undefined);
        }, 150 * i),
      );
      // The city's photo in the brief, decoding as the chapter opens.
      const briefCanvas = el.querySelector<HTMLCanvasElement>(".sv-brief-photo canvas");
      let briefMosaic: ReturnType<typeof mosaic> | null = null;
      load(data.hero)
        .then((img) => {
          if (cancelled || !briefCanvas) return;
          briefMosaic = mosaic(briefCanvas, img, { duration: 1.1, still: calm });
        })
        .catch(() => undefined);

      // ── The overlay. ────────────────────────────────────────────────────
      const chapterEls = [...el.querySelectorAll<HTMLElement>("[data-ch]")];
      const rows = [...el.querySelectorAll<HTMLElement>(".sv-row")];
      const fills = rows.map((r) => r.querySelector<HTMLElement>(".sv-row-fill"));
      const knobs = [...el.querySelectorAll<HTMLElement>(".sv-knob")];
      const indexEl = el.querySelector<HTMLElement>(".sv-index");
      const altEl = el.querySelector<HTMLElement>("[data-read='alt']");
      const hdgEl = el.querySelector<HTMLElement>("[data-read='hdg']");
      const elevEl = el.querySelector<HTMLElement>("[data-read='elev']");
      const callout = el.querySelector<HTMLElement>(".sv-callout");
      const calloutTag = el.querySelector<HTMLElement>(".sv-callout-tag");
      const calloutName = el.querySelector<HTMLElement>(".sv-callout-name");
      const calloutData = el.querySelector<HTMLElement>(".sv-callout-data");
      const lead = el.querySelector<SVGPathElement>(".sv-wires .sv-lead");
      const strataLabels = [...el.querySelectorAll<HTMLElement>(".sv-stratum")];
      const strataLeads = [...el.querySelectorAll<SVGPathElement>(".sv-wires .sv-stratum-lead")];
      const strataAt = strataLabels.map(() => [0, 0, 0, 0] as [number, number, number, number]);
      const probe = el.querySelector<HTMLElement>(".sv-probe");
      const probeA = el.querySelector<HTMLElement>(".sv-probe-a");
      const probeB = el.querySelector<HTMLElement>(".sv-probe-b");
      const profile = el.querySelector<SVGPathElement>(".sv-profile-line");
      const hud = el.querySelector<HTMLElement>(".sv-hud");
      let shown = -1;
      // What the callout must keep clear of, measured when the chapter changes.
      let blocks: [number, number, number, number][] = [];
      const measure = () => {
        const box = (e: Element | null) => {
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return r.width ? ([r.left - 12, r.top - 12, r.right + 12, r.bottom + 12] as [number, number, number, number]) : null;
        };
        blocks = [box(el.querySelector(".sv-tl")), box(el.querySelector(".sv-panel")), box(el.querySelector(`.sv-note[data-ch="${shown}"]`)), box(el.querySelector(".sv-br"))].filter((b): b is [number, number, number, number] => !!b);
      };
      let vw = view.clientWidth || 1;
      let vh = view.clientHeight || 1;
      let focusOverride = -1;
      let frameNo = 0;


      const spotMeters = stops.map(([u, v]) => Math.round(metersAt(survey, u, v)));
      const toLatLng = (x: number, z: number): [number, number] => {
        const u = x / SIZE + 0.5;
        const v = z / SIZE + 0.5;
        if (!survey.real) return [data.lat - (v - 0.5) * (survey.sideMeters / 111320), data.lng + (u - 0.5) * (survey.sideMeters / (111320 * Math.cos((data.lat * Math.PI) / 180)))];
        const [cx, cy, side] = survey.square;
        const n = 256 * 2 ** survey.zoom;
        const gx = cx - side / 2 + u * side;
        const gy = cy - side / 2 + v * side;
        return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI, (gx / n) * 360 - 180];
      };
      const hemi = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;

      const overlay = (s: number, outroAmt: number) => {
        for (const c of chapterEls) {
          const at = Number(c.dataset.ch);
          const o = (1 - clamp(Math.abs(s - at) * 2.4, 0, 1)) * (1 - outroAmt);
          c.style.opacity = o.toFixed(3);
          if (!calm) c.style.transform = `translate3d(0, ${((at - s) * 22).toFixed(1)}px, 0)`;
          c.toggleAttribute("data-on", o > 0.55);
        }
        if (hud) hud.style.opacity = (1 - outroAmt).toFixed(3);
        rows.forEach((r, i) => {
          const at = chapters[i].at;
          const fill = i === 0 ? clamp(s, 0, 1) : clamp(s - at + 1, 0, 1);
          const f = fills[i];
          if (f) f.style.transform = `scaleX(${fill.toFixed(3)})`;
          r.toggleAttribute("data-on", Math.round(s) === at);
        });
        knobs.forEach((k, i) => {
          k.toggleAttribute("data-on", Math.round(s) === FIRST + i);
          k.toggleAttribute("data-past", s > FIRST + i + 0.5);
        });
        const now = clamp(Math.round(s), HERO, ROUTE);
        if (now !== shown) {
          shown = now;
          const k = chapters.findIndex((c) => c.at === now);
          if (indexEl) indexEl.textContent = `INDEX ${pad(k + 1)} / ${pad(chapters.length)}`;
          const spot = data.spots[now - FIRST];
          if (spot && calloutTag && calloutName && calloutData) {
            calloutTag.textContent = `LANDMARK ${pad(now - FIRST + 1)} · ${spot.category.toUpperCase()}`;
            calloutName.textContent = spot.name;
            calloutData.textContent = `${spot.coords}  ·  ELEV ${spotMeters[now - FIRST]} M`;
            if (!calm) {
              scrambleText(calloutTag, { duration: 0.6 });
              scrambleText(calloutName, { duration: 0.8 });
            }
          }
          measure();
          if (now === BRIEF) {
            briefMosaic?.play();
            if (!calm) {
              const t = el.querySelector(".sv-brief-text");
              if (t) scrambleText(t, { duration: 1.4 });
            }
          }
        }
      };

      // The probe steps aside where its read-out would land on the callout's words.
      let calloutBox: [number, number, number, number] | null = null;
      let probeClear = 1;
      const place = (f: ReturnType<typeof story.update>, s: number) => {
        // The landmark's callout hangs off its panel's top-left corner on a leader line.
        const rect = active?.panelRect(f.active) ?? null;
        calloutBox = null;
        const vis = rect ? f.panel : 0;
        if (callout) callout.style.opacity = vis.toFixed(3);
        if (lead) lead.style.opacity = (vis * 0.9).toFixed(3);
        if (rect && callout && lead) {
          const cw = callout.offsetWidth || 240;
          const ch = callout.offsetHeight || 80;
          // Left of the panel, else right of it, else under it beside the pin's line: the first place on screen
          // and clear of the corners.
          const mid = (rect[0] + rect[2]) / 2;
          const spots: [number, number, "l" | "r" | "b"][] = [
            [rect[0] - 44 - cw, rect[1] + 6, "l"],
            [rect[2] + 44, rect[1] + 6, "r"],
            [Math.min(rect[0], mid - 20 - cw), rect[3] + 22, "b"],
            [mid + 20, rect[3] + 22, "b"],
            [rect[0], rect[3] + 22, "b"],
          ];
          const clear = ([x, y]: [number, number, string]) =>
            x >= 16 && y >= 16 && x + cw <= vw - 16 && y + ch <= vh - 16 && !blocks.some((b) => x < b[2] && x + cw > b[0] && y < b[3] && y + ch > b[1]);
          const [lx, ly, side] = spots.find(clear) ?? spots[4];
          callout.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
          if (vis > 0.05) calloutBox = [lx, ly, lx + cw, ly + ch];
          const d =
            side === "l"
              ? `M${rect[0].toFixed(1)} ${(rect[1] + 1).toFixed(1)}L${(rect[0] - 22).toFixed(1)} ${(ly + ch).toFixed(1)}L${lx.toFixed(1)} ${(ly + ch).toFixed(1)}`
              : side === "r"
                ? `M${rect[2].toFixed(1)} ${(rect[1] + 1).toFixed(1)}L${(rect[2] + 22).toFixed(1)} ${(ly + ch).toFixed(1)}L${(lx + cw).toFixed(1)} ${(ly + ch).toFixed(1)}`
                : `M${clamp(lx + 8, rect[0], rect[2]).toFixed(1)} ${rect[3].toFixed(1)}L${clamp(lx + 8, rect[0], rect[2]).toFixed(1)} ${(ly - 6).toFixed(1)}`;
          lead.setAttribute("d", d);
        }
        // Strata labels beside the right-hand edge of their planes.
        const stVis = f.strata * (1 - f.outro);
        // Each layer's label sits level with its plane's corner, pushed apart where the planes crowd (phones).
        const n = Math.min(strataLabels.length, planes.length);
        if (stVis >= 0.01) {
          for (let i = 0; i < n; i++) {
            const y = planes[i] * top + f.spread * (i - (planes.length - 1) / 2) * 0.62 + f.spread * 0.5;
            const [x0, y0, ok] = project(f, [(SIZE / 2) * 1.04, y, (-SIZE / 2) * 1.04]);
            strataAt[i] = [x0, y0, ok ? 1 : 0, clamp(y0, 90, vh - 60)];
          }
          const gap = (strataLabels[0]?.offsetHeight || 30) + 6;
          for (let i = 1; i < n; i++) strataAt[i][3] = Math.min(strataAt[i][3], strataAt[i - 1][3] - gap);
          const over = 90 - (n ? strataAt[n - 1][3] : 90);
          if (over > 0) for (let i = 0; i < n; i++) strataAt[i][3] += over;
        }
        strataLabels.forEach((label, i) => {
          const l = strataLeads[i];
          if (stVis < 0.01 || i >= n) {
            label.style.opacity = "0";
            if (l) l.style.opacity = "0";
            return;
          }
          const [x0, y0, ok, ly] = strataAt[i];
          const lx = vw - (label.offsetWidth || 220) - 40;
          label.style.opacity = (ok ? stVis : 0).toFixed(3);
          label.style.transform = `translate3d(${lx.toFixed(1)}px, ${(ly - 10).toFixed(1)}px, 0)`;
          label.toggleAttribute("data-on", f.focus === i || focusOverride === i);
          if (l) {
            l.style.opacity = (ok ? stVis * 0.7 : 0).toFixed(3);
            l.setAttribute("d", `M${x0.toFixed(1)} ${y0.toFixed(1)}L${(lx - 30).toFixed(1)} ${ly.toFixed(1)}L${(lx - 8).toFixed(1)} ${ly.toFixed(1)}`);
          }
        });
        // The profile draws itself with the route (once its path is in).
        const profLen = Number(profile?.dataset.len || 0);
        if (profile && profLen) profile.style.strokeDashoffset = `${(profLen * (1 - f.route)).toFixed(1)}`;
        // The probe's read-out.
        if (probe) {
          const b = calloutBox;
          const clash = !!b && pointer.x > b[0] - 210 && pointer.x < b[2] + 12 && pointer.y > b[1] - 44 && pointer.y < b[3] + 16;
          probeClear += ((clash ? 0 : 1) - probeClear) * 0.25;
          const o = f.probeAmt > 0.05 ? f.probeAmt * (1 - f.outro) * probeClear : 0;
          probe.style.opacity = o.toFixed(3);
          if (o > 0) {
            probe.style.transform = `translate3d(${pointer.x.toFixed(1)}px, ${pointer.y.toFixed(1)}px, 0)`;
            if (frameNo % 3 === 0 && probeA && probeB) {
              const [la, ln] = toLatLng(f.probe[0], f.probe[2]);
              const m = Math.round(metersAt(survey, f.probe[0] / SIZE + 0.5, f.probe[2] / SIZE + 0.5));
              probeA.textContent = `${hemi(la, "N", "S")} · ${hemi(ln, "E", "W")}`;
              probeB.textContent = `ELEV ${m} M`;
            }
          }
        }
        // Readouts.
        if (frameNo % 4 === 0) {
          const alt = (f.eye[1] * survey.sideMeters) / SIZE;
          if (altEl) altEl.textContent = `${(alt / 1000).toFixed(2)} KM`;
          const hdg = ((Math.atan2(f.target[0] - f.eye[0], -(f.target[2] - f.eye[2])) * 180) / Math.PI + 360) % 360;
          if (hdgEl) hdgEl.textContent = `${pad(Math.round(hdg))}°`;
          const spot = f.active >= 0 ? spotMeters[f.active] : null;
          if (elevEl) elevEl.textContent = f.probeAmt > 0.3 ? `${Math.round(metersAt(survey, f.probe[0] / SIZE + 0.5, f.probe[2] / SIZE + 0.5))} M` : spot !== null ? `${spot} M` : `${Math.round(survey.min)}–${Math.round(survey.max)} M`;
        }
        void s;
      };

      // ── The loop. ──────────────────────────────────────────────────────
      let raf = 0;
      let running = false;
      let last = 0;
      let time = 0;
      let s = 0;
      let prev = 0;
      let intro = 0;
      let mx = 0;
      let my = 0;
      let tx = 0;
      let ty = 0;
      let o = 0;
      let scale = 1;
      let acc = 0;
      let frames = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        time += dt;
        frameNo++;
        if (intro < HERO) intro = Math.min(HERO, intro + dt / (calm ? 0.4 : 1.4));
        const goal = intro < HERO ? intro : storyAt(progress.current, STEPS, HERO);
        s += (goal - s) * (1 - Math.exp(-dt * (intro < HERO ? 30 : 3.8)));
        if (Math.abs(goal - s) < 1e-4) s = goal;
        const speed = Math.abs(s - prev) / Math.max(dt, 1e-3);
        prev = s;
        o += (outro.current - o) * (1 - Math.exp(-dt * 5));
        mx += (tx - mx) * (1 - Math.exp(-dt * 3));
        my += (ty - my) * (1 - Math.exp(-dt * 3));
        const rect = active?.panelRect(story.frame.active) ?? null;
        pointer.overPanel = !!rect && pointer.x > rect[0] && pointer.x < rect[2] && pointer.y > rect[1] && pointer.y < rect[3];
        const f = story.update({ s, dt, time, width: vw, height: vh, tilt: [mx, my], outro: o, ready: true, speed });
        if (focusOverride >= 0 && f.strata > 0.3) f.focus = focusOverride;
        overlay(s, o);
        place(f, s);
        view.style.cursor = pointer.overPanel ? "zoom-in" : "";
        const r = active;
        if (!r) return;
        r.render(f);
        acc += dt;
        if (++frames >= 90) {
          const avg = acc / frames;
          if (avg > 0.024 && scale > 0.6) r.setScale((scale *= 0.85));
          else if (avg < 0.014 && scale < 1) r.setScale((scale = Math.min(1, scale * 1.08)));
          acc = 0;
          frames = 0;
        }
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
      const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { rootMargin: "60px 0px" });
      io.observe(el);
      const ro = new ResizeObserver(() => {
        vw = view.clientWidth || 1;
        vh = view.clientHeight || 1;
        briefMosaic?.refresh();
        measure();
      });
      ro.observe(view);
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerType === "mouse" || ev.pointerType === "pen") {
          pointer.x = ev.clientX;
          pointer.y = ev.clientY;
          const t = ev.target as Element | null;
          pointer.inside = !t?.closest("a, button, .sv-panel, .sv-tours, header");
        }
        tx = (ev.clientX / window.innerWidth) * 2 - 1;
        ty = -((ev.clientY / window.innerHeight) * 2 - 1);
      };
      const onLeave = () => void (pointer.inside = false);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      const onStratum = (ev: Event) => {
        const i = Number((ev.currentTarget as HTMLElement).dataset.i);
        focusOverride = ev.type === "pointerenter" ? i : -1;
      };
      for (const label of strataLabels) {
        label.addEventListener("pointerenter", onStratum);
        label.addEventListener("pointerleave", onStratum);
      }

      return () => {
        stop();
        io.disconnect();
        ro.disconnect();
        window.removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        for (const label of strataLabels) {
          label.removeEventListener("pointerenter", onStratum);
          label.removeEventListener("pointerleave", onStratum);
        }
        window.clearTimeout(retryTimer);
        briefMosaic?.stop();
        gl?.dispose();
        flat?.dispose();
        host.replaceChildren();
      };
    }

    return () => {
      cancelled = true;
      teardown?.();
      for (const t of thumbs) t.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once per destination
  }, [data.slug]);

  const at = (i: number) => ({ "data-ch": i }) as Record<string, number>;
  const [lat, lng] = data.coords.split(" · ");
  return (
    <article ref={root} className="sv">
      <h1 className="sr-only">
        {data.name}, {data.country}
      </h1>
      <div className="sv-canvas-track" aria-hidden>
        <div className="sv-canvas" />
      </div>

      <section ref={stage} className="sv-stage" style={{ "--steps": units(STEPS), "--step": `${STEP_VH}svh` } as React.CSSProperties} data-nav-clear>
        <div className="sv-view">
          <div className="sv-hud">
            <svg className="sv-wires" aria-hidden>
              <path className="sv-lead" d="" />
              {data.spots.map((s) => (
                <path key={s.slug} className="sv-stratum-lead" d="" />
              ))}
            </svg>

            <div className="sv-corner sv-tl">
              <p>
                <span className="sv-dim">{"//"}</span> {data.region}, {data.country}
              </p>
              <p>{data.coords}</p>
              <p>
                Local time <LocalTime timezone={data.timezone} />
              </p>
            </div>

            {/* The instrument panel: each chapter a slider that fills as you pass through it. */}
            <nav className="sv-panel" aria-label="Chapters">
              <p className="sv-panel-head">
                <span>SURVEY · {code}</span>
                <span className="sv-index">INDEX 01 / {pad(chapters.length)}</span>
              </p>
              <ol>
                {chapters.map((c, i) => (
                  <li key={c.at}>
                    <button type="button" className="sv-row" onClick={() => jumpTo(c.at)} data-on={i === 0 || undefined}>
                      <span className="sv-row-no">{pad(i + 1)}</span>
                      <span className="sv-row-name">{c.name}</span>
                      <span className="sv-row-track" aria-hidden>
                        <i className="sv-row-fill" />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <dl className="sv-reads">
                <div>
                  <dt>ALT</dt>
                  <dd data-read="alt">—</dd>
                </div>
                <div>
                  <dt>HDG</dt>
                  <dd data-read="hdg">—</dd>
                </div>
                <div>
                  <dt>ELEV</dt>
                  <dd data-read="elev">—</dd>
                </div>
                <div>
                  <dt>GRID</dt>
                  <dd>200²</dd>
                </div>
              </dl>
              <div className="sv-knobs" aria-hidden>
                {data.spots.map((s) => (
                  <i key={s.slug} className="sv-knob" />
                ))}
              </div>
            </nav>

            {/* Acquire: the land scans in under the city's name. */}
            <div className="sv-ch sv-hero" {...at(HERO)}>
              <p className="sv-tag">Survey {code} · acquired</p>
              <p className="sv-hero-name">{data.name}</p>
              <p className="sv-hero-rule" aria-hidden />
              <p className="sv-hero-line">{data.tagline}</p>
              <ul className="sv-hero-stats">
                <li>
                  <span>LAT</span> {lat}
                </li>
                <li>
                  <span>LON</span> {lng}
                </li>
                <li>
                  <span>PLACES</span> {pad(A)}
                </li>
                <li>
                  <span>ROUTE</span> {data.routeKm}
                </li>
              </ul>
              <p className="sv-hint">Scroll to survey {data.name}</p>
            </div>

            {/* Brief: the city's story typed out, its photo decoding beside it. */}
            <div className="sv-ch sv-brief" {...at(BRIEF)}>
              <p className="sv-tag">Brief</p>
              <p className="sv-brief-text">{data.summary}</p>
              <dl className="sv-brief-data">
                <div>
                  <dt>Best season</dt>
                  <dd>{data.bestSeason}</dd>
                </div>
                <div>
                  <dt>Time zone</dt>
                  <dd>{data.timezone.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt>Elevation</dt>
                  <dd>{Math.round(data.elevation)} m</dd>
                </div>
              </dl>
              <figure className="sv-brief-photo">
                <canvas aria-hidden />
                <figcaption>
                  [ {data.name.toUpperCase()} · REF 00 ] <a href={data.heroCredit} target="_blank" rel="noreferrer">Wikimedia Commons</a>
                </figcaption>
              </figure>
            </div>

            {/* Strata: one plane per landmark; the labels lead off their edges. */}
            <div className="sv-ch sv-strata-note" {...at(STRATA)}>
              <p className="sv-tag">Strata</p>
              <p>
                {numberWord(A)} {A === 1 ? "place" : "places"}, one layer each. Hover a layer to find it in the land; click to fly there.
              </p>
            </div>
            {data.spots.map((s, i) => (
              <button key={s.slug} type="button" className="sv-stratum" data-i={i} onClick={() => jumpTo(FIRST + i)}>
                <span className="sv-stratum-no">LAYER {pad(i + 1)}</span>
                <span className="sv-stratum-name">{s.name}</span>
              </button>
            ))}

            {/* Each landmark: a callout hung off its decoding panel, and its notes. */}
            <div className="sv-callout" aria-hidden>
              <p className="sv-callout-tag">LANDMARK 01</p>
              <p className="sv-callout-name">{data.spots[0]?.name}</p>
              <p className="sv-callout-data">—</p>
            </div>
            {data.spots.map((s, i) => (
              <div key={s.slug} className="sv-ch sv-note" {...at(FIRST + i)}>
                <p className="sv-tag">
                  {s.category} · {pad(i + 1)} / {pad(A)}
                </p>
                <p>{s.summary}</p>
                <dl>
                  <div>
                    <dt>Best time</dt>
                    <dd>{s.bestTime}</dd>
                  </div>
                  <div>
                    <dt>Plan for</dt>
                    <dd>{s.visitDuration}</dd>
                  </div>
                </dl>
                <a className="sv-credit" href={s.credit} target="_blank" rel="noreferrer">
                  Photo · Wikimedia Commons
                </a>
              </div>
            ))}

            {/* Route: drawn across the land, with its elevation profile. */}
            <div className="sv-ch sv-route" {...at(ROUTE)}>
              <p className="sv-tag">Route</p>
              <p>
                {numberWord(A)} {A === 1 ? "stop" : "stops"}, {data.routeKm} end to end, in the order you meet them.
              </p>
            </div>
            <div className="sv-ch sv-profile" {...at(ROUTE)}>
              <SurveyProfile slug={data.slug} spots={data.spots} lat={data.lat} lng={data.lng} />
            </div>

            <div className="sv-corner sv-br">
              <Link href={`/?to=${data.slug}`} className="sv-bracket">
                <span aria-hidden>[</span> Fly there in 3D <span aria-hidden>]</span>
              </Link>
              <p className="sv-dim">Terrain · AWS Terrain Tiles</p>
            </div>

            <div className="sv-probe" aria-hidden>
              <i />
              <p className="sv-probe-a">—</p>
              <p className="sv-probe-b">—</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sv-tours" aria-labelledby="sv-tours-title">
        <div className="sv-tours-inner">
          <header className="sv-tours-head">
            <p className="sv-tag">Tours in {data.name}</p>
            <h2 id="sv-tours-title" className="sv-tours-title">
              {(data.tours.length ? `${numberWord(data.tours.length)} ways to see ${data.name}.` : `${data.name}, on request.`).split(" ").map((w, i) => (
                <span key={i} className="sv-word">
                  <i>{w}</i>
                </span>
              ))}
            </h2>
            <Link href={`/tours?destination=${data.slug}`} className="sv-bracket">
              <span aria-hidden>[</span> Compare all tours <span aria-hidden>]</span>
            </Link>
          </header>
          {data.tours.length > 0 && (
            <ol className="sv-tour-list">
              {data.tours.map((t, i) => (
                <li key={t.slug} className="sv-tour" data-tour-card data-price={t.priceInr}>
                  <i className="sv-tour-rule" aria-hidden />
                  <Link href={`/tours/${t.slug}`} data-tour-photo={t.photo} data-tour-flight={t.flight} data-tour-name={t.name}>
                    <span className="sv-tour-no sv-tour-fx">[ {pad(i + 1)} ]</span>
                    <span className="sv-tour-img" data-tour-frame>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote photo; the boarding transition opens from it */}
                      <img src={t.thumb} alt="" loading="lazy" decoding="async" crossOrigin="anonymous" data-on="" />
                      <canvas className="sv-tour-mosaic" aria-hidden />
                    </span>
                    <span className="sv-tour-copy sv-tour-fx">
                      <b>{t.name}</b>
                      <small>{t.summary}</small>
                    </span>
                    <span className="sv-tour-meta sv-tour-fx">
                      <span>
                        {t.days} days · {t.pace}
                      </span>
                      <span className="sv-tour-track" aria-hidden>
                        <i style={{ transform: `scaleX(${(t.days / maxDays).toFixed(3)})` }} />
                      </span>
                    </span>
                    <span className="sv-tour-price sv-tour-fx">
                      from <b>{inr(t.priceInr)}</b>
                    </span>
                    <span className="sv-tour-go sv-tour-fx" aria-hidden>
                      <ArrowUpRight size={16} weight="light" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <p className="sv-credits">
            Photos · Wikimedia Commons:{" "}
            <a href={data.heroCredit} target="_blank" rel="noreferrer">
              {data.name}
            </a>
            {data.spots.map((s) => (
              <span key={s.slug}>
                {" · "}
                <a href={s.credit} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              </span>
            ))}
            {" · "}Terrain · AWS Terrain Tiles (SRTM, ETOPO1 and others)
          </p>
        </div>
      </section>
    </article>
  );
}

/** The route's elevation profile: loads the same survey and draws elevation against distance, with the stops marked. */
function SurveyProfile({ slug, spots, lat, lng }: { slug: string; spots: SurveySpot[]; lat: number; lng: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let gone = false;
    void loadSurvey(slug, hash(slug))
      .then((survey) => {
        if (gone) return;
        const stops = spots.map((s) => uvOf(survey, s.lat, s.lng, [lat, lng]));
        const rt = traceRoute(survey, stops, 48);
        if (!rt.pts.length || rt.total <= 0) return;
        const lo = Math.min(...rt.elev);
        const hi = Math.max(...rt.elev);
        const span = Math.max(20, hi - lo);
        const X = (d: number) => 40 + (d / rt.total) * 920;
        const Y = (e: number) => 130 - ((e - lo) / span) * 100;
        const d = rt.elev.map((e, i) => `${i ? "L" : "M"}${X(rt.dist[i]).toFixed(1)} ${Y(e).toFixed(1)}`).join("");
        const line = svg.querySelector<SVGPathElement>(".sv-profile-line");
        const area = svg.querySelector<SVGPathElement>(".sv-profile-area");
        line?.setAttribute("d", d);
        area?.setAttribute("d", `${d}L${X(rt.total).toFixed(1)} 140L40 140Z`);
        if (line) {
          const len = line.getTotalLength();
          line.style.strokeDasharray = `${len}`;
          line.style.strokeDashoffset = `${len}`;
          line.dataset.len = String(len);
        }
        const marks = svg.querySelector(".sv-profile-marks");
        if (marks) {
          marks.innerHTML = rt.legEnds
            .map((idx, k) => {
              const x = X(rt.dist[idx]);
              const y = Y(rt.elev[idx]);
              return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="140"/><text x="${x.toFixed(1)}" y="154" text-anchor="middle">${String(k + 1).padStart(2, "0")}</text>`;
            })
            .join("");
        }
        const axis = svg.querySelector(".sv-profile-axis");
        if (axis) axis.textContent = `${Math.round(lo)}–${Math.round(hi)} M · ${(rt.total / 1000).toFixed(1)} KM`;
      })
      .catch(() => undefined);
    return () => void (gone = true);
  }, [slug, spots, lat, lng]);
  return (
    <figure className="sv-profile-figure">
      <figcaption>
        <span>ELEVATION PROFILE</span>
        <span className="sv-profile-axis">—</span>
      </figcaption>
      <svg ref={ref} viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden>
        <path className="sv-profile-area" d="" />
        <path className="sv-profile-line" d="" />
        <g className="sv-profile-marks" />
      </svg>
    </figure>
  );
}
