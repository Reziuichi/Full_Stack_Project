/**
 * The curtain's flaps, drawn off the page's main thread on a canvas the page
 * hands over (see board.ts for why). Messages in: init (the canvas, and the
 * screen it's for), shut, lift, clear. Out: ready, shut (all landed), lifted
 * (all gone).
 */
import { FlapBoard, type Point, type Shape } from "./board";

export type ToWorker =
  | { t: "init"; canvas: OffscreenCanvas; shape: Shape }
  | { t: "shut"; shape: Shape; origin: Point; calm: boolean }
  | { t: "lift" }
  | { t: "clear" };

export type FromWorker = { t: "ready" } | { t: "shut" } | { t: "lifted" };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
};

let board: FlapBoard | null = null;

scope.onmessage = ({ data }) => {
  if (data.t === "init") {
    board = new FlapBoard(data.canvas);
    // The GPU context gets made now, as the page loads, not when the wave starts.
    board.warm(data.shape);
    scope.postMessage({ t: "ready" });
    return;
  }
  if (!board) return;
  const b = board;
  if (data.t === "shut") {
    b.setup(data.shape);
    const landed = () => scope.postMessage({ t: "shut" });
    if (data.calm) b.still(landed);
    else b.shut(data.origin, landed);
  } else if (data.t === "lift") {
    b.lift(() => {
      b.clear();
      scope.postMessage({ t: "lifted" });
    });
  } else if (data.t === "clear") b.clear();
};
