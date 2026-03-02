<template>
    <div class="stats-panel" v-if="visible">
        <div class="stats-row">
            <span class="stats-label">FPS</span>
            <span class="stats-value" :class="fpsClass">{{ fps }}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">渲染</span>
            <span class="stats-value">{{ renderTime }}ms</span>
        </div>
        <div class="stats-row" v-if="memoryInfo">
            <span class="stats-label">内存</span>
            <span class="stats-value">{{ memoryInfo }}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">三角形</span>
            <span class="stats-value">{{ formatNumber(triangles) }}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">顶点</span>
            <span class="stats-value">{{ formatNumber(vertices) }}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">Draw Calls</span>
            <span class="stats-value">{{ drawCalls }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = withDefaults(defineProps<{
    visible: boolean
    /** 场景总三角形数（父组件传入） */
    triangles?: number
    /** 场景总顶点数（父组件传入） */
    vertices?: number
    /** 每帧 Draw Calls（父组件传入） */
    drawCalls?: number
}>(), {
    triangles: 0,
    vertices: 0,
    drawCalls: 0
})

// 帧率数据（内部 RAF 测量）
const fps = ref(0)
const renderTime = ref(0)

// FPS 计算相关
let frameCount = 0
let lastTime = performance.now()
let lastFrameTime = performance.now()
let animationId: number | null = null

// FPS 颜色等级
const fpsClass = computed(() => {
    if (fps.value >= 55) return 'fps-good'
    if (fps.value >= 30) return 'fps-ok'
    return 'fps-bad'
})

// 内存信息
const memoryInfo = computed(() => {
    if (!('memory' in performance)) return null
    const mem = (performance as any).memory
    if (!mem) return null
    const usedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024)
    return `${usedMB} MB`
})

// 格式化数字
function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M'
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
}

// 更新统计信息
function updateStats() {
    frameCount++
    const now = performance.now()

    // 计算单帧渲染时间
    renderTime.value = Math.round(now - lastFrameTime)
    lastFrameTime = now

    // 每秒更新一次 FPS
    if (now - lastTime >= 1000) {
        fps.value = Math.round((frameCount * 1000) / (now - lastTime))
        frameCount = 0
        lastTime = now
    }

    animationId = requestAnimationFrame(updateStats)
}

// 开始监控
function startMonitoring() {
    if (animationId !== null) return
    lastTime = performance.now()
    lastFrameTime = performance.now()
    frameCount = 0
    animationId = requestAnimationFrame(updateStats)
}

// 停止监控
function stopMonitoring() {
    if (animationId !== null) {
        cancelAnimationFrame(animationId)
        animationId = null
    }
}

// 监听 visible 变化
watch(() => props.visible, (visible) => {
    if (visible) {
        startMonitoring()
    } else {
        stopMonitoring()
    }
}, { immediate: true })

onMounted(() => {
    if (props.visible) {
        startMonitoring()
    }
})

onUnmounted(() => {
    stopMonitoring()
})
</script>

<style lang="scss" scoped>
.stats-panel {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    padding: 8px 10px;
    border-radius: 4px;
    min-width: 100px;
    z-index: 100;
    pointer-events: none;
    user-select: none;
}

.stats-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 0;

    &:not(:last-child) {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
}

.stats-label {
    color: rgba(255, 255, 255, 0.7);
    margin-right: 12px;
}

.stats-value {
    font-weight: bold;
    text-align: right;
}

.fps-good {
    color: #4caf50;
}

.fps-ok {
    color: #ff9800;
}

.fps-bad {
    color: #f44336;
}
</style>
