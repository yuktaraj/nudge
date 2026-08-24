import { handleOptions, json } from '../_shared/cors.ts';
import { getUserId, supabaseConfig, supabaseFetch } from '../_shared/supabase.ts';

type SourceRow = {
  id: string;
  storage_path: string;
};

function encodeStoragePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const body = request.method === 'DELETE' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json();
    const userId = await getUserId(request);
    const sourceId = String(body.sourceId ?? '').trim();

    if (!sourceId) {
      return json({ error: 'sourceId is required.' }, 400);
    }

    const [source] = await supabaseFetch<SourceRow[]>(`/rest/v1/sources?id=eq.${sourceId}&user_id=eq.${userId}&select=id,storage_path`);
    if (!source) {
      return json({ deleted: true, sourceId });
    }

    const config = supabaseConfig();
    const storageResponse = await fetch(
      `${config.url}/storage/v1/object/study-materials/${encodeStoragePath(source.storage_path)}`,
      {
        headers: config.headers,
        method: 'DELETE',
      }
    );

    if (!storageResponse.ok && storageResponse.status !== 404) {
      console.warn(JSON.stringify({ sourceId, status: storageResponse.status, stage: 'storage_delete_warning' }));
    }

    await Promise.all([
      supabaseFetch(`/rest/v1/generated_assets?source_id=eq.${sourceId}`, { method: 'DELETE' }),
      supabaseFetch(`/rest/v1/chunks?source_id=eq.${sourceId}`, { method: 'DELETE' }),
      supabaseFetch(`/rest/v1/parse_jobs?source_id=eq.${sourceId}`, { method: 'DELETE' }),
    ]);
    await supabaseFetch(`/rest/v1/sources?id=eq.${sourceId}`, { method: 'DELETE' });

    return json({ deleted: true, sourceId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not delete source.' }, 500);
  }
});
