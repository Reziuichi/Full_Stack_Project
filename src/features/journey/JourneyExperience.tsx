"use client";

// The hero: a sticky, full-viewport Cesium globe with the scroll-driven journey
// layered on top. The section is N viewports tall; GSAP ScrollTrigger turns
// the scroll position into progress (0..1), which drives the 3D camera
// (via the engine) and the scene overlays.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { placeCode } from "@/lib/geo";
import { ScrollTrigger, useGSAP } from "@/lib/gsap";
import type { EngineCallbacks, GlobeEngine } from "@/features/globe/engine";
import { useJourney } from "./JourneyProvider";
import { progressStore } from "./progressStore";
import { ATTRACTION_REST, sceneAt, type SceneId } from "./timeline";
import { EXPLORE_EVENT } from "@/components/layout/ExploreLink";
import { SceneTitle } from "./components/SceneTitle";
import { HudBar, type HudBarHandle } from "./components/HudBar";
import { SceneRail } from "./components/SceneRail";
import { ConfigNotice } from "./components/ConfigNotice";
import { EarthPanel } from "./components/panels/EarthPanel";
import { LocationPanel } from "./components/panels/LocationPanel";
import { ChoosePanel } from "./components/panels/ChoosePanel";
import { RoutePanel } from "./components/panels/RoutePanel";
import { DestinationPanel } from "./components/panels/DestinationPanel";
import { AttractionPanel } from "./components/panels/AttractionPanel";
import { OutroPanel } from "./components/panels/OutroPanel";

const GlobeCanvas = dynamic(() => import("@/features/globe/GlobeCanvas"), { ssr: false });

