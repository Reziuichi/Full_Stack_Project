// HTML markers anchored to geographic positions.
//
// Markers are DOM nodes in an overlay above the canvas, positioned every frame
// by projecting their 3D position with Cesium. This gives crisp typography
// that matches the site UI. A marker hides when it drops behind the horizon
// or leaves the viewport.

import type * as Cesium from "cesium";
import type { CesiumModule } from "../cesium/loadCesium";

export type MarkerKind = "origin" | "destination" | "attraction";

export interface MarkerSpec {
  id: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  height: number;
  label: string;
  sublabel?: string;
  index?: number;
  onClick?: () => void;
}

export interface MarkerHandle {
  readonly id: string;
  setHeight(height: number): void;
  setActive(active: boolean): void;
  remove(): void;
}

/** Connection animation state on origin/destination markers. */
export type LinkState = "none" | "burst" | "steady";

interface Entry {
  spec: MarkerSpec;
  el: HTMLElement;
  position: Cesium.Cartesian3;
  normal: Cesium.Cartesian3;
  visible: boolean;
  x: number;
  y: number;
  link: LinkState;
}

export class MarkerLayer {
  private entries = new Map<string, Entry>();
  private kindVisible: Record<MarkerKind, boolean> = { origin: true, destination: true, attraction: false };
  private readonly scratch2: Cesium.Cartesian2;
  private readonly scratch3: Cesium.Cartesian3;

  constructor(
    private readonly C: CesiumModule,
    private readonly viewer: Cesium.Viewer,
    private readonly root: HTMLElement,
  ) {
    this.scratch2 = new C.Cartesian2();
    this.scratch3 = new C.Cartesian3();
  }

  add(spec: MarkerSpec): MarkerHandle {
    this.entries.get(spec.id)?.el.remove();
    const el = document.createElement(spec.onClick ? "button" : "div");
    el.className = `gm gm--${spec.kind}`;
    el.dataset.visible = "false";
    if (spec.onClick) {
      (el as HTMLButtonElement).type = "button";
      el.setAttribute("aria-label", `Fly to ${spec.label}`);
      el.addEventListener("click", spec.onClick);
    }
    const index = spec.index !== undefined ? `<span class="gm__index">${String(spec.index + 1).padStart(2, "0")}</span>` : "";
    el.innerHTML = `
      <span class="gm__anchor">
        <span class="gm__pulse" aria-hidden="true"></span>
        <span class="gm__dot" aria-hidden="true"></span>
      </span>
      <span class="gm__label">${index}<span class="gm__text"></span></span>`;
    const text = el.querySelector(".gm__text")!;
    text.textContent = spec.label;
    if (spec.sublabel) {
      const sub = document.createElement("span");
      sub.className = "gm__sub";
      sub.textContent = spec.sublabel;
      text.after(sub);
    }
    this.root.appendChild(el);

    const entry: Entry = {
      spec,
      el,
      position: this.toCartesian(spec, spec.height),
      normal: new this.C.Cartesian3(),
      visible: false,
      x: Number.NaN,
      y: Number.NaN,
      link: "none",
    };
    this.C.Ellipsoid.WGS84.geodeticSurfaceNormal(entry.position, entry.normal);
    this.entries.set(spec.id, entry);

    return {
      id: spec.id,
      setHeight: (height) => {
        entry.spec.height = height;
        entry.position = this.toCartesian(entry.spec, height);
        entry.x = Number.NaN;
      },
      setActive: (active) => {
        entry.el.dataset.active = active ? "true" : "false";
      },
      remove: () => this.remove(spec.id),
    };
  }

  remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.el.remove();
    this.entries.delete(id);
  }

  removeKind(kind: MarkerKind) {
    for (const [id, e] of this.entries) if (e.spec.kind === kind) this.remove(id);
  }

  setKindVisible(kind: MarkerKind, visible: boolean) {
    this.kindVisible[kind] = visible;
  }

  /** Blink state for the A→B connection animation (CSS-driven; writes only on change). */
  setLink(id: string, state: LinkState) {
    const entry = this.entries.get(id);
    if (!entry || entry.link === state) return;
    entry.link = state;
    if (state === "burst") {
      // Restart the CSS animation even if the marker was bursting a moment ago.
      entry.el.dataset.link = "none";
      void entry.el.offsetWidth;
    }
    entry.el.dataset.link = state;
  }

  /** Reposition every marker. Call from scene.postRender. */
  update() {
    const C = this.C;
    const { scene, camera } = this.viewer;
    const canvas = scene.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cam = camera.positionWC;

    for (const entry of this.entries.values()) {
      let show = this.kindVisible[entry.spec.kind];
      if (show) {
        // Horizon test: is the camera above the tangent plane at the marker?
        const toCam = C.Cartesian3.subtract(cam, entry.position, this.scratch3);
        show = C.Cartesian3.dot(toCam, entry.normal) > -50;
      }
      let win: Cesium.Cartesian2 | undefined;
      if (show) {
        win = C.SceneTransforms.worldToWindowCoordinates(scene, entry.position, this.scratch2);
        show = !!win && win.x > -40 && win.x < w + 40 && win.y > -40 && win.y < h + 40;
      }
      const firstPlacement = Number.isNaN(entry.x);
      if (show && win && (firstPlacement || Math.abs(win.x - entry.x) > 0.25 || Math.abs(win.y - entry.y) > 0.25)) {
        entry.x = win.x;
        entry.y = win.y;
        entry.el.style.transform = `translate3d(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px, 0)`;
      }
      if (show !== entry.visible) {
        entry.visible = show;
        entry.el.dataset.visible = show ? "true" : "false";
      }
    }
  }

  destroy() {
    for (const e of this.entries.values()) e.el.remove();
    this.entries.clear();
  }

  private toCartesian(spec: MarkerSpec, height: number) {
    return this.C.Cartesian3.fromDegrees(spec.lng, spec.lat, height);
  }
}
