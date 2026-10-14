import { handleOptions, json } from '../_shared/cors.ts';

import { getUserIdFromAuth, supabaseFetch } from '../_shared/supabase.ts';



Deno.serve(async (request) => {

const options = handleOptions(request);

if (options) return options;



try {

const userId = getUserIdFromAuth(request.headers.get('Authorization'));

const userFilter = userId ? `&user_id=eq.${userId}` : '';

const url = new URL(request.url);

const sourceId = url.searchParams.get('sourceId');



if (!sourceId) {

const sources = await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/sources?select=*&order=created_at.desc${userFilter}`

);

const sourceIds = sources.map((source) => source.id).join(',');

const assets = sourceIds.length > 0

? await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/generated_assets?select=*&order=created_at.desc&source_id=in.(${sourceIds})`

)

: [];



return json({

assets,

source: null,

sources,

});

}



// Ownership check: the requested source must belong to the caller.

const sources = await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/sources?id=eq.${sourceId}&select=*${userFilter}`

);

const assets = await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/generated_assets?source_id=eq.${sourceId}&select=*&order=created_at.desc`

);



return json({

assets: sources.length > 0 ? assets : [],

source: sources[0] ?? null,

});

} catch (error) {

return json({ error: error instanceof Error ? error.message : 'Could not load assets.' }, 500);

}

});
