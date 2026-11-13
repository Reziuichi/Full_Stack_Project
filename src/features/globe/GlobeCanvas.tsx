"use client";

// Mounts the Cesium-powered GlobeEngine into the page. Imported with
// next/dynamic({ ssr: false }) because Cesium needs WebGL and the DOM.

import { useEffect, useRef, useState } from "react";
import { publicEnv } from "@/lib/env";
import { GlobeEngine, type EngineCallbacks } from "./engine";

export interface GlobeCanvasProps {
  onEngine(engine: GlobeEngine | null): void;
  callbacks: EngineCallbacks;
  /** When false (touch devices outside free-camera mode) the page scrolls through the globe. */
  interactive: boolean;
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/webgl/i.test(message)) {
    return "Your browser could not start WebGL, which the 3D Earth needs. Enable hardware acceleration in your browser settings, or try a current version of Chrome, Edge, Firefox or Safari.";
  }
  return message;
}

export default function GlobeCanvas({ onEngine, callbacks, interactive }: GlobeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const callbacksRef = useRef(callbacks);
  const onEngineRef = useRef(onEngine);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbacksRef.current = callbacks;
    onEngineRef.current = onEngine;
  });

  useEffect(() => {
    let cancelled = false;
    let engine: GlobeEngine | null = null;
    // Proxy so the engine always calls the latest React callbacks.
    const proxy: EngineCallbacks = {
      onWorldStatus: (s) => callbacksRef.current.onWorldStatus?.(s),
      onUserControl: (a) => callbacksRef.current.onUserControl?.(a),
      onAttractionSelect: (i) => callbacksRef.current.onAttractionSelect?.(i),
      onTelemetry: (t) => callbacksRef.current.onTelemetry?.(t),
      onReady: () => callbacksRef.current.onReady?.(),
      onConnection: (phase) => callbacksRef.current.onConnection?.(phase),
    };

    GlobeEngine.create({
      container: hostRef.current!,
      creditContainer: creditRef.current!,
      markerContainer: markerRef.current!,
      ionToken: publicEnv.cesiumIonToken,
      accentColor: "#e6a36a",
      callbacks: proxy,
    })
      .then((e) => {
        if (cancelled) {
          e.destroy();
          return;
        }
        engine = e;
        engineRef.current = e;
        onEngineRef.current(e);
      })
      .catch((err) => {
        if (!cancelled) setError(describeFailure(err));
      });

    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
      onEngineRef.current(null);
    };
  }, []);

  // Stop rendering when the globe scrolls out of view.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(([entry]) => engineRef.current?.setActive(entry.isIntersecting), { rootMargin: "80px" });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  return (
    <div className="absolute inset-0">
      <div
        ref={hostRef}
        className={`globe-host absolute inset-0 ${interactive ? "" : "pointer-events-none"}`}
        aria-label="Interactive 3D Earth"
        role="application"
      />
      <div ref={markerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div
        ref={creditRef}
        className="globe-credits pointer-events-auto absolute bottom-[3.25rem] left-3 right-3 z-10 text-right sm:left-auto sm:right-6 sm:w-[24rem] lg:right-8"
      />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-space/90 p-6">
          <div className="glass max-w-md rounded-2xl p-6">
            <p className="eyebrow text-danger">3D Earth unavailable</p>
            <p className="mt-3 text-sm leading-relaxed text-dim">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
