import { env, hasSupabaseConfig } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type {
  GeneratedAssetContent,
  GeneratedAssetRecord,
  PickedStudyFile,
  SourceRecord,
  UploadMetadata,
} from '@/types/parsing';

type SourceRow = {
  created_at: string;
  error: string | null;
  id: string;
  mime_type: string;
  progress: number;
  size: number;
  stage: SourceRecord['stage'];
  status: SourceRecord['status'];
  storage_path: string;
  subject?: string | null;
  title: string;
  topic?: string | null;
  updated_at: string;
};

type AssetRow = {
  content_json: GeneratedAssetContent;
  created_at: string;
  id: string;
  source_id: string;
  title: string;
  type: 'study_pack';
};

type CreateUploadResponse = {
  source: SourceRow;
  job: {
    id: string;
    source_id: string;
    status: string;
    stage: string;
  };
  upload: {
    bucket: string;
    path: string;
  };
};

function requireConfig() {
  if (!hasSupabaseConfig()) {
    throw new Error('Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable real uploads.');
  }
}

// 1. Updated headers function to securely fetch the user's session token
async function headers(contentType = 'application/json') {
  const { data: { session } } = await supabase.auth.getSession();

  const nextHeaders: Record<string, string> = {
    'Content-Type': contentType,
    apikey: env.supabaseAnonKey,
  };

  if (session?.access_token) {
    nextHeaders.Authorization = `Bearer ${session.access_token}`;
  } else if (env.supabaseAnonKey.includes('.')) {
    nextHeaders.Authorization = `Bearer ${env.supabaseAnonKey}`;
  }

  return nextHeaders;
}

function functionUrl(name: string) {
  return `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`;
}

function storageUrl(path: string) {
  return `${env.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/study-materials/${path}`;
}

function restUrl(table: string, query: string) {
  return `${env.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?${query}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? `Request failed with ${response.status}`);
  }

  return data as T;
}

export function mapSourceRow(row: SourceRow): SourceRecord {
  return {
    createdAt: row.created_at,
    error: row.error,
    id: row.id,
    mimeType: row.mime_type,
    progress: row.progress,
    size: row.size,
    stage: row.stage,
    status: row.status,
    storagePath: row.storage_path,
    subject: row.subject ?? null,
    title: row.title,
    topic: row.topic ?? null,
    updatedAt: row.updated_at,
  };
}

export function mapAssetRow(row: AssetRow): GeneratedAssetRecord {
  return {
    content: row.content_json,
    createdAt: row.created_at,
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    type: row.type,
  };
}

export async function createUpload(file: PickedStudyFile, metadata: UploadMetadata = {}) {
  requireConfig();
  const title = metadata.title?.trim() || file.name;

  const response = await fetch(functionUrl('create-upload'), {
    body: JSON.stringify({
      mimeType: file.mimeType,
      size: file.size,
      subject: metadata.subject,
      title,
      topic: metadata.topic,
    }),
    headers: await headers(),
    method: 'POST',
  });

  const data = await readResponse<CreateUploadResponse>(response);
  return {
    ...data,
    source: mapSourceRow(data.source),
  };
}

export async function uploadOriginal(path: string, file: Blob, mimeType: string) {
  requireConfig();

  const reqHeaders = await headers(mimeType);
  reqHeaders['x-upsert'] = 'false';

  const response = await fetch(storageUrl(path), {
    body: file,
    headers: reqHeaders,
    method: 'POST',
  });

  await readResponse<{ Key?: string }>(response);
}

export async function startProcessing(sourceId: string) {
  requireConfig();

  const response = await fetch(functionUrl('process-source'), {
    body: JSON.stringify({ sourceId }),
    headers: await headers(),
    method: 'POST',
  });

  return readResponse<{ sourceId: string; status: string; stage: string }>(response);
}

export async function fetchSourceAssets(sourceId: string) {
  requireConfig();

  const response = await fetch(`${functionUrl('get-source-assets')}?sourceId=${encodeURIComponent(sourceId)}`, {
    headers: await headers(),
  });
  const data = await readResponse<{ assets: AssetRow[]; source: SourceRow | null }>(response);

  return {
    assets: data.assets.map(mapAssetRow),
    source: data.source ? mapSourceRow(data.source) : null,
  };
}

export async function fetchAllSourceAssets() {
  requireConfig();

  const response = await fetch(functionUrl('get-source-assets'), {
    headers: await headers(),
  });
  const data = await readResponse<{ assets: AssetRow[]; sources: SourceRow[] }>(response);

  return {
    assets: data.assets.map(mapAssetRow),
    sources: data.sources.map(mapSourceRow),
  };
}

export async function deleteSource(sourceId: string) {
  requireConfig();

  const response = await fetch(functionUrl('delete-source'), {
    body: JSON.stringify({ sourceId }),
    headers: await headers(),
    method: 'POST',
  });

  return readResponse<{ deleted: boolean; sourceId: string }>(response);
}

export async function listSources() {
  requireConfig();

  const response = await fetch(restUrl('sources', 'select=*&order=created_at.desc'), {
    headers: await headers(),
  });
  const rows = await readResponse<SourceRow[]>(response);

  return rows.map(mapSourceRow);
}

export async function listGeneratedAssets() {
  requireConfig();

  const response = await fetch(restUrl('generated_assets', 'select=*&order=created_at.desc'), {
    headers: await headers(),
  });
  const rows = await readResponse<AssetRow[]>(response);

  return rows.map(mapAssetRow);
}