import { handleOptions, json } from '../_shared/cors.ts';

import { supabaseFetch } from '../_shared/supabase.ts';



Deno.serve(async (request) => {

const options = handleOptions(request);

if (options) return options;



try {

const url = new URL(request.url);

const sourceId = url.searchParams.get('sourceId');



if (!sourceId) {

const sources = await supabaseFetch<Array<Record<string, unknown>>>(

'/rest/v1/sources?select=*&order=created_at.desc'

);

const assets = await supabaseFetch<Array<Record<string, unknown>>>(

'/rest/v1/generated_assets?select=*&order=created_at.desc'

);



return json({

assets,

source: null,

sources,

});

}



const sources = await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/sources?id=eq.${sourceId}&select=*`

);

const assets = await supabaseFetch<Array<Record<string, unknown>>>(

`/rest/v1/generated_assets?source_id=eq.${sourceId}&select=*&order=created_at.desc`

);



return json({

assets,

source: sources[0] ?? null,

});

} catch (error) {

return json({ error: error instanceof Error ? error.message : 'Could not load assets.' }, 500);

}

}); 

