"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { PLANE_PATH } from "@/features/globe/route/plane";
import { gsap, useGSAP } from "@/lib/gsap";
import { scrambleText } from "@/lib/textFx";
import { describeFailure, type Failure } from "./authFailure";
import { DeniedStamp } from "./DeniedStamp";
import { FlapBoard } from "./FlapBoard";
import { OrbitStamp } from "./OrbitStamp";
import { OtpStep, type OtpPhase, type OtpTicket } from "./OtpStep";

type Mode = "login" | "register";
type Status = "idle" | "busy" | "cleared";

const COPY: Record<Mode, { tab: string; title: string; sub: string; submit: string; busy: string; cleared: string; ring: string }> = {
  login: {
    tab: "Sign in",
    title: "Welcome back.",
    sub: "Use the email you booked with. We'll send a code to confirm it's you.",
    submit: "Sign in",
    busy: "Checking in",
    cleared: "Welcome back",
    ring: "Cleared for departure · Longitude · L-26 · ",
  },
  register: {
    tab: "Create account",
    title: "Make it official.",
    sub: "A name, an email and a password. We'll email a code to confirm the address.",
    submit: "Create account",
    busy: "Issuing your pass",
    cleared: "Welcome aboard",
    ring: "Passport issued · Longitude · L-26 · ",
  },
};

/** A barcode for the stub: fixed bar widths, so server and browser agree. */
const BARCODE = (() => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bars: [number, number][] = [];
  for (let x = 0; x < 236;) {
    const w = 1 + Math.floor(rand() * 3);
    bars.push([x, w]);
    x += w + 1 + Math.floor(rand() * 3);
  }
  return bars;
})();

/**
 * Sign in / create account as a boarding pass: a glass ticket with a
 * perforated stub. The route line in its header fills as you fill the form
 * (the little plane flies IXC to ORB). Right details and the pass asks for
 * the code we emailed (the plane holds just short of ORB while it waits);
 * the right code and the pass is stamped with the orbit tick and greets you
 * by name before the page opens your trips.
 *
 * A failure gets its own moment: a red scan sweeps the pass and it shakes,
 * the little plane turns round and flies back to IXC while ORB is struck
 * out, a "boarding denied" (or "on hold", "delayed") stamp slams onto the
 * destination, the reason flips in on a split-flap departures board, and the
 * fields at fault are scanned red with their notes decoding in. As soon as
 * the traveller starts fixing things, the stamp peels away and the plane
 * turns back toward ORB.
 *
 * With a fine pointer the pass tilts toward the cursor and a holographic
 * sheen slides across it.
 */
