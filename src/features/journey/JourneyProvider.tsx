"use client";

// Journey state: where the traveller is, where they are going, what the 3D
// engine is doing and which scene the scroll position is in. Components read
// it through useJourney(); the GlobeEngine receives it imperatively.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { Attraction, DestinationSummary, LatLng, PlaceResult } from "@/lib/types";
import { distanceMeters } from "@/lib/geo";
import { buildTimeline, segmentOf, type SceneId, type Timeline } from "./timeline";
import { gsap } from "@/lib/gsap";
import { timezoneOrigin } from "@/features/location/timezoneOrigin";
import { GeolocationError, getBrowserPosition, permissionState, reverseGeocode } from "@/features/location/locationService";
import { loadDestination, type LoadedDestination } from "@/features/destinations/destinationService";
import type { ConnectionPhase, GlobeEngine, WorldStatus } from "@/features/globe/engine";

// ── State ───────────────────────────────────────────────────────────────────

export type LocationStatus = "idle" | "requesting" | "resolving" | "ready" | "denied" | "unavailable" | "unsupported" | "editing";

export interface LocationState {
  status: LocationStatus;
  place: PlaceResult | null;
  coords?: LatLng;
  accuracy?: number;
  source?: "browser" | "manual";
  message?: string;
}

export interface DestinationState {
  status: "idle" | "loading" | "ready" | "error";
  place: PlaceResult | null;
  data: LoadedDestination | null;
  /** True while showing our suggestion rather than the traveller's choice. */
  suggestion: boolean;
  error?: string;
}

export interface EngineState {
  status: "loading" | "ready" | "error";
  error?: string;
  imageryReady: boolean;
  /** Cesium ion terrain, imagery and OSM buildings. */
  world: WorldStatus;
  userControl: boolean;
  freeCamera: boolean;
  /** Origin → destination connection animation (blink, then draw). */
  connection: ConnectionPhase;
}

export interface SceneState {
  index: number;
  id: SceneId;
  attraction: number;
}

interface State {
  location: LocationState;
  destination: DestinationState;
  engine: EngineState;
  scene: SceneState;
}

type Action =
  | { type: "location"; patch: Partial<LocationState> & { status: LocationStatus } }
  | { type: "destination"; patch: Partial<DestinationState> }
  | { type: "engine"; patch: Partial<EngineState> }
  | { type: "scene"; scene: SceneState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "location":
      return { ...state, location: { ...state.location, ...action.patch } };
    case "destination":
      return { ...state, destination: { ...state.destination, ...action.patch } };
    case "engine":
      return { ...state, engine: { ...state.engine, ...action.patch } };
    case "scene":
      if (state.scene.index === action.scene.index && state.scene.attraction === action.scene.attraction) return state;
      return { ...state, scene: action.scene };
  }
}

const initialState: State = {
  location: { status: "idle", place: null },
  destination: { status: "idle", place: null, data: null, suggestion: true },
  engine: { status: "loading", imageryReady: false, world: { state: "loading" }, userControl: false, freeCamera: false, connection: "idle" },
  scene: { index: 0, id: "earth", attraction: -1 },
};

// ── Context ─────────────────────────────────────────────────────────────────

export interface Origin extends PlaceResult {
  approximate: boolean;
}

