// Small text animations for HUD copy, driven by GSAP.
//
// Both write to the element's existing text node (never replace it), so the
// node React rendered stays the one on screen and re-renders stay safe.

import { gsap } from "./gsap";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
/** How often scrambled glyphs change, in seconds (a readable flicker, not noise). */
const FLICKER = 0.04;

function textNode(el: Element | null): Text | null {
  const node = el?.firstChild;
  return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}

function decode(text: string, revealed: number) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    // Keep spaces and punctuation so the line keeps its shape while it decodes.
    if (i < revealed || !/[\p{L}\p{N}]/u.test(c)) out += c;
    else {
      const set = /\d/.test(c) ? DIGITS : GLYPHS;
      const g = set[(Math.random() * set.length) | 0];
      // Keep the letter's case, so sentence-case copy doesn't flicker in capitals.
      out += c === c.toLowerCase() && c !== c.toUpperCase() ? g.toLowerCase() : g;
    }
  }
  return out;
}

/**
 * Decode an element's text from random glyphs, left to right (use on
 * monospace text so the width never changes). Returns the tween and a
 * `restore` for cleanup if the animation is torn down part-way.
 */
export function scrambleText(el: Element | null, { duration = 1, paused = false }: { duration?: number; paused?: boolean } = {}) {
  const node = textNode(el);
  const original = node?.nodeValue ?? "";
  const state = { p: 0 };
  let tick = -1;
  const render = () => {
    if (!node) return;
    if (state.p >= 1) {
      node.nodeValue = original;
      return;
    }
    const t = Math.floor((state.p * duration) / FLICKER);
    if (t === tick) return;
    tick = t;
    node.nodeValue = decode(original, Math.floor(state.p * (original.length + 1)));
  };
  const tween = gsap.fromTo(state, { p: 0 }, { p: 1, duration, ease: "none", onUpdate: render, onStart: render, immediateRender: false, paused });
  return {
    tween,
    restore: () => {
      if (node) node.nodeValue = original;
    },
  };
}
