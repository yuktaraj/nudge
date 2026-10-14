import { handleOptions, json } from '../_shared/cors.ts';

import { assertSourceOwnership, getUserIdFromAuth, supabaseConfig, supabaseFetch, updateJob, updateSource } from '../_shared/supabase.ts';

import { chunkBySections, detectSections, type SectionChunk } from '../_shared/chunking.ts';

import { callGeminiGenerateContent, modelCandidates, type GeminiSchema } from '../_shared/gemini.ts';

import {
  citationLabelSet,
  normalizeCitations,
  sectionEvidence,
  type CitedChunkLike,
  type CitedFlashcard,
  type CitedNote,
  type CitedQuizItem,
  type SectionPack,
} from '../_shared/citation.ts';



type SourceRow = {

id: string;

mime_type: string;

storage_path: string;

subject?: string | null;

title: string;

topic?: string | null;

};



type StudyPack = {

verified?: boolean;

detailed_notes: string[];

flashcards: Array<{ back: string; front: string }>;

quiz: Array<{ answer: string; choices: string[]; question: string }>;

summary: string;

weak_topics: string[];

note_items?: CitedNote[];

flashcard_items?: CitedFlashcard[];

quiz_items?: CitedQuizItem[];

};



type CitedChunk = CitedChunkLike & SectionChunk & { id: string };



type OutlineNode = {

subtopics: string[];

title: string;

};



function minimumUsefulCharacters(source: SourceRow) {

return source.mime_type === 'text/plain' || source.mime_type.startsWith('image/') ? 20 : 120;

}



function logStage(sourceId: string, stage: string, detail?: string) {

console.log(JSON.stringify({ detail, sourceId, stage }));

}



function estimateTokens(text: string) {

return Math.ceil(text.length / 4);

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



try {

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

// Fall back to Gemini OCR instead of failing the whole pipeline.

logStage(source.id, 'parser_worker_failed', data?.error ?? `status ${response.status}`);

return '';

}



return String(data.text ?? '');

} catch (workerError) {

// Worker unreachable (network error): fall back to Gemini OCR.

logStage(source.id, 'parser_worker_unreachable', workerError instanceof Error ? workerError.message : 'unknown');

return '';

}

}



async function extractTextWithGemini(source: SourceRow, fileBuffer: ArrayBuffer) {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey) {

throw new Error('GEMINI_API_KEY is required for PDF and image parsing.');

}



