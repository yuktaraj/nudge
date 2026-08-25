import { handleOptions, json } from '../_shared/cors.ts';

import { supabaseConfig, supabaseFetch, updateJob, updateSource } from '../_shared/supabase.ts';



type SourceRow = {

id: string;

mime_type: string;

storage_path: string;

subject?: string | null;

title: string;

topic?: string | null;

};



type StudyPack = {

detailed_notes: string[];

flashcards: Array<{ back: string; front: string }>;

quiz: Array<{ answer: string; choices: string[]; question: string }>;

summary: string;

weak_topics: string[];

};



type GeminiSchema =

| { type: 'STRING' }

| { items: GeminiSchema; type: 'ARRAY' }

| { properties: Record<string, GeminiSchema>; required?: string[]; type: 'OBJECT' };



function minimumUsefulCharacters(source: SourceRow) {

return source.mime_type === 'text/plain' || source.mime_type.startsWith('image/') ? 20 : 120;

}



function logStage(sourceId: string, stage: string, detail?: string) {

console.log(JSON.stringify({ detail, sourceId, stage }));

}



function estimateTokens(text: string) {

return Math.ceil(text.length / 4);

}



function chunkText(text: string) {

const words = text.replace(/\s+/g, ' ').trim().split(' ');

const chunks: string[] = [];

const wordsPerChunk = 700;



for (let index = 0; index < words.length; index += wordsPerChunk) {

chunks.push(words.slice(index, index + wordsPerChunk).join(' '));

}



return chunks.filter(Boolean).slice(0, 24);

}



function arrayBufferToBase64(buffer: ArrayBuffer) {

let binary = '';

const bytes = new Uint8Array(buffer);

for (const byte of bytes) {

binary += String.fromCharCode(byte);

}



return btoa(binary);

}



function uniqueValues(values: string[]) {

return [...new Set(values.map((value) => value.trim()).filter(Boolean))];

}



function envList(name: string) {

return String(Deno.env.get(name) ?? '')

.split(',')

.map((value) => value.trim())

.filter(Boolean);

}



function modelCandidates(primaryEnvName: string, fallbackEnvName: string, defaultModels: string[]) {

return uniqueValues([

...envList(primaryEnvName),

...envList(fallbackEnvName),

...defaultModels,

]);

}



function isRetryableGeminiError(status: number, message: string) {

const lowerMessage = message.toLowerCase();

return (

status === 429 ||

status === 500 ||

status === 503 ||

lowerMessage.includes('high demand') ||

lowerMessage.includes('overload') ||

lowerMessage.includes('overloaded') ||

lowerMessage.includes('temporarily') ||

lowerMessage.includes('unavailable')

);

}



function delay(milliseconds: number) {

return new Promise((resolve) => setTimeout(resolve, milliseconds));

}



