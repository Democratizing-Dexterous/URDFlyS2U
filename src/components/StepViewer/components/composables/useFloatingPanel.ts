import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  watchEffect,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { useDraggable, useEventListener, useWindowSize } from "@vueuse/core";

const Z_BASE = 1000;
const Z_LIMIT = 1900;
const DEFAULT_MARGIN = 8;
const ENTER_SETTLE_MS = 400;
const INTERACTIVE = "button, input, textarea, select, .el-button, .el-input, .el-slider";

const registry = new Set<Ref<number>>();
let zCursor = Z_BASE;

function nextZ(): number {
  if (zCursor >= Z_LIMIT) {
    zCursor = Z_BASE;
    for (const item of [...registry].sort((a, b) => a.value - b.value)) item.value = ++zCursor;
  }
  return ++zCursor;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface FloatingPanelOptions {
  initial: (viewport: Viewport) => { x: number; y: number };
  visible?: MaybeRefOrGetter<boolean>;
  width?: MaybeRefOrGetter<number>;
  margin?: number;
}

export function useFloatingPanel(options: FloatingPanelOptions) {
  const panelRef = shallowRef<HTMLElement | null>(null);
  const handleRef = shallowRef<HTMLElement | null>(null);
  const zIndex = ref(nextZ());
  const margin = options.margin ?? DEFAULT_MARGIN;

  registry.add(zIndex);
  onScopeDispose(() => registry.delete(zIndex));

  const { width: viewportWidth, height: viewportHeight } = useWindowSize();
  const seed = options.initial({
    width: viewportWidth.value,
    height: viewportHeight.value,
  });

  function bringToFront(): void {
    zIndex.value = nextZ();
  }

  const { x, y } = useDraggable(panelRef, {
    initialValue: seed,
    handle: handleRef,
    preventDefault: true,
    onStart: (_position, event) => {
      if ((event.target as HTMLElement | null)?.closest(INTERACTIVE)) return false;
      bringToFront();
    },
    onEnd: () => clampIntoViewport(),
  });

  function clampIntoViewport(): void {
    const el = panelRef.value;
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
    const maxX = Math.max(margin, viewportWidth.value - el.offsetWidth - margin);
    const maxY = Math.max(margin, viewportHeight.value - el.offsetHeight - margin);
    x.value = Math.min(Math.max(margin, x.value), maxX);
    y.value = Math.min(Math.max(margin, y.value), maxY);
  }

  watch([viewportWidth, viewportHeight], clampIntoViewport, { flush: "post" });

  let clampTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleClamp(): void {
    clearTimeout(clampTimer);
    clampTimer = setTimeout(clampIntoViewport, ENTER_SETTLE_MS);
  }

  onScopeDispose(() => clearTimeout(clampTimer));

  if (options.visible !== undefined) {
    watch(
      () => toValue(options.visible),
      (shown) => {
        if (shown) scheduleClamp();
      },
      { immediate: true },
    );
  }

  watchEffect(
    () => {
      const el = panelRef.value;
      if (!el) return;
      el.style.left = `${x.value}px`;
      el.style.top = `${y.value}px`;
      el.style.zIndex = String(zIndex.value);
      const width = toValue(options.width);
      if (width !== undefined) el.style.width = `${width}px`;
    },
    { flush: "post" },
  );

  return { panelRef, handleRef, x, y, zIndex, bringToFront, clampIntoViewport };
}

export interface EdgeResizeOptions {
  min: number;
  max: number;
  direction?: 1 | -1;
}

export function useEdgeResize(width: Ref<number>, options: EdgeResizeOptions) {
  const direction = options.direction ?? 1;
  const active = ref(false);
  let originX = 0;
  let originWidth = 0;

  function onPointerMove(event: PointerEvent): void {
    if (!active.value) return;
    const delta = (event.clientX - originX) * direction;
    width.value = Math.min(options.max, Math.max(options.min, originWidth + delta));
  }

  function stop(): void {
    if (!active.value) return;
    active.value = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function startResize(event: PointerEvent): void {
    active.value = true;
    originX = event.clientX;
    originWidth = width.value;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  useEventListener(document, "pointermove", onPointerMove, { passive: true });
  useEventListener(document, "pointerup", stop);
  useEventListener(document, "pointercancel", stop);
  onScopeDispose(stop);

  return { startResize, resizing: active };
}
