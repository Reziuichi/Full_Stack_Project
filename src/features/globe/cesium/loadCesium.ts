// Loads the prebuilt CesiumJS bundle from /cesium (copied there from
// node_modules by scripts/copy-cesium-assets.mjs) and returns the global
// `Cesium` namespace. Types come from the npm package via `import type`, so
// the engine stays fully typed without bundling 6 MB of Cesium through Next.

import type * as CesiumNS from "cesium";

export type CesiumModule = typeof CesiumNS;

declare global {
  interface Window {
    Cesium?: CesiumModule;
    CESIUM_BASE_URL?: string;
  }
}

export const CESIUM_BASE_URL = "/cesium";

let pending: Promise<CesiumModule> | null = null;

export function loadCesium(): Promise<CesiumModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("CesiumJS can only be loaded in the browser"));
  }
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (pending) return pending;

  // Must be set before Cesium.js executes so workers and assets resolve.
  window.CESIUM_BASE_URL = CESIUM_BASE_URL;

  if (!document.querySelector("link[data-cesium-widgets]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${CESIUM_BASE_URL}/Widgets/widgets.css`;
    link.dataset.cesiumWidgets = "";
    document.head.appendChild(link);
  }

  pending = new Promise<CesiumModule>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${CESIUM_BASE_URL}/Cesium.js`;
    script.async = true;
    script.onload = () => {
      if (window.Cesium) resolve(window.Cesium);
      else reject(new Error("CesiumJS loaded but did not register window.Cesium"));
    };
    script.onerror = () => {
      pending = null;
      script.remove();
      reject(
        new Error(`Could not load ${CESIUM_BASE_URL}/Cesium.js. Run "npm run cesium:copy" to copy the CesiumJS build into public/.`),
      );
    };
    document.head.appendChild(script);
  });
  return pending;
}
