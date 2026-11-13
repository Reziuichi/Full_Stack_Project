// The airplane that flies the route as you scroll.
//
// A DOM sprite (crisp SVG, styled by the site CSS) in the marker overlay,
// positioned every rendered frame by projecting its point on the arc. Its
// heading follows the arc's on-screen direction, it grows slightly at cruise
// altitude, and it shrinks away as it lands. A small HUD tag reads out the
// distance left.

import type * as Cesium from "cesium";
import type { CesiumModule } from "../cesium/loadCesium";
import type { RouteHandle } from "./route";
import { lineOfSight } from "./screen";

/** Top-down airliner in a 24×24 box, nose pointing right (+x), centred on (12, 12). */
export const PLANE_PATH =
  "M23 12c0-.65-.8-1.1-2-1.1h-6.8L8.6 2.6H6.8l3 8.3H5.2L3.2 7.4H2l.8 3.5c-.7.2-1 .6-1 1.1s.3.9 1 1.1L2 16.6h1.2l2-3.5h4.6l-3 8.3h1.8l5.6-8.3H21c1.2 0 2-.45 2-1.1Z";
const PLANE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PLANE_PATH}"/></svg>`;

/** How far ahead (as a route fraction) to sample the on-screen heading. */
const HEADING_LOOKAHEAD = 0.006;

export class PlaneSprite {
  private readonly el: HTMLElement;
  private readonly rot: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly p: Cesium.Cartesian3;
  private readonly q: Cesium.Cartesian3;
  private readonly winP: Cesium.Cartesian2;
  private readonly winQ: Cesium.Cartesian2;
  private route: RouteHandle | null = null;
  private code = "";
  private fraction: number | null = null;
  private visible = false;
  private x = Number.NaN;
  private y = Number.NaN;
  private angle = Number.NaN;
  private scale = 1;
  private fade = 1;
  private km = -1;
  private rotation = "";

  constructor(
    private readonly C: CesiumModule,
    private readonly viewer: Cesium.Viewer,
    root: HTMLElement,
  ) {
    this.el = document.createElement("div");
    this.el.className = "gp";
    this.el.dataset.visible = "false";
    this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML = `<span class="gp__rot"><span class="gp__craft">${PLANE_SVG}</span></span><span class="gp__tag"></span>`;
    this.rot = this.el.querySelector(".gp__rot")!;
    this.tag = this.el.querySelector(".gp__tag")!;
    root.appendChild(this.el);

    this.p = new C.Cartesian3();
    this.q = new C.Cartesian3();
    this.winP = new C.Cartesian2();
    this.winQ = new C.Cartesian2();
  }

  setRoute(route: RouteHandle | null, destinationCode: string) {
    this.route = route;
    this.code = destinationCode;
    this.fraction = null;
    this.km = -1;
    this.angle = Number.NaN;
  }

  /** Position along the route (0..1), or null to hide the plane. */
  set(fraction: number | null) {
    this.fraction = fraction;
  }

  /** Reposition the sprite. Call from scene.postRender. */
  update() {
    const C = this.C;
    const route = this.route;
    const f = this.fraction;
    const { scene, camera } = this.viewer;
    let show = !!route && f !== null;

    let win: Cesium.Cartesian2 | undefined;
    if (show && route && f !== null) {
      const p = route.pointAt(f, this.p);
      show = lineOfSight(camera.positionWC, p);
      if (show) {
        win = C.SceneTransforms.worldToWindowCoordinates(scene, p, this.winP);
        const canvas = scene.canvas;
        show = !!win && win.x > -60 && win.x < canvas.clientWidth + 60 && win.y > -60 && win.y < canvas.clientHeight + 60;
      }
      if (show && win) {
        // Heading: towards a point slightly further along the arc (or away from one just behind it at the very end).
        const forward = f + HEADING_LOOKAHEAD <= 1;
        const q = route.pointAt(forward ? f + HEADING_LOOKAHEAD : f - HEADING_LOOKAHEAD, this.q);
        const winQ = C.SceneTransforms.worldToWindowCoordinates(scene, q, this.winQ);
        if (winQ) {
          const dx = (winQ.x - win.x) * (forward ? 1 : -1);
          const dy = (winQ.y - win.y) * (forward ? 1 : -1);
          if (dx * dx + dy * dy > 0.01) {
            const target = Math.atan2(dy, dx);
            if (Number.isNaN(this.angle)) this.angle = target;
            else {
              // Shortest way round, lightly smoothed against projection jitter.
              const delta = Math.atan2(Math.sin(target - this.angle), Math.cos(target - this.angle));
              this.angle += delta * 0.55;
            }
          }
        }

        // Slightly larger at cruise altitude; shrinks and fades on the final approach.
        const scale = (1 + 0.2 * Math.sin(Math.PI * f)) * (0.55 + 0.45 * smooth((1 - f) / 0.05));
        const fade = smooth((1 - f) / 0.035);
        const angle = Number.isNaN(this.angle) ? 0 : this.angle;
        if (
          Number.isNaN(this.x) ||
          Math.abs(win.x - this.x) > 0.2 ||
          Math.abs(win.y - this.y) > 0.2 ||
          Math.abs(scale - this.scale) > 0.004 ||
          Math.abs(fade - this.fade) > 0.01
        ) {
          this.x = win.x;
          this.y = win.y;
          this.scale = scale;
          this.fade = fade;
          this.el.style.transform = `translate3d(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px, 0)`;
          this.el.style.opacity = fade.toFixed(3);
        }
        const rotation = `rotate(${angle.toFixed(3)}rad) scale(${scale.toFixed(3)})`;
        if (rotation !== this.rotation) {
          this.rotation = rotation;
          this.rot.style.transform = rotation;
        }

        const km = Math.round(((1 - f) * route.distanceMeters) / 1000 / 5) * 5;
        if (km !== this.km) {
          this.km = km;
          this.tag.textContent = `${km.toLocaleString("en-US")} km · ${this.code}`;
        }
      }
    }

    if (show !== this.visible) {
      this.visible = show;
      this.el.dataset.visible = show ? "true" : "false";
      if (!show) {
        this.x = Number.NaN;
        this.el.style.opacity = "";
      }
    }
  }

  destroy() {
    this.el.remove();
  }
}

function smooth(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
