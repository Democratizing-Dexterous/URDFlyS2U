<template>
  <el-dialog
    :model-value="visible"
    title="我的项目"
    width="720px"
    align-center
    :append-to-body="true"
    class="project-manager-dialog"
    @update:model-value="$emit('close')"
  >
    <div class="pm-toolbar">
      <el-button :icon="FolderOpened" :disabled="busy" @click="triggerImport">
        导入 .miles 项目文件
      </el-button>
      <el-button
        type="primary"
        :icon="Download"
        :disabled="busy || !hasCurrent"
        @click="$emit('export')"
      >
        导出当前项目
      </el-button>
      <el-dropdown
        trigger="click"
        popper-class="pm-clear-menu"
        :disabled="busy || !available"
        @command="handleClearCommand"
      >
        <el-button :icon="Delete" :disabled="busy || !available">
          清理缓存<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="geometry">
              仅清理几何缓存<span class="pm-dd-hint">保留项目，下次打开重新解析</span>
            </el-dropdown-item>
            <el-dropdown-item command="all" divided>
              <span class="pm-danger">清空全部项目数据</span>
              <span class="pm-dd-hint">删除所有项目、模型与缩略图</span>
            </el-dropdown-item>
            <el-dropdown-item command="site" divided>
              <span class="pm-danger">清除网站全部缓存</span>
              <span class="pm-dd-hint">含浏览器缓存与本地数据库，完成后重载</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="pm-storage" v-if="storageText">{{ storageText }}</span>
      <input ref="fileInputRef" type="file" accept=".miles" hidden @change="handleFileChange" />
    </div>

    <el-alert
      v-if="!available"
      type="warning"
      :closable="false"
      show-icon
      title="当前浏览器不支持 OPFS 存储"
      description="项目无法保存在本地，但仍可以导入和导出 .miles 文件。"
      class="pm-alert"
    />

    <div v-else-if="projects.length === 0" class="pm-empty">
      <el-empty description="还没有保存的项目">
        <span class="pm-empty-hint">导入 STEP 模型后会自动创建项目草稿</span>
      </el-empty>
    </div>

    <div v-else class="pm-list">
      <div
        v-for="project in projects"
        :key="project.id"
        class="pm-item"
        :class="{ 'is-current': project.id === currentId }"
      >
        <div class="pm-thumb">
          <img v-if="thumbUrls[project.id]" :src="thumbUrls[project.id]" alt="" />
          <el-icon v-else class="pm-thumb-fallback"><Box /></el-icon>
        </div>

        <div class="pm-meta">
          <div class="pm-name-row">
            <span class="pm-name" :title="project.name">{{ project.name }}</span>
            <el-tag v-if="project.autosave" size="small" type="warning" effect="plain">
              草稿
            </el-tag>
            <el-tag v-if="project.id === currentId" size="small" type="success" effect="plain">
              当前
            </el-tag>
          </div>
          <div class="pm-stats">
            {{ project.stats.linkCount }} 连杆 · {{ project.stats.jointCount }} 关节 ·
            {{ project.stats.solidCount }} 实体
            <template v-if="project.stats.triangleCount > 0">
              · {{ formatCount(project.stats.triangleCount) }} 三角形
            </template>
          </div>
          <div class="pm-source" :title="project.sourceFileName">
            {{ project.sourceFileName }} · {{ formatBytes(project.sourceFileSize) }} ·
            {{ formatRelativeTime(project.updatedAt) }}
          </div>
        </div>

        <div class="pm-actions">
          <el-button
            type="primary"
            size="small"
            :disabled="busy"
            @click="$emit('open', project.id)"
          >
            打开
          </el-button>
          <el-button size="small" :disabled="busy" @click="startRename(project)">
            重命名
          </el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :disabled="busy"
            @click="confirmRemove(project)"
          >
            删除
          </el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { confirmDialog, promptDialog } from "../utils/dialog";

import FolderOpened from "~icons/ep/folder-opened";
import Download from "~icons/ep/download";
import Box from "~icons/ep/box";
import Delete from "~icons/ep/delete";
import ArrowDown from "~icons/ep/arrow-down";
import type { ProjectRecord } from "../persistence/types";
import { formatBytes, formatCount, formatRelativeTime } from "../utils/format";

const props = defineProps<{
  visible: boolean;
  projects: ProjectRecord[];
  currentId: string | null;
  busy: boolean;
  available: boolean;
  hasCurrent: boolean;
  storageText?: string;
}>();

const emit = defineEmits<{
  close: [];
  open: [id: string];
  remove: [id: string];
  rename: [id: string, name: string];
  import: [file: File];
  export: [];
  clearGeometry: [];
  clearAll: [];
  clearSite: [];
}>();

function handleClearCommand(command: string): void {
  if (command === "geometry") emit("clearGeometry");
  else if (command === "all") emit("clearAll");
  else if (command === "site") emit("clearSite");
}

const fileInputRef = ref<HTMLInputElement | null>(null);
const thumbUrls = ref<Record<string, string>>({});

function releaseUrls(): void {
  for (const url of Object.values(thumbUrls.value)) URL.revokeObjectURL(url);
  thumbUrls.value = {};
}

watch(
  () => props.projects,
  (list) => {
    releaseUrls();
    const next: Record<string, string> = {};
    for (const project of list) {
      if (project.thumbnail) next[project.id] = URL.createObjectURL(project.thumbnail);
    }
    thumbUrls.value = next;
  },
  { immediate: true, deep: false },
);

onBeforeUnmount(releaseUrls);

function triggerImport(): void {
  fileInputRef.value?.click();
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("import", file);
}

async function startRename(project: ProjectRecord): Promise<void> {
  try {
    const { value } = await promptDialog("请输入新的项目名称", "重命名项目", {
      inputValue: project.name,
      inputValidator: (v: string) => (v.trim().length > 0 ? true : "名称不能为空"),
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    emit("rename", project.id, value.trim());
  } catch {}
}

async function confirmRemove(project: ProjectRecord): Promise<void> {
  try {
    await confirmDialog(
      `将永久删除项目「${project.name}」及其缓存的模型数据，此操作不可撤销。`,
      "删除项目",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    emit("remove", project.id);
  } catch {}
}
</script>

<style lang="scss" scoped>
.pm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.pm-storage {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-2);
}

.pm-dd-hint {
  display: block;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}

.pm-danger {
  color: #f56c6c;
}

.pm-alert {
  margin-bottom: 12px;
}

.pm-empty {
  padding: 24px 0;
}

.pm-empty-hint {
  font-size: 12px;
  color: var(--text-2);
}

.pm-list {
  max-height: 460px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pm-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    border-color: #c6e2ff;
    background: #f5f9ff;
  }

  &.is-current {
    border-color: #67c23a;
    background: #f2fbf0;
  }
}

.pm-thumb {
  flex: 0 0 auto;
  width: 84px;
  height: 60px;
  border-radius: 4px;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.pm-thumb-fallback {
  font-size: 24px;
  color: var(--text-3);
}

.pm-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.pm-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.pm-name {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-stats {
  font-size: 12px;
  color: #606266;
  margin-bottom: 2px;
}

.pm-source {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}
</style>
