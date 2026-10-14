export interface Posting {
  docId: string;
  termFrequency: number;
  positions: number[];
}

export interface InvertedIndex {
  terms: Map<string, Posting[]>;
  docIds: Set<string>;
  docLengths: Map<string, number>;
}

export interface TermDocumentEntry {
  docId: string;
  term: string;
  frequency: number;
  present: boolean;
}

export interface TermDocumentMatrix {
  terms: string[];
  docIds: string[];
  matrix: boolean[][];
}

export interface Token {
  value: string;
  position: number;
  type: 'word' | 'number' | 'punctuation' | 'whitespace' | 'other';
}

export interface NounGroup {
  text: string;
  startIndex: number;
  endIndex: number;
  tokens: Token[];
}

export interface StemmedTerm {
  original: string;
  stem: string;
}

export interface SearchResult {
  docId: string;
  score: number;
  matchedTerms: string[];
}

export interface RelevanceJudgment {
  query: string;
  docId: string;
  rank: number;
  relevanceGrade: 0 | 1 | 2 | 3 | 4;
  timestamp: string;
}

export interface EvaluationMetrics {
  precision: number;
  recall: number;
  f1Score: number;
  precisionAtK: Record<number, number>;
  averagePrecision: number;
  meanAveragePrecision: number;
  ndcgAtK: Record<number, number>;
}

export interface QueryReformulation {
  originalQuery: string;
  reformulatedQuery: string;
  alpha: number;
  beta: number;
  gamma: number;
  relevantDocs: string[];
  nonRelevantDocs: string[];
}

export interface PatternMatchResult {
  pattern: string;
  matches: PatternMatch[];
}

export interface PatternMatch {
  docId: string;
  text: string;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  distance?: number;
}

export interface SuffixArrayEntry {
  suffix: string;
  index: number;
}

export interface TFIDFVector {
  docId: string;
  vector: Map<string, number>;
}