interface JourneyContextValue {
  state: State;
  origin: Origin;
  attractions: Attraction[];
  timeline: Timeline;
  catalog: DestinationSummary[];
  engineRef: RefObject<GlobeEngine | null>;
  sectionRef: RefObject<HTMLElement | null>;
  dispatchEngine(patch: Partial<EngineState>): void;
  setScene(scene: SceneState): void;
  requestLocation(): void;
  editOrigin(): void;
  setManualOrigin(place: PlaceResult): void;
  selectDestination(place: PlaceResult, options?: { autoplay?: boolean; suggestion?: boolean }): Promise<void>;
  scrollToScene(id: SceneId, options?: { attraction?: number; duration?: number; offset?: number }): void;
  /** Fly to the destination scene and open the destination picker. */
  explore(): void;
  /** If the page was opened with ?to=<destination>, fly there now. Returns true if it did. */
  consumeDeepLink(): boolean;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

/** Fired once the Explore scroll has landed on the destination scene. */
export const EXPLORE_ARRIVED_EVENT = "lgt:explore-arrived";

export function useJourney() {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used inside <JourneyProvider>");
  return ctx;
}

const noopSubscribe = () => () => {};
let timezoneCache: PlaceResult | null = null;
const getTimezoneOrigin = () => (timezoneCache ??= timezoneOrigin());

function catalogPlace(d: DestinationSummary): PlaceResult {
  return {
    id: `catalog:${d.slug}`,
    name: d.name,
    context: `${d.region}, ${d.country}`,
    lat: d.lat,
    lng: d.lng,
    destinationSlug: d.slug,
    packageCount: d.packageCount,
    source: "catalog",
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

export function JourneyProvider({ catalog, children }: { catalog: DestinationSummary[]; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const engineRef = useRef<GlobeEngine | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const destinationAbort = useRef<AbortController | null>(null);
  // Server render has no time zone; the client snapshot fills it in after hydration.
  const fallback = useSyncExternalStore(noopSubscribe, getTimezoneOrigin, () => null);

  const location = state.location;
  const origin: Origin = useMemo(() => {
    if (location.place) return { ...location.place, approximate: false };
    if (location.coords) {
      return { id: "browser", name: "Your location", context: "", ...location.coords, source: "browser", approximate: false };
    }
    const tz = fallback ?? { id: "tz", name: "New Delhi", context: "India", lat: 28.6139, lng: 77.209, source: "timezone" as const };
    return { ...tz, approximate: true };
  }, [location, fallback]);

  const originRef = useRef(origin);
  useEffect(() => {
    originRef.current = origin;
  }, [origin]);

  const attractions = useMemo(() => state.destination.data?.destination.attractions ?? [], [state.destination.data]);
  const timeline = useMemo(() => buildTimeline(attractions.length), [attractions.length]);

  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  // ── Scrolling ────────────────────────────────────────────────────────────
  /** Current scroll progress through the journey section (may be <0 or >1 outside it). */
  const progressNow = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return 0;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const distance = section.offsetHeight - window.innerHeight;
    return (window.scrollY - top) / Math.max(1, distance);
  }, []);

  /** Scroll to a journey progress. `onDone` runs when the scroll finishes or is interrupted. */
  const scrollToProgress = useCallback((progress: number, duration = 1.4, onDone?: () => void) => {
    const section = sectionRef.current;
    if (!section) return onDone?.();
    const top = section.getBoundingClientRect().top + window.scrollY;
    const distance = section.offsetHeight - window.innerHeight;
    const y = top + Math.max(0, Math.min(1, progress)) * distance;
    gsap.killTweensOf(window);
    if (duration <= 0) {
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      onDone?.();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      onDone?.();
    };
    gsap.to(window, {
      duration,
      ease: "power2.inOut",
      scrollTo: { y, autoKill: true, onAutoKill: done },
      onComplete: done,
      onInterrupt: done,
    });
  }, []);

  const scrollToScene = useCallback<JourneyContextValue["scrollToScene"]>(
    (id, options = {}) => {
      const seg = segmentOf(timelineRef.current, id, options.attraction);
      if (!seg) return;
      const at = seg.start + (seg.end - seg.start) * (options.offset ?? 0.5);
      scrollToProgress(at, options.duration ?? 1.4);
    },
    [scrollToProgress],
  );

  /**
   * The A→B sequence after choosing a destination:
   *   1. bring both places on screen (the "Where do you want to go?" scene),
   *   2. wait while both endpoints blink and the route line draws,
   *   3. fly along the line to the destination.
   * A newer call (another destination) or the traveller scrolling away cancels it.
   */
  const playTicket = useRef(0);
  const playRouteTo = useCallback(
    async (place: LatLng, destinationSlug: string) => {
      const tl = timelineRef.current;
      const choose = segmentOf(tl, "choose");
      const route = segmentOf(tl, "route");
      const arrive = segmentOf(tl, "arrive");
      if (!choose || !route || !arrive || !sectionRef.current) return;
      const ticket = ++playTicket.current;

      const connectAt = choose.start + (choose.end - choose.start) * 0.72;
      const current = progressNow();
      if (current < choose.start + (choose.end - choose.start) * 0.5 || current > route.start + 0.005) {
        await new Promise<void>((resolve) => scrollToProgress(connectAt, Math.abs(current - connectAt) > 0.25 ? 0 : 1.1, resolve));
      }
      if (ticket !== playTicket.current) return;

      await (engineRef.current?.waitForConnection(destinationSlug) ?? Promise.resolve(false));
      if (ticket !== playTicket.current) return;

      const now = progressNow();
      if (now < choose.start - 0.01 || now > route.start + 0.02) return; // traveller scrolled elsewhere
      const km = distanceMeters(originRef.current, place) / 1000;
      scrollToProgress(arrive.start + (arrive.end - arrive.start) * 0.9, Math.min(9, 4.5 + km / 2500));
    },
    [progressNow, scrollToProgress],
  );

  /** "Explore": fly to the destination scene, then open the destination picker. */
  const explore = useCallback(() => {
    const seg = segmentOf(timelineRef.current, "choose");
    if (!seg) return;
    const target = seg.start + (seg.end - seg.start) * 0.62;
    const distance = Math.abs(progressNow() - target);
    scrollToProgress(target, distance > 0.35 ? 0 : 1.6, () => window.dispatchEvent(new Event(EXPLORE_ARRIVED_EVENT)));
  }, [progressNow, scrollToProgress]);

  // ── Location ─────────────────────────────────────────────────────────────
  const locate = useCallback(async () => {
    dispatch({ type: "location", patch: { status: "requesting", message: undefined } });
    try {
      const { coords, accuracy } = await getBrowserPosition();
      dispatch({ type: "location", patch: { status: "resolving", coords, accuracy } });
      const place = await reverseGeocode(coords).catch(() => null);
      dispatch({
        type: "location",
        patch: {
          status: "ready",
          source: "browser",
          place: place
            ? { ...place, lat: coords.lat, lng: coords.lng, source: "browser" }
            : { id: "browser", name: "Your location", context: "", ...coords, source: "browser" },
        },
      });
    } catch (error) {
      const kind = error instanceof GeolocationError ? error.kind : "unavailable";
      dispatch({
        type: "location",
        patch: {
          status: kind === "denied" ? "denied" : kind === "unsupported" ? "unsupported" : "unavailable",
          message: error instanceof Error ? error.message : undefined,
        },
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Ask for the browser location as soon as the page loads; never block on it.
    void permissionState().then((perm) => {
      if (cancelled) return;
      if (perm === "denied") dispatch({ type: "location", patch: { status: "denied", message: "Location access is blocked for this site." } });
      else void locate();
    });
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const setManualOrigin = useCallback((place: PlaceResult) => {
    dispatch({ type: "location", patch: { status: "ready", place, source: "manual", coords: undefined, accuracy: undefined, message: undefined } });
    const engine = engineRef.current;
    if (engine) void engine.flyToLocation(place);
  }, []);

  const editOrigin = useCallback(() => dispatch({ type: "location", patch: { status: "editing" } }), []);

  // ── Destination ──────────────────────────────────────────────────────────
  const selectDestination = useCallback<JourneyContextValue["selectDestination"]>(
    async (place, options = {}) => {
      destinationAbort.current?.abort();
      const controller = new AbortController();
      destinationAbort.current = controller;
      dispatch({ type: "destination", patch: { status: "loading", place, suggestion: !!options.suggestion, error: undefined } });
      try {
        const data = await loadDestination(place, controller.signal);
        if (controller.signal.aborted) return;
        dispatch({ type: "destination", patch: { status: "ready", data } });
        if (options.autoplay) {
          // Let React commit the new timeline (attraction count) and the engine
          // receive the new route before starting the sequence.
          requestAnimationFrame(() => requestAnimationFrame(() => void playRouteTo(place, data.destination.slug)));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "destination",
          patch: { status: "error", error: error instanceof Error ? error.message : "Could not load this destination" },
        });
      }
    },
    [playRouteTo],
  );

  // Suggest a curated destination so the scroll journey always has somewhere to go.
  // A deep link (/?to=paris) selects that destination instead and flies there
  // once the globe has finished its intro (see JourneyExperience).
  const suggested = useRef(false);
  const deepLinked = useRef(false);
  useEffect(() => {
    if (suggested.current || !catalog.length) return;
    suggested.current = true;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("to");
    const match = requested && catalog.find((d) => d.slug === requested);
    if (match) {
      deepLinked.current = true;
      void selectDestination(catalogPlace(match), { suggestion: false });
      return;
    }
    const paris = catalog.find((d) => d.slug === "paris") ?? catalog[0];
    void selectDestination(catalogPlace(paris), { suggestion: true });
  }, [catalog, selectDestination]);

  // If the traveller turns out to be near our suggestion, suggest somewhere farther away.
  useEffect(() => {
    const d = state.destination;
    if (!d.suggestion || d.status !== "ready" || !d.place || origin.approximate) return;
    if (distanceMeters(origin, d.place) < 1_500_000) {
      const alt = catalog.find((c) => distanceMeters(origin, c) > 3_000_000 && c.slug !== d.place?.destinationSlug);
      if (alt) void selectDestination(catalogPlace(alt), { suggestion: true });
    }
  }, [origin, state.destination, catalog, selectDestination]);

  const destinationPlace = state.destination.place;
  const destinationSlug = state.destination.status === "ready" ? (state.destination.data?.destination.slug ?? null) : null;
  const consumeDeepLink = useCallback(() => {
    if (!deepLinked.current || !destinationPlace || !destinationSlug) return false;
    deepLinked.current = false;
    void playRouteTo(destinationPlace, destinationSlug);
    return true;
  }, [destinationPlace, destinationSlug, playRouteTo]);

  const value: JourneyContextValue = {
    state,
    origin,
    attractions,
    timeline,
    catalog,
    engineRef,
    sectionRef,
    dispatchEngine: useCallback((patch) => dispatch({ type: "engine", patch }), []),
    setScene: useCallback((scene) => dispatch({ type: "scene", scene }), []),
    requestLocation: () => void locate(),
    editOrigin,
    setManualOrigin,
    selectDestination,
    scrollToScene,
    explore,
    consumeDeepLink,
  };

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export { catalogPlace };
