// A halo of orbiting specks around the globe — the "rotating Earth with
// particles" look from the reference video. Each shell is a PointPrimitive
// collection rotated as a whole via its modelMatrix, so animation costs one
// matrix per shell per frame regardless of particle count.

import type * as Cesium from "cesium";
import type { CesiumModule } from "./loadCesium";

interface Shell {
  count: number;
  altMin: number;
  altMax: number;
  inclination: number; // deg
  node: number; // deg
  speed: number; // deg per second
  band: number; // deg, spread around the orbital plane (180 = full sphere)
}

const SHELLS: Shell[] = [
  { count: 420, altMin: 450e3, altMax: 1_300e3, inclination: 53, node: 0, speed: 1.6, band: 9 },
  { count: 380, altMin: 500e3, altMax: 1_600e3, inclination: 97, node: 70, speed: 1.3, band: 7 },
  { count: 300, altMin: 700e3, altMax: 2_000e3, inclination: 28, node: 150, speed: 1.1, band: 12 },
  { count: 260, altMin: 1_000e3, altMax: 2_600e3, inclination: 70, node: 230, speed: 0.8, band: 14 },
  { count: 520, altMin: 350e3, altMax: 3_200e3, inclination: 10, node: 300, speed: 0.35, band: 180 },
];

const EARTH_R = 6_371_000;
const DEG = Math.PI / 180;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OrbitalField {
  update(timeSeconds: number, cameraHeight: number): void;
  destroy(): void;
}

export function createOrbitalField(C: CesiumModule, scene: Cesium.Scene): OrbitalField {
  const rand = mulberry32(2485);
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

  const shells = SHELLS.map((shell) => {
    const collection = new C.PointPrimitiveCollection();
    const rotIncl = C.Matrix3.fromRotationX(shell.inclination * DEG);
    const rotNode = C.Matrix3.fromRotationZ(shell.node * DEG);
    const frame = C.Matrix3.multiply(rotNode, rotIncl, new C.Matrix3());
    const axis = C.Matrix3.multiplyByVector(frame, C.Cartesian3.UNIT_Z, new C.Cartesian3());

    for (let i = 0; i < shell.count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = shell.band >= 90 ? Math.asin(rand() * 2 - 1) : gauss() * shell.band * DEG;
      const r = EARTH_R + shell.altMin + rand() * (shell.altMax - shell.altMin);
      const local = new C.Cartesian3(r * Math.cos(phi) * Math.cos(theta), r * Math.cos(phi) * Math.sin(theta), r * Math.sin(phi));
      const position = C.Matrix3.multiplyByVector(frame, local, new C.Cartesian3());
      const bright = rand();
      collection.add({
        position,
        pixelSize: 0.9 + bright * 1.5,
        color: new C.Color(0.86, 0.9, 0.96, 0.25 + bright * 0.6),
      });
    }
    scene.primitives.add(collection);
    return { shell, collection, axis, quat: new C.Quaternion(), rot: new C.Matrix3() };
  });

  return {
    update(time, cameraHeight) {
      const visible = cameraHeight > 4_500_000;
      for (const s of shells) {
        s.collection.show = visible;
        if (!visible) continue;
        C.Quaternion.fromAxisAngle(s.axis, time * s.shell.speed * DEG, s.quat);
        C.Matrix3.fromQuaternion(s.quat, s.rot);
        s.collection.modelMatrix = C.Matrix4.fromRotationTranslation(s.rot, C.Cartesian3.ZERO, s.collection.modelMatrix);
      }
    },
    destroy() {
      for (const s of shells) scene.primitives.remove(s.collection);
    },
  };
}