export function AuthForms({ online = true, offlineReason }: { online?: boolean; offlineReason?: string }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [reveal, setReveal] = useState(false);
  const [filled, setFilled] = useState(0);
  const [greeting, setGreeting] = useState("");
  const [shake, setShake] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [stamp, setStamp] = useState<"off" | "on" | "leaving">("off");
  const [divert, setDivert] = useState(false);
  const [ticket, setTicket] = useState<OtpTicket | null>(null);
  const [otpPhase, setOtpPhase] = useState<OtpPhase>("idle");
  const [draft, setDraft] = useState<{ name?: string; email?: string }>({});
  const failures = useRef(0);
  const copy = COPY[mode];
  const required = mode === "register" ? 3 : 2;
  const progress = status === "cleared" ? 1 : ticket ? 0.9 : divert ? 0 : Math.min(filled / required, 1) * 0.84;

  // Field notes decode in, like the rest of the HUD.
  const failureKey = failure?.key;
  useEffect(() => {
    if (!failureKey) return;
    const fx = [...(root.current?.querySelectorAll(".auth-error") ?? [])].map((el) => scrambleText(el, { duration: 0.7 }));
    return () =>
      fx.forEach((f) => {
        f.tween.kill();
        f.restore();
      });
  }, [failureKey]);

  // Tilt toward the cursor, with the sheen sliding the other way.
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
        const tilt = el.querySelector<HTMLElement>(".pass-tilt")!;
        const sheen = el.querySelector<HTMLElement>(".pass-sheen")!;
        const q = (t: HTMLElement, p: string) => gsap.quickTo(t, p, { duration: 0.9, ease: "power3.out" });
        const rx = q(tilt, "rotationX");
        const ry = q(tilt, "rotationY");
        const sx = q(sheen, "xPercent");
        const sy = q(sheen, "yPercent");
        const onMove = (e: PointerEvent) => {
          const r = tilt.getBoundingClientRect();
          const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
          const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
          rx(-ny * 5);
          ry(nx * 7);
          sx(-nx * 14);
          sy(-ny * 10);
        };
        const onLeave = () => {
          rx(0);
          ry(0);
          sx(0);
          sy(0);
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        };
      });
    },
    { scope: root },
  );

  const clearFailure = () => {
    setFailure(null);
    setFlags([]);
    setErrors({});
    setStamp("off");
    setDivert(false);
  };

  const fail = (httpStatus: number | "network", error?: { code?: string; message?: string; fields?: Record<string, string> }) => {
    const f = describeFailure({ status: httpStatus, code: error?.code, message: error?.message }, ++failures.current);
    const fields = error?.fields ?? {};
    setErrors(fields);
    setFlags([...new Set([...Object.keys(fields), ...f.flag])]);
    setFailure(f);
    setStamp("on");
    setDivert(true);
    setStatus("idle");
    setShake((n) => n + 1);
    // On a phone the top of the pass (plane, stamp) can be scrolled away by
    // the time you reach the button: bring it back so the failure is seen.
    requestAnimationFrame(() => {
      const top = root.current?.getBoundingClientRect().top ?? 0;
      if (top >= 72) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: window.scrollY + top - 80, behavior: reduce ? "auto" : "smooth" });
    });
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearFailure();
    setReveal(false);
    setFilled(0);
    setTicket(null);
    setDraft({});
  };

  // Back from the code step to the form, with what was typed still there.
  const backToForm = () => {
    setTicket(null);
    setOtpPhase("idle");
    setFilled(Object.values(draft).filter(Boolean).length);
  };

  // The right code: the pass is stamped and the trips open.
  const cleared = (user: { name: string }) => {
    setGreeting(
      String(user?.name ?? "")
        .trim()
        .split(/\s+/)[0] ?? "",
    );
    setStatus("cleared");
    window.dispatchEvent(new Event("lgt:auth"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => router.refresh(), reduce ? 1200 : 2600);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status !== "idle") return;
    setStatus("busy");
    clearFailure();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail(res.status, json.error);
        return;
      }
      // The details are right: now the code we emailed.
      setDraft({ name: String(data.name ?? ""), email: String(data.email ?? "") });
      setOtpPhase("idle");
      setTicket(json.otp);
      setStatus("idle");
    } catch {
      fail("network");
    }
  }

  // Typing again: the edited field is no longer flagged, the stamp peels
  // away and the plane turns back toward ORB.
  const onInput = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    setFilled(["name", "email", "password"].filter((n) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value.trim()).length);
    const name = (e.target as HTMLInputElement).name;
    if (flags.includes(name)) setFlags((f) => f.filter((x) => x !== name));
    if (errors[name])
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    if (divert) setDivert(false);
    if (stamp === "on") setStamp("leaving");
  };

  const field = (index: number, name: string, label: string, type = "text", autoComplete?: string, placeholder?: string) => {
    const secret = type === "password";
    const flagged = flags.includes(name);
    return (
      <div className="auth-field" data-flag={flagged || undefined}>
        <label htmlFor={`auth-${name}`} className="auth-label">
          <span className="auth-idx">{String(index).padStart(2, "0")}</span>
          {label}
        </label>
        <div className="auth-input-shell" data-invalid={flagged || undefined}>
          {flagged && failure && <span key={failure.key} className="auth-scan" aria-hidden />}
          <input
            id={`auth-${name}`}
            name={name}
            type={secret && reveal ? "text" : type}
            autoComplete={autoComplete}
            placeholder={placeholder}
            className="auth-input"
            aria-invalid={flagged || undefined}
            aria-describedby={errors[name] ? `auth-${name}-error` : undefined}
            defaultValue={secret ? undefined : draft[name as "name" | "email"]}
            readOnly={status === "cleared"}
            required
          />
          {secret && (
            <button
              type="button"
              className="auth-eye"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
            >
              {reveal ? <EyeSlash size={18} weight="light" aria-hidden /> : <Eye size={18} weight="light" aria-hidden />}
            </button>
          )}
        </div>
        {errors[name] && (
          <p key={failure?.key} id={`auth-${name}-error`} className="auth-error">
            {errors[name]}
          </p>
        )}
      </div>
    );
  };

  return (
    <div
      ref={root}
      className="pass"
      data-state={status}
      data-shake={shake ? (shake % 2 ? "a" : "b") : undefined}
      data-divert={divert || undefined}
      data-tone={failure?.tone}
      data-otp={ticket ? otpPhase : undefined}
    >
      <div className="pass-tilt">
        <div className="pass-shadow" aria-hidden />
        <div className="pass-card">
          <div className="pass-sheen" aria-hidden />
          {failure && (
            <>
              <span key={`scan-${failure.key}`} className="pass-scan" aria-hidden />
              <span key={`alarm-${failure.key}`} className="pass-alarm" aria-hidden />
            </>
          )}

          <header className="pass-head">
            <div className="pass-brandline">
              <span className="pass-brand">Longitude</span>
              <span>Boarding pass</span>
              <span className="pass-status" data-online={online}>
                <i aria-hidden />
                {online ? "Online" : "Offline"}
              </span>
            </div>
            <div className="pass-route">
              <div className="pass-port">
                <b>IXC</b>
                <small>Chandigarh</small>
              </div>
              <div className="pass-track" aria-hidden>
                <span className="pass-dots" />
                <span className="pass-trail" style={{ transform: `scaleX(${progress})` }} />
                <span className="pass-plane-run" style={{ transform: `translateX(${progress * 100}%)` }}>
                  <svg viewBox="0 0 24 24" className="pass-plane" focusable="false">
                    <path d={PLANE_PATH} />
                  </svg>
                </span>
              </div>
              <div className="pass-port pass-port-to">
                <b>ORB</b>
                <small>Back in orbit</small>
              </div>
            </div>
          </header>

          <div className="pass-perf" aria-hidden />

          <div className="pass-body">
            <div role="tablist" aria-label="Account" className="auth-tabs" data-mode={mode}>
              <span className="auth-tab-thumb" aria-hidden />
              {(["login", "register"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={mode === m}
                  disabled={status !== "idle"}
                  onClick={() => switchMode(m)}
                  className="auth-tab"
                >
                  {COPY[m].tab}
                </button>
              ))}
            </div>

            {ticket ? (
              <div key="otp" className="auth-swap">
                <OtpStep
                  ticket={ticket}
                  doneLabel={status === "cleared" ? `${copy.cleared}${greeting ? `, ${greeting}` : ""}` : undefined}
                  onTicket={setTicket}
                  onPhase={setOtpPhase}
                  onVerified={cleared}
                  onBack={backToForm}
                />
                <p className="sr-only" role="status">
                  {status === "cleared" ? `${copy.cleared}${greeting ? `, ${greeting}` : ""}. Opening your trips.` : ""}
                </p>
              </div>
            ) : (
              <div key={mode} className="auth-swap">
                <h2 className="auth-title">{copy.title}</h2>
                <p className="auth-sub">{copy.sub}</p>

                {!online && (
                  <p role="status" className="auth-alert">
                    <WarningCircle size={16} weight="light" className="mt-0.5 shrink-0" aria-hidden />
                    <span>Accounts need the database, which isn&apos;t reachable right now.{offlineReason ? ` ${offlineReason}` : ""}</span>
                  </p>
                )}

                <form onSubmit={submit} onInput={onInput} noValidate className="auth-form">
                  {failure && (
                    <div className="flapboard-slot">
                      <FlapBoard key={failure.key} failure={failure} onAction={failure.action === "login" ? () => switchMode("login") : undefined} />
                    </div>
                  )}
                  {mode === "register" && field(1, "name", "Passenger name", "text", "name", "Tejas Verma")}
                  {field(mode === "register" ? 2 : 1, "email", "Email", "email", "email", "you@domain.com")}
                  {field(
                    mode === "register" ? 3 : 2,
                    "password",
                    mode === "register" ? "Password, 8+ characters" : "Password",
                    "password",
                    mode === "register" ? "new-password" : "current-password",
                  )}
                  <button type="submit" className="auth-submit" disabled={status !== "idle"} aria-busy={status === "busy"}>
                    <span className="auth-submit-label" key={status}>
                      {status === "cleared" ? `${copy.cleared}${greeting ? `, ${greeting}` : ""}` : status === "busy" ? copy.busy : copy.submit}
                    </span>
                    <span className="auth-submit-icon" data-busy={status === "busy"} aria-hidden>
                      {status === "cleared" ? <Check size={16} weight="bold" /> : <ArrowUpRight size={16} weight="bold" />}
                    </span>
                  </button>
                </form>
              </div>
            )}
          </div>

          <footer className="pass-foot">
            <svg className="pass-barcode" viewBox="0 0 240 30" preserveAspectRatio="none" aria-hidden focusable="false">
              {BARCODE.map(([x, w]) => (
                <rect key={x} x={x} y="0" width={w} height="30" />
              ))}
            </svg>
            <div className="pass-meta">
              <span>Seat 01A · Gate L-26</span>
              <a href="#find-booking">Guest booking? Find it</a>
            </div>
          </footer>
        </div>

        {status === "cleared" && <OrbitStamp ring={copy.ring.toUpperCase()} label={mode === "login" ? "Signed in" : "Account created"} />}
        {failure && stamp !== "off" && (
          <DeniedStamp key={failure.key} tone={failure.tone} {...failure.stamp} leaving={stamp === "leaving"} onGone={() => setStamp("off")} />
        )}
      </div>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.dispatchEvent(new Event("lgt:auth"));
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
