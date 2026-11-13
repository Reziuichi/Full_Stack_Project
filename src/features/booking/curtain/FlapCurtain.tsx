"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
import { MOTION_QUERIES } from "@/lib/gsap";
import { FlapBoard, type Point, type Shape } from "./board";
import type { FromWorker, ToWorker } from "./flapWorker";

type CurtainApi = {
  /**
   * Black flaps fall across the screen in a wave from `origin`, and `lines`
   * flip in on the board they make. Resolves once the words have settled.
   */
  close(origin: Point, lines: string[]): Promise<void>;
  /**
   * The flaps fall away and the page underneath shows. The curtain does this
   * itself once the route changes; this is for opening without one.
   */
  open(): void;
  /** Covered and waiting for the next page to open it. */
  isClosed(): boolean;
};

const CurtainContext = createContext<CurtainApi | null>(null);

export function useCurtain() {
  const ctx = useContext(CurtainContext);
  if (!ctx) throw new Error("useCurtain needs <FlapCurtain>");
  return ctx;
}

/** Whatever draws the flaps: a worker the canvas was handed to, or the page. */
type Painter = {
  /** The wave from `origin` (calm: all shut at once); resolves when the last has landed. */
  shut(shape: Shape, origin: Point, calm: boolean): Promise<void>;
  /** All fall away; resolves when they're gone. */
  lift(): Promise<void>;
  /** Nothing left on the canvas. */
  clear(): void;
  dispose(): void;
};

function pagePainter(canvas: HTMLCanvasElement): Painter {
  const board = new FlapBoard(canvas);
  return {
    shut: (shape, origin, calm) =>
      new Promise((done) => {
        board.setup(shape);
        if (calm) board.still(done);
        else board.shut(origin, done);
      }),
    lift: () =>
      new Promise((done) =>
        board.lift(() => {
          board.clear();
          done();
        }),
      ),
    clear: () => board.clear(),
    dispose: () => board.release(),
  };
}

/**
 * The flaps drawn in a worker, on the canvas handed over to it; null where
 * the browser can't hand a canvas over. `onFail` runs if the worker dies, so
 * the page can take over with a canvas of its own.
 */
function workerPainter(
  canvas: HTMLCanvasElement,
  onFail: () => void,
): Painter | null {
  if (
    typeof Worker === "undefined" ||
    !("transferControlToOffscreen" in canvas)
  )
    return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./flapWorker.ts", import.meta.url), {
      type: "module",
    });
    const off = canvas.transferControlToOffscreen();
    const shape = {
      w: innerWidth,
      h: innerHeight,
      dpr: Math.min(2, devicePixelRatio || 1),
    };
    worker.postMessage({ t: "init", canvas: off, shape } satisfies ToWorker, [
      off,
    ]);
  } catch {
    return null;
  }
  // One question at a time: the reply it waits for, and how long it waits at most.
  let waiting: {
    reply: FromWorker["t"];
    done: () => void;
    timer: number;
  } | null = null;
  const answer = () => {
    if (!waiting) return;
    window.clearTimeout(waiting.timer);
    const { done } = waiting;
    waiting = null;
    done();
  };
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (waiting && data.t === waiting.reply) answer();
  };
  worker.onerror = () => {
    answer();
    onFail();
  };
  const ask = (message: ToWorker, reply: FromWorker["t"], within: number) =>
    new Promise<void>((done) => {
      answer();
      // Should no answer come, carry on anyway rather than hang the booking.
      waiting = { reply, done, timer: window.setTimeout(answer, within) };
      worker.postMessage(message);
    });
  return {
    shut: (shape, origin, calm) =>
      ask({ t: "shut", shape, origin, calm }, "shut", 2500),
    lift: () => ask({ t: "lift" }, "lifted", 2500),
    clear: () => worker.postMessage({ t: "clear" } satisfies ToWorker),
    dispose: () => {
      answer();
      worker.terminate();
    },
  };
}

/** How a line of the message arrives: each character rises out of the line, one after the next. */
const SAY = { duration: 560, stagger: 24, between: 160 };

/**
 * Set one line of the board's message in `host`, its characters rising into
 * place after `delay` ms (at once when calm). Each character is a span of its
 * own in a line that clips them; the animations hold nothing once done.
 */
function sayLine(
  host: HTMLElement,
  text: string,
  className: string,
  delay: number,
  calm: boolean,
) {
  const line = document.createElement("span");
  line.className = className;
  const chars = [...text].map((ch) => {
    const c = document.createElement("span");
    c.textContent = ch === " " ? "\u00a0" : ch;
    line.append(c);
    return c;
  });
  host.append(line);
  if (calm) return;
  chars.forEach((c, i) =>
    c.animate(
      [{ transform: "translateY(115%)" }, { transform: "translateY(0)" }],
      {
        duration: SAY.duration,
        delay: delay + i * SAY.stagger,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      },
    ),
  );
}

/**
 * The booking flow's page change, kept in the /book layout so it spans the
 * move from the booking page to the confirmation: the screen turns into a
 * board of blank flaps, says what happened, and flips open on the next page.
 */
