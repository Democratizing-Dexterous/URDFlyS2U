import { ref, readonly, type Directive } from "vue";

const HIDE_DELAY_MS = 80;

const hintText = ref("");
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let activeElement: HTMLElement | null = null;

interface HintHandlers {
  enter: () => void;
  leave: () => void;
}

const handlers = new WeakMap<HTMLElement, HintHandlers>();
const values = new WeakMap<HTMLElement, string>();

function show(el: HTMLElement): void {
  const value = values.get(el);
  if (!value) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  activeElement = el;
  hintText.value = value;
}

function hide(el: HTMLElement): void {
  if (activeElement !== el) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (activeElement !== el) return;
    activeElement = null;
    hintText.value = "";
  }, HIDE_DELAY_MS);
}

export const vHint: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    values.set(el, binding.value ?? "");
    const enter = () => show(el);
    const leave = () => hide(el);
    handlers.set(el, { enter, leave });
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focus", enter);
    el.addEventListener("blur", leave);
  },
  updated(el, binding) {
    values.set(el, binding.value ?? "");
    if (activeElement === el) hintText.value = binding.value ?? "";
  },
  unmounted(el) {
    const bound = handlers.get(el);
    if (bound) {
      el.removeEventListener("pointerenter", bound.enter);
      el.removeEventListener("pointerleave", bound.leave);
      el.removeEventListener("focus", bound.enter);
      el.removeEventListener("blur", bound.leave);
      handlers.delete(el);
    }
    values.delete(el);
    if (activeElement === el) {
      activeElement = null;
      hintText.value = "";
    }
  },
};

export function useHintBar() {
  return { hint: readonly(hintText) };
}
