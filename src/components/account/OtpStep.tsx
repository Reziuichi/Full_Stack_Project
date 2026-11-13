"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowLeft, ArrowUpRight, Check } from "@phosphor-icons/react";
import { CustomWiggle, gsap } from "@/lib/gsap";
import { scrambleText } from "@/lib/textFx";

export type OtpTicket = {
  challenge: string;
  email: string;
  purpose: "REGISTER" | "LOGIN";
  length: number;
  expiresAt: string;
  resendAt: string;
  attemptsLeft: number;
  maxAttempts: number;
  devCode?: string;
};

/** idle: typing · checking: waiting on the server · wrong: a miss, clearing · dead: expired or locked · ok: verified. */
export type OtpPhase = "idle" | "checking" | "wrong" | "dead" | "ok";
type Note = { tone: "info" | "error" | "ok"; text: string } | null;
type SessionUser = { id: string; name: string; email: string };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A head-shake that dies away: five swings, each smaller than the last. */
let refuseEase: gsap.EaseFunction | null = null;
const refuse = () => (refuseEase ??= CustomWiggle.create("otp-refuse", { wiggles: 5, type: "easeOut" }));

/**
 * One turn of a split-flap tile inside a slot, like a departures board: the
 * top half of the old face falls forward on the hinge, then the bottom half
 * of the new face swings down into place and settles with a small mechanical
 * bounce, each flap darkening as it tilts away from the light. It is an
 * overlay of its own, so the slot React renders is never touched.
 */
function flap(slot: HTMLElement, from: string, to: string) {
  const overlay = document.createElement("span");
  overlay.className = "otp-flap";
  const half = (where: "top" | "bottom", text: string, fold = false) => {
    const h = document.createElement("span");
    h.className = `otp-flap-half is-${where}`;
    const face = document.createElement("span");
    face.className = "otp-flap-face";
    face.textContent = text;
    h.append(face);
    if (fold) {
      const shade = document.createElement("span");
      shade.className = "otp-flap-shade";
      h.append(shade);
    }
    return h;
  };
  const fall = half("top", from, true);
  const land = half("bottom", to, true);
  // Behind: the new face's top and the old face's bottom. In front: the two flaps that move.
  overlay.append(half("top", to), half("bottom", from), fall, land);
  slot.append(overlay);
  gsap.set(overlay, { autoAlpha: 0 });
  gsap.set(land, { rotationX: 90 });
  const tl = gsap
    .timeline()
    .set(overlay, { autoAlpha: 1, immediateRender: false })
    .to(fall, { rotationX: -90, duration: 0.19, ease: "power2.in" })
    .to(fall.lastChild, { opacity: 0.55, duration: 0.19, ease: "power2.in" }, "<")
    .set(fall, { autoAlpha: 0 })
    .to(land, { rotationX: 0, duration: 0.38, ease: "back.out(2)" })
    .fromTo(land.lastChild, { opacity: 0.5 }, { opacity: 0, duration: 0.3, ease: "power2.out" }, "<");
  return { overlay, tl };
}

/**
 * The emailed code, as six slots on the boarding pass. One real input sits
 * over them (so paste, autofill and screen readers just work) and the slots
 * draw what's typed: each digit pops in, the caret blinks in the next slot,
 * and a full code is checked straight away while a light sweeps the row.
 *
 * Wrong: the row shakes its head (a wiggle that dies away), tints red, and
 * every slot turns over like a departures-board tile, left to right, to a red
 * cross; a beat later the crosses turn over again to blank tiles and the
 * caret comes back for another go. The message decodes in and one of the
 * "tries" pips drains. Expired or out of tries: the tiles turn to dashes and
 * stay there until a new code is sent. Right: the slots fill amber
 * left to right, the digits lift away, the slots slide together into a single
 * seal and a tick draws itself inside it, then the pass is cleared.
 */
