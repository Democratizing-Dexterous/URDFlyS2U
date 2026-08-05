import Dexie, { type EntityTable } from "dexie";
import type { ProjectRecord } from "./types";

class ProjectDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, "id">;

  constructor() {
    super("step2urdf");
    this.version(1).stores({
      projects: "id, name, updatedAt",
    });
  }
}

let instance: ProjectDatabase | null = null;

function db(): ProjectDatabase {
  if (!instance) instance = new ProjectDatabase();
  return instance;
}

export function newProjectId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function upsertProject(record: ProjectRecord): Promise<void> {
  await db().projects.put(record);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return db().projects.get(id);
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return db().projects.orderBy("updatedAt").reverse().toArray();
}

export async function findLatestDraft(): Promise<ProjectRecord | undefined> {
  const all = await db().projects.orderBy("updatedAt").reverse().toArray();
  return all.find((p) => p.autosave);
}

export async function promoteProject(id: string, name: string): Promise<void> {
  await db().projects.update(id, { name, autosave: false, updatedAt: Date.now() });
}

export async function deleteProjectRecord(id: string): Promise<void> {
  await db().projects.delete(id);
}

export async function renameProjectRecord(id: string, name: string): Promise<void> {
  await db().projects.update(id, { name, updatedAt: Date.now() });
}

export async function clearAllProjects(): Promise<void> {
  await db().projects.clear();
}

export function closeDatabase(): void {
  try {
    instance?.close();
  } catch {}
  instance = null;
}
