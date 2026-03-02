<template>
    <Transition name="fade">
        <div class="loading-overlay" v-if="visible">
            <div class="loading-content">
                <!-- 3D 旋转立方体动画 -->
                <div class="cube-wrapper">
                    <div class="cube">
                        <div class="cube-face front"></div>
                        <div class="cube-face back"></div>
                        <div class="cube-face right"></div>
                        <div class="cube-face left"></div>
                        <div class="cube-face top"></div>
                        <div class="cube-face bottom"></div>
                    </div>
                </div>

                <!-- 进度信息 -->
                <div class="progress-section">
                    <div class="progress-bar-container">
                        <div class="progress-bar" :style="{ width: `${progress}%` }">
                            <div class="progress-glow"></div>
                        </div>
                    </div>
                    <div class="progress-text">{{ progress }}%</div>
                </div>

                <!-- 状态信息 -->
                <div class="status-section">
                    <span class="status-icon" :class="statusClass">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                    </span>
                    <span class="status-message">{{ message }}</span>
                </div>

                <!-- 详细信息 -->
                <div class="detail-section" v-if="fileName">
                    <span class="file-name">{{ fileName }}</span>
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
    visible: boolean
    progress: number
    message: string
    status: 'idle' | 'uploading' | 'parsing' | 'success' | 'error'
    fileName?: string
}>(), {
    visible: false,
    progress: 0,
    message: '',
    status: 'idle',
    fileName: ''
})

const statusClass = computed(() => {
    return {
        'status-uploading': props.status === 'uploading',
        'status-parsing': props.status === 'parsing',
        'status-success': props.status === 'success',
        'status-error': props.status === 'error'
    }
})
</script>

<style lang="scss" scoped>
.loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(245, 245, 245, 0.95);
    backdrop-filter: blur(4px);
    z-index: 100;
}

.loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 32px;
}

// 3D 立方体动画
.cube-wrapper {
    width: 60px;
    height: 60px;
    perspective: 200px;
}

.cube {
    width: 100%;
    height: 100%;
    position: relative;
    transform-style: preserve-3d;
    animation: rotateCube 3s infinite ease-in-out;
}

.cube-face {
    position: absolute;
    width: 60px;
    height: 60px;
    border: 2px solid rgba(64, 158, 255, 0.6);
    background: rgba(64, 158, 255, 0.1);
    box-shadow: inset 0 0 20px rgba(64, 158, 255, 0.2);
}

.front {
    transform: translateZ(30px);
}

.back {
    transform: rotateY(180deg) translateZ(30px);
}

.right {
    transform: rotateY(90deg) translateZ(30px);
}

.left {
    transform: rotateY(-90deg) translateZ(30px);
}

.top {
    transform: rotateX(90deg) translateZ(30px);
}

.bottom {
    transform: rotateX(-90deg) translateZ(30px);
}

@keyframes rotateCube {

    0%,
    100% {
        transform: rotateX(-20deg) rotateY(0deg);
    }

    25% {
        transform: rotateX(-20deg) rotateY(90deg);
    }

    50% {
        transform: rotateX(-20deg) rotateY(180deg);
    }

    75% {
        transform: rotateX(-20deg) rotateY(270deg);
    }
}

// 进度条
.progress-section {
    width: 240px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.progress-bar-container {
    width: 100%;
    height: 6px;
    background: #e4e7ed;
    border-radius: 3px;
    overflow: hidden;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #409eff, #67c23a);
    border-radius: 3px;
    transition: width 0.3s ease;
    position: relative;
    overflow: hidden;
}

.progress-glow {
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
    animation: progressGlow 1.5s infinite;
}

@keyframes progressGlow {
    0% {
        left: -100%;
    }

    100% {
        left: 100%;
    }
}

.progress-text {
    font-size: 14px;
    font-weight: 600;
    color: #409eff;
}

// 状态信息
.status-section {
    display: flex;
    align-items: center;
    gap: 8px;
}

.status-icon {
    display: flex;
    gap: 4px;

    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #909399;
        animation: dotPulse 1.4s infinite ease-in-out both;

        &:nth-child(1) {
            animation-delay: -0.32s;
        }

        &:nth-child(2) {
            animation-delay: -0.16s;
        }

        &:nth-child(3) {
            animation-delay: 0s;
        }
    }

    &.status-uploading .dot {
        background: #409eff;
    }

    &.status-parsing .dot {
        background: #e6a23c;
    }

    &.status-success .dot {
        background: #67c23a;
        animation: none;
    }

    &.status-error .dot {
        background: #f56c6c;
        animation: none;
    }
}

@keyframes dotPulse {

    0%,
    80%,
    100% {
        transform: scale(0.6);
        opacity: 0.5;
    }

    40% {
        transform: scale(1);
        opacity: 1;
    }
}

.status-message {
    font-size: 14px;
    color: #606266;
}

// 文件名
.detail-section {
    .file-name {
        font-size: 12px;
        color: #909399;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
}

// 过渡动画
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
