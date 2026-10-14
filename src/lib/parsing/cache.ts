import { AUTH_ENABLED } from '@/constants/auth';
import type { GeneratedAssetRecord, SourceRecord } from '@/types/parsing';

type SQLiteDatabase = {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
};

type SQLiteModule = {
  openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
};

let sqliteModulePromise: Promise<SQLiteModule | null> | null = null;
let dbPromise: Promise<SQLiteDatabase | null> | null = null;
const memorySources = new Map<string, SourceRecord>();
const memoryAssets = new Map<string, GeneratedAssetRecord>();
let activeCacheUser = '';

/**
 * Scope the local cache to one account. Rows written before this call
 * (user_id = '') are treated as unowned legacy data and ignored.
 */
export function setActiveCacheUser(userId: string) {
  if (activeCacheUser === userId) return;
  activeCacheUser = userId;
  memorySources.clear();
  memoryAssets.clear();
}

async function loadSQLite() {
  if (!sqliteModulePromise) {
    const moduleName = 'expo-sqlite';
    sqliteModulePromise = import(moduleName).then((module) => module as SQLiteModule).catch(() => null);
  }

  return sqliteModulePromise;
}

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = loadSQLite().then(async (SQLite) => {
      if (!SQLite) {
        return null;
      }

      const db = await SQLite.openDatabaseAsync('nudge-study-cache.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          subject TEXT,
          topic TEXT,
          mime_type TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          size INTEGER NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL,
          stage TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS generated_assets (
          id TEXT PRIMARY KEY NOT NULL,
          source_id TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      await Promise.all([
        db.runAsync('ALTER TABLE sources ADD COLUMN subject TEXT').catch(() => null),
        db.runAsync('ALTER TABLE sources ADD COLUMN topic TEXT').catch(() => null),
        db.runAsync("ALTER TABLE sources ADD COLUMN user_id TEXT NOT NULL DEFAULT ''").catch(() => null),
        db.runAsync("ALTER TABLE generated_assets ADD COLUMN user_id TEXT NOT NULL DEFAULT ''").catch(() => null),
      ]);

      return db;
    });
  }

  return dbPromise;
}

export async function cacheSource(source: SourceRecord) {
  memorySources.set(source.id, source);
  const db = await getDatabase();
  if (!db) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO sources
      (id, user_id, title, subject, topic, mime_type, storage_path, size, status, progress, stage, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    source.id,
    activeCacheUser,
    source.title,
    source.subject,
    source.topic,
    source.mimeType,
    source.storagePath,
    source.size,
    source.status,
    source.progress,
    source.stage,
    source.error,
    source.createdAt,
    source.updatedAt
  );
}

export async function cacheAsset(asset: GeneratedAssetRecord) {
  memoryAssets.set(asset.sourceId, asset);
  const db = await getDatabase();
  if (!db) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO generated_assets
      (id, user_id, source_id, type, title, content_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    asset.id,
    activeCacheUser,
    asset.sourceId,
    asset.type,
    asset.title,
    JSON.stringify(asset.content),
    asset.createdAt
  );
}

export async function listCachedSources(): Promise<SourceRecord[]> {
  const db = await getDatabase();
  if (!db) {
    return [...memorySources.values()];
  }

  const query = (AUTH_ENABLED && activeCacheUser)
    ? `SELECT * FROM sources WHERE user_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM sources ORDER BY created_at DESC`;
  const params = (AUTH_ENABLED && activeCacheUser) ? [activeCacheUser] : [];

  const rows = await db.getAllAsync<{
    created_at: string;
    error: string | null;
    id: string;
    mime_type: string;
    progress: number;
    size: number;
    stage: SourceRecord['stage'];
    status: SourceRecord['status'];
    storage_path: string;
    subject: string | null;
    title: string;
    topic: string | null;
    updated_at: string;
  }>(query, ...params);

  return rows.map((row: {
    created_at: string;
    error: string | null;
    id: string;
    mime_type: string;
    progress: number;
    size: number;
    stage: SourceRecord['stage'];
    status: SourceRecord['status'];
    storage_path: string;
    subject: string | null;
    title: string;
    topic: string | null;
    updated_at: string;
  }) => ({
    createdAt: row.created_at,
    error: row.error,
    id: row.id,
    mimeType: row.mime_type,
    progress: row.progress,
    size: row.size,
    stage: row.stage,
    status: row.status,
    storagePath: row.storage_path,
    subject: row.subject,
    title: row.title,
    topic: row.topic,
    updatedAt: row.updated_at,
  }));
}

export async function listCachedAssets(): Promise<GeneratedAssetRecord[]> {
  const db = await getDatabase();
  if (!db) {
    return [...memoryAssets.values()];
  }

  const query = (AUTH_ENABLED && activeCacheUser)
    ? `SELECT * FROM generated_assets WHERE user_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM generated_assets ORDER BY created_at DESC`;
  const params = (AUTH_ENABLED && activeCacheUser) ? [activeCacheUser] : [];

  const rows = await db.getAllAsync<{
    content_json: string;
    created_at: string;
    id: string;
    source_id: string;
    title: string;
    type: 'study_pack';
  }>(query, ...params);

  return rows.map((row: {
    content_json: string;
    created_at: string;
    id: string;
    source_id: string;
    title: string;
    type: 'study_pack';
  }) => ({
    content: JSON.parse(row.content_json),
    createdAt: row.created_at,
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    type: row.type,
  }));
}

export async function removeCachedSource(sourceId: string) {
  memorySources.delete(sourceId);
  memoryAssets.delete(sourceId);
  const db = await getDatabase();
  if (!db) return;

  const deleteSourcesSql = (AUTH_ENABLED && activeCacheUser)
    ? 'DELETE FROM sources WHERE id = ? AND user_id = ?'
    : 'DELETE FROM sources WHERE id = ?';
  const deleteAssetsSql = (AUTH_ENABLED && activeCacheUser)
    ? 'DELETE FROM generated_assets WHERE source_id = ? AND user_id = ?'
    : 'DELETE FROM generated_assets WHERE source_id = ?';
  const deleteParams = (AUTH_ENABLED && activeCacheUser) ? [sourceId, activeCacheUser] : [sourceId];

  await Promise.all([
    db.runAsync(deleteSourcesSql, ...deleteParams),
    db.runAsync(deleteAssetsSql, ...deleteParams),
  ]);
}
