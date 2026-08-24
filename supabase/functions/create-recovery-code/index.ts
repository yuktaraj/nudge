import { handleOptions, json } from '../_shared/cors.ts';
import { getUserId, supabaseFetch } from '../_shared/supabase.ts';

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

async function hashCode(code: string) {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    const userId = await getUserId(request);
    const code = randomCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await supabaseFetch('/rest/v1/recovery_codes', {
      headers: { Prefer: 'return=minimal' },
      json: { code_hash: codeHash, expires_at: expiresAt, user_id: userId },
      method: 'POST',
    });

    return json({ code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`, expiresAt });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not create recovery code.' }, 500);
  }
});
