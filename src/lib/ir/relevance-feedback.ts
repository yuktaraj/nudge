import type { QueryReformulation } from './types';

interface DocVector {
  docId: string;
  vector: Map<string, number>;
}

export interface RelevanceFeedbackResult {
  originalQuery: string;
  reformulatedQuery: string;
  model: 'rocchio' | 'ide_regular' | 'ide_dec_hi';
  alpha: number;
  beta: number;
  gamma: number;
  topTerms: Array<{ term: string; weight: number }>;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\w+/g) ?? []);
}

function buildDocVectors(
  docs: DocVector[],
  vocabulary: Set<string>
): Map<string, Map<string, number>> {
  const vectors = new Map<string, Map<string, number>>();
  for (const doc of docs) {
    vectors.set(doc.docId, doc.vector);
  }
  return vectors;
}

function averageDocVector(
  docVectors: DocVector[],
  vocabulary: Set<string>
): Map<string, number> {
  const avg = new Map<string, number>();
  if (docVectors.length === 0) return avg;

  for (const doc of docVectors) {
    for (const [term, weight] of doc.vector) {
      avg.set(term, (avg.get(term) ?? 0) + weight);
    }
  }

  for (const term of vocabulary) {
    if (avg.has(term)) {
      avg.set(term, avg.get(term)! / docVectors.length);
    }
  }

  return avg;
}

function vectorMagnitude(vector: Map<string, number>): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

function vectorSubtract(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const result = new Map<string, number>(a);
  for (const [term, value] of b) {
    result.set(term, (result.get(term) ?? 0) - value);
  }
  return result;
}

function vectorAdd(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const result = new Map<string, number>(a);
  for (const [term, value] of b) {
    result.set(term, (result.get(term) ?? 0) + value);
  }
  return result;
}

function vectorScale(vector: Map<string, number>, scalar: number): Map<string, number> {
  const result = new Map<string, number>();
  for (const [term, value] of vector) {
    result.set(term, value * scalar);
  }
  return result;
}