const coarseQuery = "(pointer: coarse)";
const subscribeCoarse = (cb: () => void) => {
  const mq = window.matchMedia(coarseQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function JourneyExperience() {
  const journey = useJourney();
  const { state, origin, attractions, timeline, engineRef, sectionRef, dispatchEngine, setScene, scrollToScene, consumeDeepLink, explore } = journey;
  const hudRef = useRef<HudBarHandle>(null);
  const timelineRef = useRef(timeline);
  const introPlayed = useRef(false);
  const coarse = useSyncExternalStore(subscribeCoarse, () => window.matchMedia(coarseQuery).matches, () => false);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  // ── Engine wiring ─────────────────────────────────────────────────────────
  const onEngine = useCallback(
    (engine: GlobeEngine | null) => {
      engineRef.current = engine;
      dispatchEngine(engine ? { status: "ready" } : { status: "loading", imageryReady: false });
    },
    [engineRef, dispatchEngine],
  );

  const callbacks: EngineCallbacks = useMemo(
    () => ({
      onWorldStatus: (world) => dispatchEngine({ world }),
      onUserControl: (active) => dispatchEngine(active ? { userControl: true } : { userControl: false, freeCamera: false }),
      onAttractionSelect: (i) => scrollToScene("attraction", { attraction: i, offset: ATTRACTION_REST }),
      onTelemetry: (t) => hudRef.current?.telemetry(t),
      onReady: () => dispatchEngine({ imageryReady: true }),
      onConnection: (connection) => dispatchEngine({ connection }),
    }),
    [dispatchEngine, scrollToScene],
  );

  // Push journey state into the engine whenever it changes.
  const destination = state.destination.data?.destination ?? null;
  const engineReady = state.engine.status === "ready";
  useEffect(() => {
    engineRef.current?.setJourney({ origin, destination, attractions, timeline });
  }, [engineReady, engineRef, origin, destination, attractions, timeline]);

  // Opening shot once imagery is in, unless the page was restored mid-journey.
  useEffect(() => {
    if (!state.engine.imageryReady || introPlayed.current || !engineRef.current) return;
    introPlayed.current = true;
    if (progressStore.get() < 0.02) engineRef.current.playIntro();
  }, [state.engine.imageryReady, engineRef]);

  // Deep link (/?to=paris): fly there shortly after the intro.
  useEffect(() => {
    if (!state.engine.imageryReady || state.destination.status !== "ready") return;
    const t = setTimeout(() => consumeDeepLink(), 2200);
    return () => clearTimeout(t);
  }, [state.engine.imageryReady, state.destination.status, consumeDeepLink]);

  // "Explore" from the nav/footer on this page, or arriving at /#explore from another page.
  const pendingExplore = useRef(false);
  useEffect(() => {
    if (window.location.hash === "#explore") {
      pendingExplore.current = true;
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
    }
    const onExplore = () => explore();
    window.addEventListener(EXPLORE_EVENT, onExplore);
    return () => window.removeEventListener(EXPLORE_EVENT, onExplore);
  }, [explore]);

  useEffect(() => {
    // Wait until the journey has its final length (destination loaded) before scrolling.
    if (!pendingExplore.current || state.destination.status !== "ready" || state.engine.status !== "ready") return;
    pendingExplore.current = false;
    const t = setTimeout(explore, 300);
    return () => clearTimeout(t);
  }, [state.destination.status, state.engine.status, explore]);

  // ── Scroll → progress ─────────────────────────────────────────────────────
  useGSAP(
    () => {
      ScrollTrigger.config({ ignoreMobileResize: true });
      const trigger = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          const p = self.progress;
          progressStore.set(p);
          engineRef.current?.setProgress(p);
          setScene(sceneAt(timelineRef.current, p));
        },
      });
      const p = trigger.progress;
      progressStore.set(p);
      engineRef.current?.setProgress(p);
      setScene(sceneAt(timelineRef.current, p));
    },
    { dependencies: [timeline.totalWeight], revertOnUpdate: true },
  );

  // ── Scene copy ────────────────────────────────────────────────────────────
  const scene = state.scene;
  const title = sceneTitle(scene.id, scene.attraction, {
    origin: origin.name,
    locating: state.location.status === "requesting" || state.location.status === "resolving",
    needsInput: ["denied", "unavailable", "unsupported", "editing"].includes(state.location.status),
    destination: destination?.name,
    attraction: attractions[scene.attraction]?.name,
  });

  const total = timeline.segments.length;
  const is = (id: SceneId) => scene.id === id;

  return (
    <section
      ref={sectionRef}
      id="journey"
      aria-label="Plan your trip on the 3D Earth"
      className="relative"
      style={{ height: `${(timeline.totalWeight + 1) * 100}vh` }}
    >
      <h1 className="sr-only">Longitude — plan your trip from orbit</h1>
      <p className="sr-only" aria-live="polite">
        {title}
      </p>

      <div className="sticky top-0 h-[100dvh] overflow-hidden bg-space">
        <GlobeCanvas onEngine={onEngine} callbacks={callbacks} interactive={!coarse || state.engine.freeCamera} />

        {/* Legibility vignettes — non-interactive */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-space/80 to-transparent" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-space/85 via-space/30 to-transparent" aria-hidden />

        {/* Giant scene title — top on phones, along the bottom edge on desktop like the reference */}
        <div
          className="pointer-events-none absolute left-4 right-4 top-[4.5rem] z-10 [--title-max:11.5vw] [--title-width:calc(100vw-2rem)] sm:left-6 lg:bottom-[3.4rem] lg:left-8 lg:right-8 lg:top-auto lg:[--title-max:9.4vw] lg:[--title-width:calc(100vw-4rem-26rem)]"
        >
          <SceneTitle text={title} />
        </div>

        {/* Scene panels */}
        <div className="pointer-events-none absolute inset-x-3 bottom-[7.5rem] top-[40%] z-20 sm:inset-x-6 lg:bottom-[calc(3.4rem+9vw)] lg:left-auto lg:right-14 lg:top-[5.5rem] lg:w-[400px] xl:right-20">
          <div className="relative h-full">
            <EarthPanel active={is("earth")} total={total} />
            <LocationPanel active={is("location")} total={total} />
            <ChoosePanel active={is("choose")} total={total} />
            <RoutePanel active={is("route")} total={total} />
            <DestinationPanel active={is("arrive")} total={total} />
            {attractions.map((a, i) => (
              <AttractionPanel key={a.slug} index={i} active={is("attraction") && scene.attraction === i} />
            ))}
            <OutroPanel active={is("outro")} total={total} />
          </div>
        </div>

        <SceneRail />
        <HudBar ref={hudRef} />
        <ConfigNotice />
        <LoadingVeil ready={state.engine.imageryReady} />
      </div>
    </section>
  );
}

function sceneTitle(
  id: SceneId,
  attraction: number,
  c: { origin: string; locating: boolean; needsInput: boolean; destination?: string; attraction?: string },
): string {
  switch (id) {
    case "earth":
      return "Plan from orbit";
    case "location":
      return c.locating ? "Locating…" : c.needsInput ? "Your origin" : c.origin;
    case "choose":
      return "Where to next?";
    case "route":
      return c.destination ? `${placeCode(c.origin)} → ${placeCode(c.destination)}` : "En route";
    case "arrive":
      return c.destination ?? "Arrival";
    case "attraction":
      return c.attraction ?? `Stop ${attraction + 1}`;
    case "outro":
      return "Book the trip";
  }
}

/** Black veil over the canvas until the first globe imagery is in — then the intro plays. */
function LoadingVeil({ ready }: { ready: boolean }) {
  return (
    <div
      aria-hidden={ready}
      className={`absolute inset-0 z-30 bg-space transition-opacity duration-[1400ms] ease-out ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div className="hud absolute bottom-16 left-4 flex items-center gap-3 text-muted sm:left-6 lg:left-8">
        <span className="status-dot" data-state="active" />
        Initialising globe · streaming imagery
      </div>
    </div>
  );
}
