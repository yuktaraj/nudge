import { handleOptions, json } from '../_shared/cors.ts';
import { supabaseFetch } from '../_shared/supabase.ts';

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

// Helper to extract the user's UUID from their token
function getUserIdFromAuth(authHeader: string | null): string | null {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    // DEBUG: Log the auth header
    const authHeader = request.headers.get('Authorization');
    const userId = getUserIdFromAuth(authHeader);
    console.log("DEBUG: Auth Header present:", !!authHeader);
    console.log("DEBUG: Extracted User ID:", userId);

    if (!userId) {
      return json({ error: 'Unauthorized. Missing or invalid user token.' }, 401);
    }

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
    
    // Insert with ALL fields included
    const [source] = await supabaseFetch<Array<Record<string, unknown>>>('/rest/v1/sources', {
      headers: { Prefer: 'return=representation' },
      json: {
        id: sourceId,
        mime_type: mimeType,
        progress: 5,
        size,
        stage: 'metadata',
        status: 'queued',
        storage_path: storagePath,
        subject,
        title,
        topic,
        user_id: userId, // The critical fix!
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
    console.error("DEBUG: Error caught:", error);
    return json({ error: error instanceof Error ? error.message : 'Could not create upload.' }, 500);
  }
});