export function OtpStep({
  ticket,
  doneLabel,
  onTicket,
  onPhase,
  onVerified,
  onBack,
}: {
  ticket: OtpTicket;
  /** Set once the pass is cleared: the button's closing line ("Welcome aboard, Tejas"). */
  doneLabel?: string;
  onTicket: (t: OtpTicket) => void;
  onPhase: (p: OtpPhase) => void;
  onVerified: (user: SessionUser) => void;
  onBack: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const len = ticket.length;
  const [code, setCode] = useState("");
  const [phase, setPhaseState] = useState<OtpPhase>("idle");
  const [note, setNote] = useState<Note>(null);
  const [focused, setFocused] = useState(false);
  const [restart, setRestart] = useState(false);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tries, setTries] = useState(ticket.attemptsLeft);
  const phaseRef = useRef<OtpPhase>("idle");
  // The refusal in progress, and the flap tiles standing over the slots.
  const refusal = useRef<gsap.core.Timeline | null>(null);
  const tiles = useRef<HTMLElement[]>([]);

  const setPhase = (p: OtpPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
    onPhase(p);
  };

  const resendIn = new Date(ticket.resendAt).getTime() - now;
  const expiresIn = new Date(ticket.expiresAt).getTime() - now;

  // A clock for the countdowns; it stops once the code is used.
  useEffect(() => {
    if (phase === "ok") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Out of time: the code is dead before anyone has to find out the hard way.
  useEffect(() => {
    if (expiresIn <= 0 && (phaseRef.current === "idle" || phaseRef.current === "wrong")) {
      setPhase("dead");
      setNote({ tone: "error", text: "This code has expired. Send yourself a new one." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the clock matters here
  }, [expiresIn <= 0]);

  // The slots rise in, one after another.
  useEffect(() => {
    const slots = root.current?.querySelectorAll(".otp-slot");
    if (!slots || reduced()) return;
    const tw = gsap.fromTo(
      slots,
      { y: 14, autoAlpha: 0, scale: 0.94 },
      { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: "expo.out", stagger: 0.045, delay: 0.12, clearProps: "transform,opacity,visibility" },
    );
    return () => void tw.kill();
  }, [ticket.challenge]);

  const focusInput = () => input.current?.focus({ preventScroll: true });

  // A refusal's message decodes in, like the rest of the HUD.
  useEffect(() => {
    if (note?.tone !== "error" || reduced()) return;
    const fx = scrambleText(root.current?.querySelector(".otp-note span") ?? null, { duration: 0.65 });
    return () => {
      fx.tween.kill();
      fx.restore();
    };
  }, [note]);

  const clearTiles = () => {
    refusal.current?.kill();
    refusal.current = null;
    tiles.current.forEach((t) => t.remove());
    tiles.current = [];
  };

  /** Adds a wave that turns every slot over to `face`, left to right; returns when the last tile settles. */
  const turnOver = (face: string, tl: gsap.core.Timeline, start: number, stagger = 0.065) => {
    const slots = [...root.current!.querySelectorAll<HTMLElement>(".otp-slot")];
    const standing = tiles.current.slice(-slots.length);
    slots.forEach((slot, i) => {
      const digit = slot.querySelector<HTMLElement>(".otp-digit");
      const f = flap(slot, standing[i]?.dataset.face ?? digit?.textContent ?? "", face);
      f.overlay.dataset.face = face;
      const at = start + i * stagger;
      if (digit) tl.set(digit, { opacity: 0, immediateRender: false }, at);
      tl.add(f.tl, at);
      tiles.current.push(f.overlay);
    });
    return start + (slots.length - 1) * stagger + 0.57;
  };

  const miss = (attemptsLeft: number) => {
    clearTiles();
    setPhase("wrong");
    setTries(attemptsLeft);
    setNote({ tone: "error", text: `That code doesn't match. ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` });
    navigator.vibrate?.([28, 40, 28]);
    const clear = () => {
      clearTiles();
      setCode("");
      if (phaseRef.current === "wrong") setPhase("idle");
      focusInput();
    };
    if (reduced()) {
      // No movement: the red digits fade out, then the slots clear.
      gsap.to(root.current!.querySelectorAll(".otp-digit"), { opacity: 0, duration: 0.3, delay: 0.55, onComplete: clear });
      return;
    }
    const tl = gsap.timeline({ onComplete: clear });
    refusal.current = tl;
    // The row shakes its head...
    tl.to(root.current!.querySelector(".otp-row"), { x: 10, duration: 0.62, ease: refuse() }, 0);
    // ...every tile turns over to a red cross...
    const crossed = turnOver("×", tl, 0.1);
    // ...and, a beat later, over again to a blank tile, a little quicker.
    const blank = gsap.timeline();
    turnOver("", blank, 0, 0.045);
    tl.add(blank.timeScale(1.25), crossed + 0.2);
  };

  const dead = (text: string, startOver = false, spent = false) => {
    clearTiles();
    setPhase("dead");
    setRestart(startOver);
    setNote({ tone: "error", text });
    if (spent) setTries(0);
    navigator.vibrate?.(40);
    if (reduced()) return;
    // The board closes: every tile turns to a dash and stays until a new code is sent.
    const tl = gsap.timeline();
    refusal.current = tl;
    tl.to(root.current!.querySelector(".otp-row"), { x: 8, duration: 0.55, ease: refuse() }, 0);
    turnOver("–", tl, 0.1);
  };

  const hiccup = (text: string) => {
    setPhase("idle");
    setNote({ tone: "error", text });
    if (!reduced()) gsap.to(root.current!.querySelector(".otp-row"), { x: 5, duration: 0.45, ease: refuse() });
  };

  const verified = (user: SessionUser) => {
    setPhase("ok");
    setNote({ tone: "ok", text: "Verified. Clearing you for departure." });
    const el = root.current!;
    const row = el.querySelector<HTMLElement>(".otp-row")!;
    const slots = [...el.querySelectorAll<HTMLElement>(".otp-slot")];
    const digits = [...el.querySelectorAll<HTMLElement>(".otp-digit")];
    const seal = el.querySelector<HTMLElement>(".otp-seal")!;
    if (reduced()) {
      // No travel: the slots fade and the seal fades in where they were.
      gsap.to(row, { autoAlpha: 0, duration: 0.25, delay: 0.3 });
      gsap.to(seal, { autoAlpha: 1, duration: 0.3, delay: 0.45, onComplete: () => onVerified(user) });
      return;
    }
    const mid = row.getBoundingClientRect();
    const cx = mid.left + mid.width / 2;
    gsap
      .timeline()
      // The slots have filled amber (CSS, left to right); the digits lift away...
      .to(digits, { y: -10, autoAlpha: 0, duration: 0.3, ease: "power2.out", stagger: 0.035 }, 0.42)
      .to(row.querySelector(".otp-dash"), { autoAlpha: 0, duration: 0.2 }, 0.5)
      // ...and the slots slide together into one seal.
      .to(
        slots,
        {
          x: (_: number, s: HTMLElement) => cx - (s.getBoundingClientRect().left + s.offsetWidth / 2),
          scale: 0.55,
          autoAlpha: 0,
          duration: 0.6,
          ease: "power3.inOut",
          stagger: { each: 0.025, from: "center" },
        },
        0.62,
      )
      .fromTo(seal, { scale: 0.45, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.7, ease: "back.out(1.6)" }, 0.95)
      .fromTo(seal.querySelector(".otp-ripple"), { scale: 1, autoAlpha: 0.7 }, { scale: 2.1, autoAlpha: 0, duration: 0.9, ease: "expo.out" }, 1.05)
      .fromTo(seal.querySelector(".otp-tick"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.out" }, 1.12)
      // The stamp lands while the tick is still drawing.
      .call(() => onVerified(user), [], 1.3);
  };

  async function verify(value: string) {
    if (phaseRef.current !== "idle") return;
    setPhase("checking");
    setNote(null);
    const started = performance.now();
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: ticket.challenge, code: value }),
      });
      const json = await res.json().catch(() => ({}));
      // Let the sweep be seen, even on a fast connection.
      await wait(Math.max(0, 480 - (performance.now() - started)));
      if (res.ok) return verified(json.user);
      const e = json.error ?? {};
      switch (e.code) {
        case "OTP_INVALID":
          return miss(e.attemptsLeft ?? 0);
        case "OTP_LOCKED":
          return dead(e.message, false, true);
        case "OTP_EXPIRED":
          return dead(e.message);
        case "OTP_NOT_FOUND":
        case "EMAIL_TAKEN":
          return dead(e.message, true);
        case "VALIDATION_FAILED":
          return miss(ticket.attemptsLeft);
        default:
          return hiccup(res.status >= 500 ? "Turbulence on our side. Try that code again in a moment." : e.message || "Something went wrong. Try again.");
      }
    } catch {
      await wait(Math.max(0, 480 - (performance.now() - started)));
      hiccup("No signal. Check your connection and try again.");
    }
  }

  async function resend() {
    if (sending || resendIn > 0 || phase === "ok" || phase === "checking") return;
    setSending(true);
    try {
      const res = await fetch("/api/auth/otp/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: ticket.challenge }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = json.error ?? {};
        if (e.code === "OTP_RESEND_TOO_SOON") setNote({ tone: "info", text: e.message });
        else dead(e.message ?? "We couldn't send a new code. Start again.", e.code === "OTP_NOT_FOUND" || e.code === "OTP_RATE_LIMITED");
        return;
      }
      setNow(Date.now());
      clearTiles();
      setCode("");
      setRestart(false);
      setTries(json.otp.attemptsLeft);
      setPhase("idle");
      setNote({ tone: "info", text: `A new code is on its way to ${ticket.email}.` });
      onTicket(json.otp);
      focusInput();
    } catch {
      setNote({ tone: "error", text: "No signal. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (phase !== "idle") return;
    const value = e.target.value.replace(/\D/g, "").slice(0, len);
    setCode(value);
    if (note?.tone !== "info" && value.length) setNote(null);
    if (value.length === len) void verify(value);
  };

  // Development without SMTP: type the code in for the traveller, a digit at a time.
  const fillDevCode = async () => {
    if (!ticket.devCode || phase !== "idle") return;
    focusInput();
    for (let i = 1; i <= len; i++) {
      setCode(ticket.devCode.slice(0, i));
      await wait(reduced() ? 0 : 70);
    }
    void verify(ticket.devCode);
  };

  const active = phase === "idle" && focused ? Math.min(code.length, len - 1) : -1;
  const locked = phase !== "idle";
  const half = Math.ceil(len / 2);
  const slot = (i: number) => (
    <span
      key={i}
      className="otp-slot"
      data-filled={code[i] ? "" : undefined}
      data-active={i === active || undefined}
      style={{ "--i": i } as React.CSSProperties}
    >
      {code[i] && (
        <span key={`${i}${code[i]}`} className="otp-digit">
          {code[i]}
        </span>
      )}
      {i === active && !code[i] && <i className="otp-caret" />}
    </span>
  );

  return (
    <div ref={root} className="otp" data-phase={phase}>
      <h2 className="auth-title">Check your inbox.</h2>
      <p className="auth-sub">
        We sent a {len}-digit code to <b className="otp-email">{ticket.email}</b>. Enter it to{" "}
        {ticket.purpose === "REGISTER" ? "create your account" : "sign in"}.
      </p>

      <div className="otp-field" onClick={focusInput}>
        <label htmlFor="otp-code" className="sr-only">
          {len}-digit code from the email
        </label>
        <input
          ref={input}
          id="otp-code"
          className="otp-input"
          value={code}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={len}
          autoFocus
          readOnly={locked}
          aria-invalid={phase === "wrong" || phase === "dead" || undefined}
          aria-describedby="otp-note"
        />
        <div className="otp-row" aria-hidden>
          {Array.from({ length: half }, (_, i) => slot(i))}
          <span className="otp-dash" />
          {Array.from({ length: len - half }, (_, i) => slot(half + i))}
        </div>
        <span className="otp-seal" aria-hidden>
          <span className="otp-ripple" />
          <svg viewBox="0 0 24 24" focusable="false">
            <path className="otp-tick" d="M6 12.5l4 4 8-9" pathLength={1} />
          </svg>
        </span>
      </div>

      <div className="otp-status">
        <p id="otp-note" className="otp-note" data-tone={note?.tone} role="status" aria-live="polite">
          {note ? (
            <span key={note.text}>{note.text}</span>
          ) : phase === "checking" ? (
            <span>Checking the code…</span>
          ) : (
            <span>
              Expires in <b>{clock(expiresIn)}</b>
            </span>
          )}
        </p>
        {/* Tries left: a spent one flashes red and drains. */}
        <span className="otp-tries" aria-hidden>
          {Array.from({ length: ticket.maxAttempts ?? 5 }, (_, i) => (
            <i key={i} data-on={i < tries || undefined} />
          ))}
        </span>
      </div>

      {ticket.devCode && phase !== "ok" && (
        <p className="otp-dev">
          <span>Dev mode, no mail server set up: your code is</span>
          <button type="button" onClick={fillDevCode} disabled={phase !== "idle"}>
            {ticket.devCode.slice(0, half)} {ticket.devCode.slice(half)}
          </button>
          <span>(also printed in the server terminal).</span>
        </p>
      )}

      <div className="otp-actions">
        {restart ? (
          <button type="button" className="auth-submit otp-primary" onClick={onBack}>
            <span className="auth-submit-label">Start again</span>
            <span className="auth-submit-icon" aria-hidden>
              <ArrowLeft size={16} weight="bold" />
            </span>
          </button>
        ) : phase === "dead" ? (
          <button type="button" className="auth-submit otp-primary" onClick={resend} disabled={sending || resendIn > 0} aria-busy={sending}>
            <span className="auth-submit-label">{resendIn > 0 ? `New code in ${clock(resendIn)}` : sending ? "Sending" : "Send a new code"}</span>
            <span className="auth-submit-icon" data-busy={sending} aria-hidden>
              <ArrowClockwise size={16} weight="bold" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="auth-submit otp-primary"
            onClick={() => void verify(code)}
            disabled={code.length < len || phase !== "idle"}
            aria-busy={phase === "checking"}
          >
            <span className="auth-submit-label" key={phase === "ok" ? `ok${doneLabel}` : phase}>
              {phase === "ok" ? doneLabel || "Verified" : phase === "checking" ? "Checking" : "Verify code"}
            </span>
            <span className="auth-submit-icon" data-busy={phase === "checking"} aria-hidden>
              {phase === "ok" ? <Check size={16} weight="bold" /> : <ArrowUpRight size={16} weight="bold" />}
            </span>
          </button>
        )}
        {phase !== "ok" && (
          <div className="otp-links">
            <button type="button" onClick={onBack}>
              <ArrowLeft size={13} weight="bold" aria-hidden /> Use a different email
            </button>
            {phase !== "dead" && !restart && (
              <button type="button" onClick={resend} disabled={sending || resendIn > 0}>
                {resendIn > 0 ? `Resend in ${clock(resendIn)}` : sending ? "Sending…" : "Resend code"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