const models = modelCandidates('GEMINI_EXTRACTION_MODEL', 'GEMINI_FALLBACK_MODELS', [

Deno.env.get('GEMINI_GENERATION_MODEL') ?? '',

'gemini-3.6-flash',

'gemini-3.5-flash-lite',

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



async function extractOutline(source: SourceRow, text: string): Promise<OutlineNode[]> {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey || text.trim().length === 0) {

throw new Error('Outline extraction unavailable.');

}



const models = modelCandidates('GEMINI_OUTLINE_MODEL', 'GEMINI_FALLBACK_MODELS', [

'gemini-3.5-flash-lite',

]);



const schema: GeminiSchema = {

properties: {

topics: {

items: {

properties: {

subtopics: { items: { type: 'STRING' }, type: 'ARRAY' },

title: { type: 'STRING' },

},

required: ['title'],

type: 'OBJECT',

},

type: 'ARRAY',

},

},

required: ['topics'],

type: 'OBJECT',

};



try {

const data = await callGeminiGenerateContent(

apiKey,

models,

{

contents: [

{

parts: [

{

text:

`Identify the main topics and sub-topics of this document "${source.title}". ` +

'Return them in document order. Keep titles short.\n\n' +

text.slice(0, 40_000),

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

'outline',

source.id

);



const raw = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;

if (!raw) {

throw new Error('Gemini response did not include JSON text.');

}

return JSON.parse(raw).topics as OutlineNode[];

} catch (error) {

console.warn(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown', stage: 'outline_llm_fallback', sourceId: source.id }));

}



// Fallback: headings detected by the structural chunker.

const headingTitles = uniqueValues(

detectSections(text)

.map((section) => section.sectionPath)

.filter((path): path is string => Boolean(path))

.slice(0, 30)

);

return headingTitles.map((title) => ({ subtopics: [], title }));

}






const MAX_SECTIONS_PER_PACK = 8;









function groupChunksBySection(chunks: CitedChunk[]) {

const groups = new Map<string, CitedChunk[]>();

for (const chunk of chunks) {

const key = chunk.sectionPath ?? 'General';

const existing = groups.get(key);

if (existing) {

existing.push(chunk);

} else {

groups.set(key, [chunk]);

}

}

return [...groups.entries()].map(([sectionPath, groupChunks]) => ({

chunks: groupChunks,

sectionPath,

}));

}



async function mapWithConcurrency<T, R>(

items: T[],

limit: number,

worker: (item: T) => Promise<R>

): Promise<Array<R | null>> {

const results: Array<R | null> = new Array(items.length).fill(null);

let nextIndex = 0;



const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {

while (nextIndex < items.length) {

const index = nextIndex++;

try {

results[index] = await worker(items[index]);

} catch {

results[index] = null;

}

}

});



await Promise.all(runners);

return results;

}



async function generateStudyPack(source: SourceRow, chunks: CitedChunk[]): Promise<StudyPack> {

const apiKey = Deno.env.get('GEMINI_API_KEY');

if (!apiKey) {

throw new Error('GEMINI_API_KEY is required.');

}



logStage(source.id, 'generate_map', `${chunks.length} cited chunks`);



const groups = groupChunksBySection(chunks).slice(0, MAX_SECTIONS_PER_PACK);



const settledPacks = await mapWithConcurrency(groups, 4, async (group) => {

const pack = await generateSectionPack(apiKey, source, group.sectionPath, group.chunks);

logStage(source.id, 'generate_section_done', `${group.sectionPath}: ${pack.notes.length}n/${pack.flashcards.length}f/${pack.quiz.length}q`);

return { chunks: group.chunks, pack };

});

const packedGroups = settledPacks.filter((entry): entry is { chunks: CitedChunk[]; pack: SectionPack } => entry !== null);

logStage(source.id, 'generate_map_done', `${packedGroups.length}/${groups.length} sections generated`);

await updateSource(source.id, { progress: 82, stage: 'generate' });



if (packedGroups.length === 0) {

logStage(source.id, 'generate_legacy_fallback');

return generateStudyPackWholeDocument(apiKey, source, chunks.map((chunk) => chunk.text));

}



// Lazy verification: items ship unverified; POST /functions/v1/verify-citations
// runs the entailment pass on demand and rewrites the asset.

const material = {

flashcards: packedGroups.flatMap((entry) => entry.pack.flashcards),

notes: packedGroups.flatMap((entry) => entry.pack.notes),

quiz: packedGroups.flatMap((entry) => entry.pack.quiz),

};

logStage(source.id, 'generate_material', `${material.notes.length}n/${material.flashcards.length}f/${material.quiz.length}q (unverified)`);

await updateSource(source.id, { progress: 88, stage: 'generate' });



const summarized = await summarizeVerifiedPacks(apiKey, source, material);



return {

detailed_notes: material.notes.map((note) => note.text),

flashcard_items: material.flashcards,

flashcards: material.flashcards.map((card) => ({ back: card.back, front: card.front })),

note_items: material.notes,

quiz: material.quiz.map((item) => ({

answer: item.answer,

choices: item.choices,

question: item.question,

})),

quiz_items: material.quiz,

summary: summarized.summary,

weak_topics: summarized.weak_topics,

verified: false,

};

}






async function generateSectionPack(

apiKey: string,

source: SourceRow,

sectionPath: string,

chunks: CitedChunk[]
): Promise<SectionPack> {

const knownLabels = citationLabelSet(chunks);

const citationSchema: GeminiSchema = { items: { type: 'STRING' }, type: 'ARRAY' };



const schema: GeminiSchema = {

properties: {

flashcards: {

items: {

properties: {

back: { type: 'STRING' },

citations: citationSchema,

front: { type: 'STRING' },

},

required: ['front', 'back'],

type: 'OBJECT',

},

type: 'ARRAY',

},

notes: {

items: {

properties: {

citations: citationSchema,

text: { type: 'STRING' },

},

required: ['text'],

type: 'OBJECT',

},

type: 'ARRAY',

},

quiz: {

items: {

properties: {

answer: { type: 'STRING' },

choices: { items: { type: 'STRING' }, type: 'ARRAY' },

citations: citationSchema,

question: { type: 'STRING' },

},

required: ['question', 'choices', 'answer'],

type: 'OBJECT',

},

type: 'ARRAY',

},

},

required: ['notes', 'flashcards', 'quiz'],

type: 'OBJECT',

};



const data = await callGeminiGenerateContent(

apiKey,

modelCandidates('GEMINI_GENERATION_MODEL', 'GEMINI_FALLBACK_MODELS', [

'gemini-3.6-flash',

'gemini-3.5-flash-lite',

]),

{

contents: [

{

parts: [

{

text:

`Create study material for the section "${sectionPath}" of "${source.title}".\n` +

'Each passage below starts with a chunk label like [C12].\n' +

'Generate as many unique notes, flashcards, and quiz questions as the content supports — cover every distinct concept without repeating the same idea.\n' +

'Every item MUST include a "citations" array listing the chunk labels it was derived from. Never invent labels.\n' +

'Use only the provided passages. Prefer active recall, FSRS-friendly flashcards, and concise quiz answers.\n\n' +

sectionEvidence(chunks),

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

'section_generate',

source.id

);



const text = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;

if (!text) {

throw new Error('Gemini response did not include JSON text.');

}



const parsed = JSON.parse(text) as Partial<SectionPack>;

return {

flashcards: (parsed.flashcards ?? []).map((card) => ({

back: String(card.back ?? ''),

citations: normalizeCitations(card.citations, knownLabels),

front: String(card.front ?? ''),

})).filter((card) => card.front && card.back),

notes: (parsed.notes ?? []).map((note) => ({

citations: normalizeCitations(note.citations, knownLabels),

text: String(note.text ?? ''),

})).filter((note) => note.text),

quiz: (parsed.quiz ?? []).map((item) => ({

answer: String(item.answer ?? ''),

choices: Array.isArray(item.choices) ? item.choices.map(String) : [],

citations: normalizeCitations(item.citations, knownLabels),

question: String(item.question ?? ''),

})).filter((item) => item.question && item.choices.length > 0 && item.answer),

sectionPath,

};

}



type VerifiedMaterial = {

flashcards: CitedFlashcard[];

notes: CitedNote[];

quiz: CitedQuizItem[];

};






async function summarizeVerifiedPacks(

apiKey: string,
source: SourceRow,
material: VerifiedMaterial

): Promise<{ summary: string; weak_topics: string[] }> {

const schema: GeminiSchema = {

properties: {

summary: { type: 'STRING' },

weak_topics: { items: { type: 'STRING' }, type: 'ARRAY' },

},

required: ['summary', 'weak_topics'],

type: 'OBJECT',

};



try {

const data = await callGeminiGenerateContent(

apiKey,

modelCandidates('GEMINI_GENERATION_MODEL', 'GEMINI_FALLBACK_MODELS', [

'gemini-3.6-flash',

'gemini-3.5-flash-lite',

]),

{

contents: [

{

parts: [

{

text:

`These are verified study notes generated from "${source.title}".\n` +

'Write a concise overall summary and list weak topics students should revise.\n\n' +

material.notes.map((note) => `- ${note.text}`).join('\n').slice(0, 30_000),

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

'summarize',

source.id

);



const raw = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;

if (raw) {

const parsed = JSON.parse(raw) as { summary?: string; weak_topics?: string[] };

return {

summary: String(parsed.summary ?? '').trim(),

weak_topics: uniqueValues(Array.isArray(parsed.weak_topics) ? parsed.weak_topics.map(String) : []),

};

}

} catch (error) {

console.warn(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown', sourceId: source.id, stage: 'summarize_skipped' }));

}



return {

summary: material.notes[0]?.text ?? source.title,

weak_topics: [],

};

}



async function generateStudyPackWholeDocument(apiKey: string, source: SourceRow, chunks: string[]): Promise<StudyPack> {

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



const data = await callGeminiGenerateContent(

apiKey,

modelCandidates('GEMINI_GENERATION_MODEL', 'GEMINI_FALLBACK_MODELS', [

'gemini-3.6-flash',

'gemini-3.5-flash-lite',

]),

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



const userId = getUserIdFromAuth(request.headers.get('Authorization'));

if (!userId || !(await assertSourceOwnership(userId, sourceId))) {

return json({ error: 'Source not found.' }, 404);

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

const sectionChunks: CitedChunk[] = chunkBySections(text).map((chunk, index) => ({
...chunk,
id: crypto.randomUUID(),
label: `C${index + 1}`,
}));

logStage(sourceId, 'chunk', `${sectionChunks.length} chunks across ${new Set(sectionChunks.map((chunk) => chunk.sectionPath)).size} sections`);



// Best-effort: derive and persist a topic outline without blocking the pipeline on failure.

let outline: OutlineNode[] | null = null;

try {

  outline = await extractOutline(source, text);

  await updateSource(sourceId, { outline: { topics: outline } });

  logStage(sourceId, 'outline', `${outline.length} topics`);

} catch (outlineError) {

  logStage(sourceId, 'outline_skipped', outlineError instanceof Error ? outlineError.message : 'unknown');

}



await Promise.all([

updateSource(sourceId, { progress: 62, stage: 'embed' }),

updateJob(sourceId, { stage: 'embed' }),

]);

logStage(sourceId, 'embed');

const embeddings = await createEmbeddings(sectionChunks.map((chunk) => chunk.text));

await supabaseFetch(`/rest/v1/chunks?source_id=eq.${sourceId}`, {

method: 'DELETE',

});

await supabaseFetch('/rest/v1/chunks', {

json: sectionChunks.map((chunk, index) => ({

chunk_index: index,

embedding: `[${embeddings[index].join(',')}]`,

id: chunk.id,

page: chunk.page,

section_path: chunk.sectionPath,

source_id: sourceId,

text: chunk.text,

token_count: estimateTokens(chunk.text),

})),

method: 'POST',

});



await Promise.all([

updateSource(sourceId, { progress: 78, stage: 'generate' }),

updateJob(sourceId, { stage: 'generate' }),

]);

logStage(sourceId, 'generate');

const studyPack = await generateStudyPack(source, sectionChunks);

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

