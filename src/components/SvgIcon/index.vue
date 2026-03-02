<template>
  <svg :class="svgClass" :style="getStyle" aria-hidden="true">
    <use :xlink:href="symbolId" />
  </svg>
</template>

<script setup lang="ts" name="SvgIcon">
import { computed, CSSProperties } from "vue";

interface SvgProps {
  name: string; // 图标的名称 (必传)
  prefix?: string; // 图标的前缀 (非必传, 默认为 "icon")
  color?: string; // 图标的颜色 (非必传)
  size?: string | number; // 图标的大小, 如 24, "24px", "2em" (非必传)
  spin?: boolean; // 是否旋转 (非必传, 默认为 false)
}

const props = withDefaults(defineProps<SvgProps>(), {
  prefix: "icon",
  size: "18px",
  spin: false
});

// 计算最终的 symbol ID
const symbolId = computed(() => `#${props.prefix}-${props.name}`);

// 计算最终的 class
const svgClass = computed(() => {
  if (props.spin) {
    return "svg-icon svg-icon-spin";
  }
  return "svg-icon";
});

// 计算最终的 style
const getStyle = computed<CSSProperties>(() => {
  const { size, color } = props;
  const styles: CSSProperties = {};
  if (size) {
    // 如果 size 是数字，则添加 "px" 单位
    const sizeStr = `${size}`.replace("px", "");
    const finalSize = /^\d+$/.test(sizeStr) ? `${sizeStr}px` : size;
    styles.width = finalSize;
    styles.height = finalSize;
  }
  if (color) {
    styles.color = color;
  }
  return styles;
});
</script>

<style scoped>
.svg-icon {
  display: inline-block;
  overflow: hidden;
  /* 默认继承父元素的颜色 */
  fill: currentColor;
  vertical-align: -0.15em;
  outline: none;
}

/* 旋转动画 */
.svg-icon-spin {
  animation: spin 1.5s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
