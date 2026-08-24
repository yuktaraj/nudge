import { handleOptions, json } from '../_shared/cors.ts';
import { getUserId, supabaseFetch } from '../_shared/supabase.ts';

const supportedMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const userId = await getUserId(request);

    const body = await request.json();
    const title = String(body.title ?? '').trim();
    const mimeType = String(body.mimeType ?? '').trim();
    const size = Number(body.size ?? 0);
    const subject = String(body.subject ?? '').trim() || null;
    const topic = String(body.topic ?? '').trim() || null;

    if (!title || !supportedMimeTypes.has(mimeType) || !Number.isFinite(size) || size <= 0) {
      return json({ error: 'Unsupported or incomplete file metadata.' }, 400);
    }

    const sourceId = crypto.randomUUID();
    const storagePath = `sources/${sourceId}/original`;
    const [source] = await supabaseFetch<Array<Record<string, unknown>>>('/rest/v1/sources', {
      headers: { Prefer: 'return=representation' },
      json: {
        id: sourceId,
        user_id: userId,
        mime_type: mimeType,
        progress: 5,
        size,
        stage: 'metadata',
        status: 'queued',
        storage_path: storagePath,
        subject,
        title,
        topic,
      },
      method: 'POST',
    });

    const [job] = await supabaseFetch<Array<Record<string, unknown>>>('/rest/v1/parse_jobs', {
      headers: { Prefer: 'return=representation' },
      json: {
        source_id: sourceId,
        stage: 'metadata',
        status: 'queued',
      },
      method: 'POST',
    });

    return json({
      job,
      source,
      upload: {
        bucket: 'study-materials',
        path: storagePath,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not create upload.' }, 500);
  }
});