function buildQueryVector(query: string): Map<string, number> {
  const vector = new Map<string, number>();
  const tokens = tokenize(query);
  for (const token of tokens) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function extractVocabulary(
  queryVector: Map<string, number>,
  relevantDocs: DocVector[],
  nonRelevantDocs: DocVector[]
): Set<string> {
  const vocabulary = new Set<string>(queryVector.keys());
  for (const d of relevantDocs) {
    for (const k of d.vector.keys()) vocabulary.add(k);
  }
  for (const d of nonRelevantDocs) {
    for (const k of d.vector.keys()) vocabulary.add(k);
  }
  return vocabulary;
}

export function rocchioAlgorithm(
  query: string,
  relevantDocs: DocVector[],
  nonRelevantDocs: DocVector[],
  alpha = 1,
  beta = 0.75,
  gamma = 0.25,
  topN = 10
): RelevanceFeedbackResult {
  const queryVector = buildQueryVector(query);
  const vocabulary = extractVocabulary(queryVector, relevantDocs, nonRelevantDocs);

  const avgRel = relevantDocs.length > 0 ? averageDocVector(relevantDocs, vocabulary) : new Map();
  const avgNonRel = nonRelevantDocs.length > 0 ? averageDocVector(nonRelevantDocs, vocabulary) : new Map();

  const newVector = vectorAdd(
    vectorAdd(vectorScale(queryVector, alpha), vectorScale(avgRel, beta)),
    vectorScale(avgNonRel, -gamma)
  );

  const positiveTerms = [...newVector.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return {
    originalQuery: query,
    reformulatedQuery: positiveTerms.map(([term]) => term).join(' '),
    model: 'rocchio',
    alpha,
    beta,
    gamma,
    topTerms: positiveTerms.map(([term, weight]) => ({ term, weight })),
  };
}

export function ideRegular(
  query: string,
  relevantDocs: DocVector[],
  nonRelevantDocs: DocVector[],
  beta = 0.75,
  gamma = 0.25,
  topN = 10
): RelevanceFeedbackResult {
  const queryVector = buildQueryVector(query);
  const vocabulary = extractVocabulary(queryVector, relevantDocs, nonRelevantDocs);

  const avgRel = relevantDocs.length > 0 ? averageDocVector(relevantDocs, vocabulary) : new Map();
  const avgNonRel = nonRelevantDocs.length > 0 ? averageDocVector(nonRelevantDocs, vocabulary) : new Map();

  const scaledRel = vectorScale(avgRel, beta);
  const scaledNonRel = vectorScale(avgNonRel, gamma);
  const combinedRel = vectorSubtract(scaledRel, scaledNonRel);

  const newVector = vectorAdd(queryVector, combinedRel);

  const positiveTerms = [...newVector.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return {
    originalQuery: query,
    reformulatedQuery: positiveTerms.map(([term]) => term).join(' '),
    model: 'ide_regular',
    alpha: 1,
    beta,
    gamma,
    topTerms: positiveTerms.map(([term, weight]) => ({ term, weight })),
  };
}

export function ideDecHi(
  query: string,
  relevantDocs: DocVector[],
  nonRelevantDocs: DocVector[],
  beta = 0.75,
  gamma = 0.25,
  topN = 10
): RelevanceFeedbackResult {
  const queryVector = buildQueryVector(query);
  const vocabulary = extractVocabulary(queryVector, relevantDocs, nonRelevantDocs);

  const avgRel = relevantDocs.length > 0 ? averageDocVector(relevantDocs, vocabulary) : new Map();
  const scaledRel = vectorScale(avgRel, beta);

  let scaledNonRel = new Map<string, number>();
  if (nonRelevantDocs.length > 0) {
    const sorted = [...nonRelevantDocs].sort((a, b) => {
      const simA = cosineSim(a.vector, queryVector);
      const simB = cosineSim(b.vector, queryVector);
      return simB - simA;
    });
    const topNonRel = sorted[0];
    scaledNonRel = vectorScale(topNonRel.vector, gamma);
  }

  const combinedRel = vectorSubtract(scaledRel, scaledNonRel);
  const newVector = vectorAdd(queryVector, combinedRel);

  const positiveTerms = [...newVector.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return {
    originalQuery: query,
    reformulatedQuery: positiveTerms.map(([term]) => term).join(' '),
    model: 'ide_dec_hi',
    alpha: 1,
    beta,
    gamma,
    topTerms: positiveTerms.map(([term, weight]) => ({ term, weight })),
  };
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  const termsA = new Set(a.keys());
  const termsB = new Set(b.keys());
  const allTerms = new Set([...termsA, ...termsB]);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const term of allTerms) {
    const va = a.get(term) ?? 0;
    const vb = b.get(term) ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function relevanceFeedbackQueryExpansion(
  query: string,
  relevantDocs: DocVector[],
  topTermsPerDoc = 5,
  expansionFactor = 2
): RelevanceFeedbackResult {
  const termScores = new Map<string, number>();
  const queryTerms = tokenize(query);

  for (const term of queryTerms) {
    termScores.set(term, (termScores.get(term) ?? 0) + 1.0);
  }

  for (const doc of relevantDocs) {
    const sorted = [...doc.vector.entries()]
      .filter(([term]) => !queryTerms.includes(term))
      .sort((a, b) => b[1] - a[1])
      .slice(0, topTermsPerDoc);

    for (const [term, weight] of sorted) {
      termScores.set(term, (termScores.get(term) ?? 0) + weight);
    }
  }

  const sortedTerms = [...termScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, expansionFactor * topTermsPerDoc);

  return {
    originalQuery: query,
    reformulatedQuery: [...queryTerms, ...sortedTerms.map(([term]) => term)].join(' '),
    model: 'rocchio',
    alpha: 1,
    beta: 0.75,
    gamma: 0.25,
    topTerms: sortedTerms.map(([term, weight]) => ({ term, weight })),
  };
}

export function applyRelevanceFeedback(
  feedback: RelevanceFeedbackResult,
  vsmSearch: (query: string, topK?: number) => Array<{ docId: string; score: number }>,
  topK = 10
): Array<{ docId: string; score: number }> {
  return vsmSearch(feedback.reformulatedQuery, topK);
}