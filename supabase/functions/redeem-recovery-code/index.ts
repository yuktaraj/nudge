import { handleOptions, json } from '../_shared/cors.ts';
import { supabaseConfig, supabaseFetch } from '../_shared/supabase.ts';

function normalizeCode(value: unknown) {
  return String(value ?? '').replace(/-/g, '').trim().toUpperCase();
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
    const code = normalizeCode((await request.json()).code);
    if (!/^[A-Z2-9]{12}$/.test(code)) return json({ error: 'Enter a valid recovery code.' }, 400);

    const codeHash = await hashCode(code);
    const [recovery] = await supabaseFetch<Array<{ expires_at: string; id: string; user_id: string }>>(
      `/rest/v1/recovery_codes?code_hash=eq.${codeHash}&used_at=is.null&select=id,expires_at,user_id`
    );
    if (!recovery || new Date(recovery.expires_at).getTime() <= Date.now()) {
      return json({ error: 'That recovery code is invalid or expired.' }, 400);
    }

    const password = code;
    const email = `sync-${recovery.user_id}@recovery.nudge.invalid`;
    const config = supabaseConfig();
    const userResponse = await fetch(`${config.url}/auth/v1/admin/users/${recovery.user_id}`, {
      body: JSON.stringify({ email, email_confirm: true, password }),
      headers: { ...config.headers, 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    if (!userResponse.ok) return json({ error: 'Could not prepare this account for sync.' }, 500);

    await supabaseFetch(`/rest/v1/recovery_codes?id=eq.${recovery.id}`, {
      headers: { Prefer: 'return=minimal' },
      json: { used_at: new Date().toISOString() },
      method: 'PATCH',
    });

    return json({ email, password });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not redeem recovery code.' }, 500);
  }
});
