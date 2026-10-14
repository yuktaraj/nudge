import { callGeminiGenerateContent, modelCandidates, type GeminiSchema } from './gemini.ts';

export type CitedNote = {
  citations: string[];
  text: string;
};

export type CitedFlashcard = {
  back: string;
  citations: string[];
  front: string;
};

export type CitedQuizItem = {
  answer: string;
  choices: string[];
  citations: string[];
  question: string;
};

export type SectionPack = {
  flashcards: CitedFlashcard[];
  notes: CitedNote[];
  quiz: CitedQuizItem[];
  sectionPath: string;
};

export type VerifiedMaterial = {
  flashcards: CitedFlashcard[];
  notes: CitedNote[];
  quiz: CitedQuizItem[];
};

export type CitedChunkLike = {
  label: string;
  sectionPath: string | null;
  text: string;
};


export function normalizeCitations(raw: unknown, knownLabels: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map((value) => String(value).trim().toUpperCase())
    .filter((label) => knownLabels.has(label)))];
}

export function citationLabelSet(chunks: CitedChunkLike[]) {
  return new Set(chunks.map((chunk) => chunk.label));
}

export function sectionEvidence(chunks: CitedChunkLike[]) {
  return chunks
    .map((chunk) => `[${chunk.label}] ${chunk.text}`)
    .join('\n\n')
    .slice(0, 26_000);
}

/**
 * Entailment check: verifies each generated item against the passages it cites.
 * Runs one batched Gemini call per group; groups are processed concurrently.
 * Lenient by design: on verifier failure a group's claims are kept.
 */
export async function verifyGroups(
  apiKey: string,
  groups: Array<{ chunks: CitedChunkLike[]; pack: SectionPack }>,
  options: { concurrency?: number; sourceId?: string } = {}
): Promise<VerifiedMaterial> {
  const concurrency = options.concurrency ?? 4;

  const schema: GeminiSchema = {
    properties: {
      results: {
        items: {
          properties: {
            index: { type: 'INTEGER' },
            supported: { type: 'BOOLEAN' },
          },
          required: ['index', 'supported'],
          type: 'OBJECT',
        },
        type: 'ARRAY',
      },
    },
    required: ['results'],
    type: 'OBJECT',
  };

  const verifyGroup = async ({ chunks, pack }: { chunks: CitedChunkLike[]; pack: SectionPack }): Promise<VerifiedMaterial> => {
    const claims: Array<{ claim: string; kind: 'note' | 'flashcard' | 'quiz'; ref: CitedNote | CitedFlashcard | CitedQuizItem }> = [];

    pack.notes.forEach((note) => claims.push({ claim: note.text, kind: 'note', ref: note }));
    pack.flashcards.forEach((card) => claims.push({ claim: `${card.front} -> ${card.back}`, kind: 'flashcard', ref: card }));
    pack.quiz.forEach((item) => claims.push({ claim: `${item.question} Answer: ${item.answer}`, kind: 'quiz', ref: item }));

    if (claims.length === 0) return { flashcards: [], notes: [], quiz: [] };

    let supportedIndexes: Set<number>;
    try {
      const data = await callGeminiGenerateContent(
        apiKey,
        modelCandidates('GEMINI_VERIFY_MODEL', 'GEMINI_FALLBACK_MODELS', [
          'gemini-3.5-flash-lite',
          'gemini-3.6-flash',
        ]),
        {
          contents: [
            {
              parts: [
                {
                  text:
                    'You are a fact-checker. Each passage starts with a chunk label like [C1].\n' +
                    'For each numbered CLAIM below, decide whether it is fully supported by the passages.\n' +
                    'Mark supported=false if the claim contradicts the passages, cites facts absent from them, or exaggerates.\n\n' +
                    `PASSAGES:\n${sectionEvidence(chunks)}\n\nCLAIMS:\n${claims.map((entry, index) => `${index + 1}. ${entry.claim}`).join('\n')}`,
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
        'verify',
        options.sourceId
      );

      const raw = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;
      const parsed = raw ? JSON.parse(raw) as { results?: Array<{ index?: number; supported?: boolean }> } : {};
      supportedIndexes = new Set((parsed.results ?? [])
        .filter((result) => result.supported !== false)
        .map((result) => Number(result.index) - 1)
        .filter((index) => index >= 0 && index < claims.length));
    } catch (error) {
      console.warn(JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown',
        sourceId: options.sourceId,
        stage: 'verify_skipped',
      }));
      supportedIndexes = new Set(claims.map((_, index) => index));
    }

    const material: VerifiedMaterial = { flashcards: [], notes: [], quiz: [] };
    claims.forEach((entry, index) => {
      if (!supportedIndexes.has(index)) return;
      if (entry.kind === 'note') material.notes.push(entry.ref as CitedNote);
      else if (entry.kind === 'flashcard') material.flashcards.push(entry.ref as CitedFlashcard);
      else material.quiz.push(entry.ref as CitedQuizItem);
    });
    return material;
  };

  const results: Array<VerifiedMaterial | null> = new Array(groups.length).fill(null);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
    while (nextIndex < groups.length) {
      const index = nextIndex++;
      try {
        results[index] = await verifyGroup(groups[index]);
      } catch {
        results[index] = null;
      }
    }
  });

  await Promise.all(runners);

  const material: VerifiedMaterial = { flashcards: [], notes: [], quiz: [] };
  for (const result of results) {
    if (!result) continue;
    material.notes.push(...result.notes);
    material.flashcards.push(...result.flashcards);
    material.quiz.push(...result.quiz);
  }
  return material;
}
