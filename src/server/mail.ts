// Outgoing email: the sign-in codes.
//
// With SMTP configured (see .env.example) mail goes through nodemailer. Without
// it, development prints the code in the server console instead, so the flow
// can be tried end to end with no mail account; production refuses to pretend
// and reports that email isn't set up.

import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/lib/env";

export class MailNotConfiguredError extends Error {}

export type Delivery = "smtp" | "console";

const globalForMail = globalThis as unknown as { __mailer?: Transporter; __mailerKey?: string };

function transporter(): Transporter | null {
  const smtp = serverEnv.smtp;
  if (!smtp.host) return null;
  // Rebuild if the settings changed while the server was running.
  const key = [smtp.host, smtp.port, smtp.secure, smtp.user, smtp.pass].join("|");
  if (!globalForMail.__mailer || globalForMail.__mailerKey !== key) {
    globalForMail.__mailer = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    globalForMail.__mailerKey = key;
  }
  return globalForMail.__mailer;
}

/** Where codes will go right now: through SMTP, or (development only) the console. */
export function mailDelivery(): Delivery | null {
  if (serverEnv.smtp.host) return "smtp";
  return process.env.NODE_ENV === "production" ? null : "console";
}

type CodeMail = { to: string; code: string; purpose: "REGISTER" | "LOGIN"; minutes: number };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function codeEmail({ code, purpose, minutes }: CodeMail) {
  const action = purpose === "REGISTER" ? "finish creating your Longitude account" : "sign in to Longitude";
  const subject = `${code} is your Longitude code`;
  const text = [
    `Your Longitude code: ${code}`,
    "",
    `Enter it to ${action}. It expires in ${minutes} minutes and works once.`,
    "",
    "If you didn't ask for this, you can ignore this email: nobody can sign in without the code.",
    "",
    "Longitude · orbital travel desk",
  ].join("\n");
  // Table layout and inline styles: what email clients reliably render.
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="width:44px;height:56px;border-radius:12px;background:#15181e;border:1px solid #2a2e37;font:600 26px/56px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8eaee;text-align:center">${escape(d)}</td>`,
    )
    .join('<td style="width:8px"></td>');
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#06070a">
  <div style="display:none;max-height:0;overflow:hidden">Your code is ${escape(code)}. It expires in ${minutes} minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06070a;padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0b0d11;border:1px solid #1d2028;border-radius:20px">
        <tr><td style="padding:28px 32px 0;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px;text-transform:uppercase;color:#e8eaee">
          Longitude <span style="color:#e6a36a">&#9679;</span> <span style="color:#8a909b;letter-spacing:2px">Boarding code</span>
        </td></tr>
        <tr><td style="padding:22px 32px 0;font:600 24px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:-0.5px;color:#e8eaee">
          Your code to ${escape(action)}
        </td></tr>
        <tr><td style="padding:24px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
        </td></tr>
        <tr><td style="padding:22px 32px 0;font:400 14px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#b4b9c2">
          It expires in <b style="color:#e6a36a">${minutes} minutes</b> and works once. Type it into the boarding pass on the page you came from.
        </td></tr>
        <tr><td style="padding:22px 32px 28px;font:400 12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#5a606b;border-top:1px solid #1d2028">
          Didn't ask for this? You can ignore this email: nobody can get in without the code.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

/** Sends a sign-in code. Returns how it was delivered. */
export async function sendCodeEmail(mail: CodeMail): Promise<Delivery> {
  const how = mailDelivery();
  if (!how) throw new MailNotConfiguredError("Email isn't set up on this server (SMTP_HOST is blank).");
  const { subject, text, html } = codeEmail(mail);
  if (how === "console") {
    console.info(
      [
        "",
        "┌─ Longitude · sign-in code (no SMTP set, so it's printed here) ─",
        `│  to:      ${mail.to}`,
        `│  for:     ${mail.purpose === "REGISTER" ? "creating an account" : "signing in"}`,
        `│  code:    ${mail.code}   (expires in ${mail.minutes} min)`,
        "└─ Set SMTP_HOST and friends in .env.local to send real email.",
        "",
      ].join("\n"),
    );
    return how;
  }
  await transporter()!.sendMail({ from: serverEnv.smtp.from, to: mail.to, subject, text, html });
  return how;
}
