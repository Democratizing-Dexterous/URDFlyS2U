import { BProgress, type BProgressOptions } from "@bprogress/core";

export const PROGRESS_COLOR = "var(--el-color-primary, #409eff)";
export const PROGRESS_HEIGHT = "2px";

export const progressOptions: BProgressOptions = {
  easing: "ease",
  speed: 500,
  showSpinner: false,
  trickle: true,
  trickleSpeed: 200,
  minimum: 0.3,
  positionUsing: "translate3d",
};

export { BProgress };
