export function supabaseConfig() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  return {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    url: url.replace(/\/$/, ''),
  };
}

export async function getUserId(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');

  const config = supabaseConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? config.headers.apikey,
    },
  });
  if (!response.ok) throw new Error('Authentication required.');
  const user = await response.json();
  return String(user.id);
}

export async function supabaseFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const config = supabaseConfig();
  const headers = new Headers(init.headers);
  headers.set('Authorization', config.headers.Authorization);
  headers.set('apikey', config.headers.apikey);

  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const response = await fetch(`${config.url}${path}`, {
    ...init,
    body,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? `Supabase request failed: ${response.status}`);
  }

  return data as T;
}

export async function updateSource(sourceId: string, patch: Record<string, unknown>) {
  return supabaseFetch(`/rest/v1/sources?id=eq.${sourceId}`, {
    headers: { Prefer: 'return=representation' },
    json: patch,
    method: 'PATCH',
  });
}

export async function updateJob(sourceId: string, patch: Record<string, unknown>) {
  return supabaseFetch(`/rest/v1/parse_jobs?source_id=eq.${sourceId}`, {
    headers: { Prefer: 'return=representation' },
    json: patch,
    method: 'PATCH',
  });
}
