// Scroll progress as a tiny external store, so per-frame consumers (progress
// bars, the scene rail) can subscribe and write to the DOM directly without
// re-rendering React on every scroll event.

type Listener = (progress: number) => void;

let value = 0;
const listeners = new Set<Listener>();

export const progressStore = {
  get: () => value,
  set(progress: number) {
    value = progress;
    for (const l of listeners) l(progress);
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