export function FlapCurtain({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const painter = useRef<Painter | null>(null);
  const closed = useRef(false);
  const watchdog = useRef(0);
  /** When the board's words will have settled: the curtain stays shut until then. */
  const settled = useRef(0);
  /** The page it shut over; it opens when the route moves on from there. */
  const shutOn = useRef("");
  const pathname = usePathname();

  // The canvas the flaps are drawn on, made here (not by React) since it's
  // handed over to the worker, and handed over as the page loads, so the
  // worker has its GPU context ready long before the booking is sent.
  useEffect(() => {
    const host = root.current!;
    let canvas: HTMLCanvasElement | null = null;
    const fresh = () => {
      canvas?.remove();
      canvas = document.createElement("canvas");
      canvas.className = "fc-canvas";
      host.prepend(canvas);
      return canvas;
    };
    const takeOver = () => {
      painter.current?.dispose();
      painter.current = pagePainter(fresh());
    };
    painter.current = workerPainter(fresh(), takeOver) ?? pagePainter(fresh());
    return () => {
      window.clearTimeout(watchdog.current);
      painter.current?.dispose();
      painter.current = null;
      canvas?.remove();
    };
  }, []);

  const clear = useCallback(() => {
    board.current?.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    board.current?.replaceChildren();
  }, []);

  const open = useCallback(() => {
    const attempt = () => {
      const el = root.current;
      window.clearTimeout(watchdog.current);
      if (!el || !closed.current) return;
      // Let the board finish saying what happened before the next page shows.
      const wait = settled.current - performance.now();
      if (wait > 0) {
        watchdog.current = window.setTimeout(attempt, wait);
        return;
      }
      closed.current = false;
      const calm = matchMedia(MOTION_QUERIES.reduce).matches;
      // The words fade line by line: fading the whole board would make a
      // screen-sized layer of it just as the flaps start to fall.
      board.current?.querySelectorAll(".fc-line").forEach((line) =>
        line.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: calm ? 150 : 260,
          fill: "forwards",
        }),
      );
      const finish = () => {
        if (closed.current) return;
        el.removeAttribute("data-on");
        el.getAnimations().forEach((a) => a.cancel());
        clear();
      };
      const p = painter.current;
      if (calm || !p) {
        // No wave: the board fades away.
        const faded = () => {
          if (!closed.current) p?.clear();
          finish();
        };
        el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 200,
          fill: "forwards",
        }).finished.then(faded, faded);
        return;
      }
      void p.lift().then(finish);
    };
    attempt();
  }, [clear]);

  const close = useCallback<CurtainApi["close"]>(
    (origin, lines) => {
      const el = root.current!;
      const calm = matchMedia(MOTION_QUERIES.reduce).matches;
      clear();
      el.setAttribute("data-on", "");
      el.getAnimations().forEach((a) => a.cancel());
      closed.current = true;
      shutOn.current = window.location.pathname;
      // If the next page never arrives to open it, open anyway.
      window.clearTimeout(watchdog.current);
      watchdog.current = window.setTimeout(open, 15000);
      const shape = {
        w: innerWidth,
        h: innerHeight,
        dpr: Math.min(2, devicePixelRatio || 1),
      };
      const shut =
        painter.current?.shut(shape, origin, calm) ?? Promise.resolve();

      /** Put the words on the board; returns when they'll have settled. */
      const showLines = () => {
        const host = board.current!;
        // The last line starts last, and its last character lands last…
        const longest = Math.max(...lines.map((l) => l.length));
        const said =
          performance.now() +
          (calm
            ? 0
            : (lines.length - 1) * SAY.between +
              (longest - 1) * SAY.stagger +
              SAY.duration);
        // …then a beat to read them before the board opens.
        settled.current = said + (calm ? 600 : 650);
        lines.forEach((line, i) =>
          sayLine(
            host,
            line,
            i === 0 ? "fc-line fc-line-lead" : "fc-line",
            i * SAY.between,
            calm,
          ),
        );
        return said;
      };

      if (calm) {
        // No wave: the board fades in, already shut, and the page changes
        // under it only once it's drawn and covering.
        const shown = el
          .animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 180,
            fill: "forwards",
          })
          .finished.catch(() => {});
        showLines();
        return Promise.all([shut, shown]).then(() => {});
      }
      return shut.then(
        () =>
          new Promise<void>((resolve) => {
            const said = showLines();
            // Hand over once the words have settled: the next page's first
            // render (and the GPU's first paint of it) then happens under a
            // still board.
            window.setTimeout(resolve, said - performance.now());
          }),
      );
    },
    [clear, open],
  );

  // The next page has arrived (the confirmation, or anything else, such as
  // its error view): open onto it, once the board has said its piece.
  useEffect(() => {
    if (closed.current && pathname !== shutOn.current) open();
  }, [pathname, open]);

  const api = useMemo<CurtainApi>(
    () => ({ close, open, isClosed: () => closed.current }),
    [close, open],
  );

  return (
    <CurtainContext.Provider value={api}>
      {children}
      <div ref={root} className="fc" aria-hidden>
        <div ref={board} className="fc-board" />
      </div>
    </CurtainContext.Provider>
  );
}