async function callGeminiGenerateContent(

apiKey: string,

models: string[],

body: Record<string, unknown>,

stage: string,

sourceId?: string

) {

let lastMessage = 'Gemini request failed.';



for (const model of models) {

for (const waitMs of [0, 900, 1800]) {

if (waitMs > 0) await delay(waitMs);



const response = await fetch(

`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,

{

body: JSON.stringify(body),

headers: { 'Content-Type': 'application/json' },

method: 'POST',

}

);

const data = await response.json();



if (response.ok) {

logStage(sourceId ?? 'unknown', `${stage}_model`, model);

return data;

}



lastMessage = data?.error?.message ?? `${stage} failed with ${response.status}`;

console.warn(JSON.stringify({ model, sourceId, stage, status: response.status, warning: lastMessage }));



if (!isRetryableGeminiError(response.status, lastMessage)) {

throw new Error(lastMessage);

}

}

}



throw new Error('Gemini is busy right now. Please retry this upload in a few minutes.');

}



async function downloadSource(path: string) {

const config = supabaseConfig();

const response = await fetch(`${config.url}/storage/v1/object/study-materials/${path}`, {

headers: config.headers,

});



if (!response.ok) {

throw new Error(`Could not download source file: ${response.status}`);

}



return response.arrayBuffer();

}



async function extractText(source: SourceRow, fileBuffer: ArrayBuffer) {

if (source.mime_type === 'text/plain') {

return new TextDecoder().decode(fileBuffer);

}



const workerUrl = Deno.env.get('PARSER_WORKER_URL');

if (!workerUrl) {

return '';

}



const response = await fetch(`${workerUrl.replace(/\/$/, '')}/extract`, {

body: JSON.stringify({

fileBase64: arrayBufferToBase64(fileBuffer),

mimeType: source.mime_type,

sourceId: source.id,

title: source.title,

}),

headers: { 'Content-Type': 'application/json' },

method: 'POST',

});

const data = await response.json();



if (!response.ok) {

throw new Error(data?.error ?? 'Parser worker failed.');

}



return String(data.text ?? '');

}



async function extractTextWithGemini(source: SourceRow, fileBuffer: ArrayBuffer) {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey) {

throw new Error('GEMINI_API_KEY is required for PDF and image parsing.');

}



const models = modelCandidates('GEMINI_EXTRACTION_MODEL', 'GEMINI_FALLBACK_MODELS', [

Deno.env.get('GEMINI_GENERATION_MODEL') ?? '',

'gemini-2.5-flash',

'gemini-2.5-flash-lite',

'gemini-2.0-flash',

]);

const data = await callGeminiGenerateContent(

apiKey,

models,

{

contents: [

{

parts: [

{

text:

`Extract the readable study text from "${source.title}". ` +

'Return only the extracted text. Keep headings, formulas, labels, and bullet points when visible. ' +

'If the file is an image, perform OCR. If it is a PDF, read all pages you can access.',

},

{

inline_data: {

data: arrayBufferToBase64(fileBuffer),

mime_type: source.mime_type,

},

},

],

role: 'user',

},

],

},

'extract',

source.id

);



return String(

data.candidates?.[0]?.content?.parts

?.map((part: { text?: string }) => part.text ?? '')

.join('\n')

.trim() ?? ''

);

}



async function createEmbeddings(chunks: string[]) {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey) {

throw new Error('GEMINI_API_KEY is required.');

}



const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`, {

body: JSON.stringify({

requests: chunks.map((chunk) => ({

content: {

parts: [{ text: chunk }],

},

model: 'models/gemini-embedding-001',

})),

}),

headers: {

'Content-Type': 'application/json',

},

method: 'POST',

});

const data = await response.json();



if (!response.ok) {

throw new Error(data?.error?.message ?? 'Gemini embedding request failed.');

}



return data.embeddings.map((item: { values: number[] }) => item.values);

}



async function generateStudyPack(source: SourceRow, chunks: string[]): Promise<StudyPack> {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey) {

throw new Error('GEMINI_API_KEY is required.');

}



const schema: GeminiSchema = {

properties: {

detailed_notes: { items: { type: 'STRING' }, type: 'ARRAY' },

flashcards: {

items: {

properties: {

back: { type: 'STRING' },

front: { type: 'STRING' },

},

required: ['front', 'back'],

type: 'OBJECT',

},

type: 'ARRAY',

},

quiz: {

items: {

properties: {

answer: { type: 'STRING' },

choices: { items: { type: 'STRING' }, type: 'ARRAY' },

question: { type: 'STRING' },

},

required: ['question', 'choices', 'answer'],

type: 'OBJECT',

},

type: 'ARRAY',

},

summary: { type: 'STRING' },

weak_topics: { items: { type: 'STRING' }, type: 'ARRAY' },

},

required: ['summary', 'detailed_notes', 'flashcards', 'quiz', 'weak_topics'],

type: 'OBJECT',

};



const sourceContext = [

source.subject ? `Subject: ${source.subject}` : null,

source.topic ? `Topic: ${source.topic}` : null,

].filter(Boolean).join('\n');

const models = modelCandidates('GEMINI_GENERATION_MODEL', 'GEMINI_FALLBACK_MODELS', [

'gemini-2.5-flash',

'gemini-2.5-flash-lite',

'gemini-2.0-flash',

]);

const data = await callGeminiGenerateContent(

apiKey,

models,

{

contents: [

{

parts: [

{

text:

`Create a focused study pack from the uploaded source "${source.title}". ` +

(sourceContext ? `${sourceContext}\n` : '') +

'Use only the provided source text. Prefer active recall, FSRS-friendly flashcards, and concise quiz answers.\n\n' +

chunks.join('\n\n---\n\n').slice(0, 80_000),

},

],

role: 'user',

},

],

generationConfig: {

responseMimeType: 'application/json',

responseSchema: schema,

},

},

'generate',

source.id

);



const text = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;

if (!text) {

throw new Error('Gemini response did not include JSON text.');

}



return JSON.parse(text) as StudyPack;

}



Deno.serve(async (request) => {

const options = handleOptions(request);

if (options) return options;



let sourceId: string | null = null;



try {

if (request.method !== 'POST') {

return json({ error: 'Method not allowed.' }, 405);

}



const body = await request.json();

sourceId = body.sourceId ?? null;

if (!sourceId) {

return json({ error: 'sourceId is required.' }, 400);

}

logStage(sourceId, 'received');



await Promise.all([

updateSource(sourceId, { progress: 20, stage: 'extract_text', status: 'processing' }),

updateJob(sourceId, { stage: 'extract_text', status: 'running' }),

]);

logStage(sourceId, 'extract_text');



const [source] = await supabaseFetch<SourceRow[]>(`/rest/v1/sources?id=eq.${sourceId}&select=*`);

if (!source) {

return json({ error: 'Source not found.' }, 404);

}



const fileBuffer = await downloadSource(source.storage_path);

let text = await extractText(source, fileBuffer);

logStage(sourceId, 'extracted', `${text.trim().length} chars from ${source.mime_type}`);



if (

text.trim().length < minimumUsefulCharacters(source) &&

(source.mime_type === 'application/pdf' || source.mime_type.startsWith('image/'))

) {

await Promise.all([

updateSource(sourceId, { progress: 32, stage: 'ocr', status: 'processing' }),

updateJob(sourceId, { stage: 'ocr', status: 'running' }),

]);

logStage(sourceId, 'gemini_file_extract', source.mime_type);

text = await extractTextWithGemini(source, fileBuffer);

logStage(sourceId, 'gemini_file_extracted', `${text.trim().length} chars`);

}



if (text.trim().length < minimumUsefulCharacters(source)) {

await Promise.all([

updateSource(sourceId, {

error: 'Text extraction was too short. OCR is needed for this source.',

progress: 35,

stage: 'ocr',

status: 'needs_ocr',

}),

updateJob(sourceId, {

error: 'Weak extraction; OCR worker required.',

stage: 'ocr',

status: 'needs_ocr',

}),

]);

logStage(sourceId, 'needs_ocr', `Only ${text.trim().length} chars extracted.`);

return json({ sourceId, stage: 'ocr', status: 'needs_ocr' });

}



await Promise.all([

updateSource(sourceId, { progress: 45, stage: 'chunk' }),

updateJob(sourceId, { stage: 'chunk' }),

]);

const chunks = chunkText(text);

logStage(sourceId, 'chunk', `${chunks.length} chunks`);



await Promise.all([

updateSource(sourceId, { progress: 62, stage: 'embed' }),

updateJob(sourceId, { stage: 'embed' }),

]);

logStage(sourceId, 'embed');

const embeddings = await createEmbeddings(chunks);

await supabaseFetch(`/rest/v1/chunks?source_id=eq.${sourceId}`, {

method: 'DELETE',

});

await supabaseFetch('/rest/v1/chunks', {

json: chunks.map((chunk, index) => ({

chunk_index: index,

embedding: `[${embeddings[index].join(',')}]`,

source_id: sourceId,

text: chunk,

token_count: estimateTokens(chunk),

})),

method: 'POST',

});



await Promise.all([

updateSource(sourceId, { progress: 78, stage: 'generate' }),

updateJob(sourceId, { stage: 'generate' }),

]);

logStage(sourceId, 'generate');

const studyPack = await generateStudyPack(source, chunks);

await supabaseFetch(`/rest/v1/generated_assets?source_id=eq.${sourceId}`, {

method: 'DELETE',

});

await supabaseFetch('/rest/v1/generated_assets', {

headers: { Prefer: 'return=representation' },

json: {

content_json: studyPack,

source_id: sourceId,

title: source.title,

type: 'study_pack',

},

method: 'POST',

});



await Promise.all([

updateSource(sourceId, {

error: null,

progress: 100,

stage: 'complete',

status: 'ready',

}),

updateJob(sourceId, {

error: null,

stage: 'complete',

status: 'completed',

}),

]);

logStage(sourceId, 'complete');



return json({ sourceId, stage: 'complete', status: 'ready' });

} catch (error) {

const message = error instanceof Error ? error.message : 'Processing failed.';

console.error(JSON.stringify({ error: message, sourceId, stage: 'failed' }));

if (sourceId) {

try {

await Promise.all([

updateSource(sourceId, { error: message, progress: 100, stage: 'failed', status: 'failed' }),

updateJob(sourceId, { error: message, stage: 'failed', status: 'failed' }),

]);

} catch {

// Ignore failure-path update errors.

}

}



return json({ error: message }, 500);

}

}); 

