import { useCallback, useEffect, useMemo, useState } from 'react';

import { BooleanModel } from './boolean';
import { InvertedIndexBuilder } from './indexing';
import { VectorSpaceModel } from './vsm';
import {
  exactMatch,
  fuzzyMatch,
  prefixMatch,
  suffixMatch,
  substringMatch,
} from './pattern-matching';
import {
  rocchioAlgorithm,
  ideRegular,
  ideDecHi,
} from './relevance-feedback';
import type { PatternMatchResult } from './types';
import {
  clearRelevanceFeedback,
  loadRelevanceFeedback,
  saveRelevanceFeedback,
} from '@/lib/study-state';

export type SearchMode = 'exact' | 'prefix' | 'suffix' | 'substring' | 'fuzzy' | 'boolean' | 'vsm' | 'hybrid';
export type FeedbackModel = 'rocchio' | 'ide_regular' | 'ide_dec_hi';

export interface SearchDocument {
  id: string;
  title: string;
  text: string;
  sourceId?: string;
  sectionPath?: string;
}

export interface RankedSearchResult {
  docId: string;
  title: string;
  sourceId?: string;
  sectionPath?: string;
  score: number;
  matchedTerms: string[];
  snippet?: string;
  /** Which retrieval method(s) contributed to this result */
  retrievedBy: SearchMode[];
}

export interface SearchFeedback {
  docId: string;
  relevant: boolean;
}

export interface SearchHookResult {
  results: RankedSearchResult[];
  query: string;
  setQuery: (query: string) => void;
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  feedbackModel: FeedbackModel;
  setFeedbackModel: (model: FeedbackModel) => void;
  /**
   * Mark a document as relevant/not-relevant.
   * When `relevant=true`, all other docIds in `currentResultDocIds` are
   * automatically marked as not-relevant (implicit negative feedback).
   */
  submitFeedback: (docId: string, relevant: boolean, currentResultDocIds?: string[]) => void;
  clearFeedback: () => void;
  hasFeedback: boolean;
  relevantDocs: string[];
  nonRelevantDocs: string[];
}

function toRankedResults(
  documents: SearchDocument[],
  scores: Map<string, number>,
  matchedTerms: Map<string, string[]> = new Map(),
  retrievedByMap: Map<string, SearchMode[]> = new Map()
): RankedSearchResult[] {
  const docById = new Map(documents.map((doc) => [doc.id, doc]));
  const results: RankedSearchResult[] = [];

  for (const [docId, score] of scores.entries()) {
    const doc = docById.get(docId);
    if (!doc) continue;
    results.push({
      docId,
      title: doc.title,
      sourceId: doc.sourceId,
      sectionPath: doc.sectionPath,
      score,
      matchedTerms: matchedTerms.get(docId) ?? [],
      snippet: doc.text,
      retrievedBy: retrievedByMap.get(docId) ?? [],
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Run a single-term pattern search (no query tokenization).
 */
function runSinglePatternSearch(
  documents: SearchDocument[],
  term: string,
  mode: SearchMode
): PatternMatchResult {
  switch (mode) {
    case 'exact':
      return exactMatch(documents, term);
    case 'prefix':
      return prefixMatch(documents, term);
    case 'suffix':
      return suffixMatch(documents, term);
    case 'substring':
      return substringMatch(documents, term);
    case 'fuzzy':
      return fuzzyMatch(documents, term, 2);
    default:
      return exactMatch(documents, term);
  }
}

/**
 * Run a pattern search, tokenizing multi-word queries for prefix/suffix/fuzzy.
 *
 * Exact and substring intentionally match the full phrase as a contiguous
 * substring — that is their correct semantic. But prefix ("starts with"),
 * suffix ("ends with"), and fuzzy ("within edit distance") only make sense
 * at the individual-word level, so we split multi-word queries into terms
 * and merge the per-term results.
 */
function runPatternSearch(
  documents: SearchDocument[],
  query: string,
  mode: SearchMode
): PatternMatchResult {
  // Exact and substring: phrase-level matching (no tokenization)
  if (mode === 'exact' || mode === 'substring') {
    return runSinglePatternSearch(documents, query, mode);
  }

  // Prefix, suffix, fuzzy: tokenize multi-word queries into individual terms
  const terms = query.toLowerCase().match(/\w+/g) ?? [];
  if (terms.length <= 1) {
    return runSinglePatternSearch(documents, query, mode);
  }

  // Run per-term, deduplicate by (docId, startIndex)
  const allMatches: import('./types').PatternMatch[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const result = runSinglePatternSearch(documents, term, mode);
    for (const match of result.matches) {
      const key = `${match.docId}:${match.startIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        allMatches.push(match);
      }
    }
  }

  return { pattern: query, matches: allMatches };
}

export function useDocumentSearch(
  documents: SearchDocument[],
  initialMode: SearchMode = 'hybrid'
): SearchHookResult {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [feedbackModel, setFeedbackModel] = useState<FeedbackModel>('rocchio');
  const [feedback, setFeedback] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let isMounted = true;
    loadRelevanceFeedback().then((records) => {
      if (!isMounted || records.length === 0) return;
      setFeedback((current) => {
        const next = new Map(current);
        for (const record of records) {
          if (!next.has(record.docId)) {
            next.set(record.docId, record.relevant);
          }
        }
        return next;
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const invertedIndex = useMemo(() => {
    const builder = new InvertedIndexBuilder();
    for (const doc of documents) {
      builder.indexDocument(doc.id, doc.text, false);
    }
    return builder.getIndex();
  }, [documents]);

  const booleanModel = useMemo(() => new BooleanModel(invertedIndex), [invertedIndex]);

  const vsm = useMemo(() => {
    const docs = documents.map((doc) => ({ id: doc.id, text: doc.text }));
    return new VectorSpaceModel(docs);
  }, [documents]);

  const results = useMemo(() => {
    if (!query.trim()) return [];

    const trimmedQuery = query.trim();

    if (mode === 'boolean') {
      try {
        const matched = booleanModel.evaluate(trimmedQuery);
        const scores = new Map<string, number>();
        const retrievedByMap = new Map<string, SearchMode[]>();
        for (const docId of matched) {
          scores.set(docId, 1);
          retrievedByMap.set(docId, ['boolean']);
        }
        const ranked = booleanModel.evaluateTermFrequency(trimmedQuery, documents.length);
        const freqMap = new Map(ranked.map((item) => [item.docId, item.score]));
        for (const [docId, freq] of freqMap) {
          if (scores.has(docId)) {
            scores.set(docId, 1 + freq / 100);
          }
        }
        return toRankedResults(documents, scores, new Map(), retrievedByMap);
      } catch {
        return [];
      }
    }

    if (mode === 'vsm') {
      const ranked = vsm.search(trimmedQuery, documents.length);
      const scores = new Map(ranked.map((item) => [item.docId, item.score]));
      const retrievedByMap = new Map(ranked.map((item) => [item.docId, ['vsm' as SearchMode]]));
      return toRankedResults(documents, scores, new Map(), retrievedByMap);
    }

    const patternTypes: SearchMode[] = ['exact', 'prefix', 'suffix', 'substring', 'fuzzy'];
    const matchedScores = new Map<string, number>();
    const matchedTerms = new Map<string, string[]>();
    const retrievedByMap = new Map<string, SearchMode[]>();

    if (mode === 'hybrid') {
      for (const patternType of patternTypes) {
        const matchResult = runPatternSearch(documents, trimmedQuery, patternType);
        for (const match of matchResult.matches) {
          const current = matchedScores.get(match.docId) ?? 0;
          matchedScores.set(match.docId, current + (patternType === 'fuzzy' ? 0.5 : 1));
          if (!matchedTerms.has(match.docId)) {
            matchedTerms.set(match.docId, []);
          }
          matchedTerms.get(match.docId)!.push(match.matchedText);
          const modes = retrievedByMap.get(match.docId) ?? [];
          if (!modes.includes(patternType)) modes.push(patternType);
          retrievedByMap.set(match.docId, modes);
        }
      }

      const vsmScores = vsm.search(trimmedQuery, documents.length);
      for (const item of vsmScores) {
        matchedScores.set(item.docId, (matchedScores.get(item.docId) ?? 0) + item.score);
        const modes = retrievedByMap.get(item.docId) ?? [];
        if (!modes.includes('vsm')) modes.push('vsm');
        retrievedByMap.set(item.docId, modes);
      }

      return toRankedResults(documents, matchedScores, matchedTerms, retrievedByMap);
    }

    const matchResult = runPatternSearch(documents, trimmedQuery, mode);
    for (const match of matchResult.matches) {
      matchedScores.set(match.docId, 1);
      if (!matchedTerms.has(match.docId)) {
        matchedTerms.set(match.docId, []);
      }
      matchedTerms.get(match.docId)!.push(match.matchedText);
      retrievedByMap.set(match.docId, [mode]);
    }

    return toRankedResults(documents, matchedScores, matchedTerms, retrievedByMap);
  }, [documents, query, mode, booleanModel, vsm]);

  const relevantDocs = useMemo(
    () => [...feedback.entries()].filter(([, isRelevant]) => isRelevant).map(([docId]) => docId),
    [feedback]
  );
  const nonRelevantDocs = useMemo(
    () => [...feedback.entries()].filter(([, isRelevant]) => !isRelevant).map(([docId]) => docId),
    [feedback]
  );

  const submitFeedback = useCallback(
    (docId: string, relevant: boolean, currentResultDocIds?: string[]) => {
      setFeedback((current) => {
        const next = new Map(current);
        next.set(docId, relevant);
        // When marking a document as relevant, auto-mark all other visible
        // results as not-relevant (implicit negative feedback for Rocchio etc.)
        if (relevant && currentResultDocIds) {
          for (const otherId of currentResultDocIds) {
            if (otherId !== docId && !next.has(otherId)) {
              next.set(otherId, false);
            }
          }
        }
        return next;
      });
      const ts = new Date().toISOString();
      void saveRelevanceFeedback({
        query: query.trim() || 'default',
        docId,
        relevant,
        timestamp: ts,
      });
      // Also persist implicit negatives
      if (relevant && currentResultDocIds) {
        for (const otherId of currentResultDocIds) {
          if (otherId !== docId) {
            void saveRelevanceFeedback({
              query: query.trim() || 'default',
              docId: otherId,
              relevant: false,
              timestamp: ts,
            });
          }
        }
      }
    },
    [query]
  );

  const clearFeedback = useCallback(() => {
    setFeedback(new Map());
    void clearRelevanceFeedback();
  }, []);

  return {
    results,
    query,
    setQuery,
    mode,
    setMode,
    feedbackModel,
    setFeedbackModel,
    submitFeedback,
    clearFeedback,
    hasFeedback: feedback.size > 0,
    relevantDocs,
    nonRelevantDocs,
  };
}

export function buildReformulatedQuery(
  query: string,
  relevantDocs: { docId: string; vector: Map<string, number> }[],
  nonRelevantDocs: { docId: string; vector: Map<string, number> }[],
  model: FeedbackModel = 'rocchio'
): string {
  const docById = new Map([...relevantDocs, ...nonRelevantDocs].map((doc) => [doc.docId, doc]));
  const relevantVectors = relevantDocs.map((doc) => docById.get(doc.docId)!);
  const nonRelevantVectors = nonRelevantDocs.map((doc) => docById.get(doc.docId)!);

  switch (model) {
    case 'ide_regular':
      return ideRegular(query, relevantVectors, nonRelevantVectors, 0.75, 0.25, 10).reformulatedQuery;
    case 'ide_dec_hi':
      return ideDecHi(query, relevantVectors, nonRelevantVectors, 0.75, 0.25, 10).reformulatedQuery;
    case 'rocchio':
    default:
      return rocchioAlgorithm(query, relevantVectors, nonRelevantVectors, 1, 0.75, 0.25, 10).reformulatedQuery;
  }
}

export function searchDocuments(
  documents: SearchDocument[],
  query: string,
  mode: SearchMode = 'hybrid'
): RankedSearchResult[] {
  if (!query.trim()) return [];
  const trimmedQuery = query.trim();

  const builder = new InvertedIndexBuilder();
  for (const doc of documents) {
    builder.indexDocument(doc.id, doc.text, false);
  }
  const invertedIndex = builder.getIndex();
  const booleanModel = new BooleanModel(invertedIndex);
  const vsmDocs = documents.map((doc) => ({ id: doc.id, text: doc.text }));
  const vsm = new VectorSpaceModel(vsmDocs);

  const matchedScores = new Map<string, number>();
  const matchedTerms = new Map<string, string[]>();

  if (mode === 'boolean') {
    try {
      const matched = booleanModel.evaluate(trimmedQuery);
      const scores = new Map<string, number>();
      for (const docId of matched) {
        scores.set(docId, 1);
      }
      const ranked = booleanModel.evaluateTermFrequency(trimmedQuery, documents.length);
      const freqMap = new Map(ranked.map((item) => [item.docId, item.score]));
      for (const [docId, freq] of freqMap) {
        if (scores.has(docId)) {
          scores.set(docId, 1 + freq / 100);
        }
      }
      return toRankedResults(documents, scores);
    } catch {
      return [];
    }
  }

  if (mode === 'vsm') {
    const ranked = vsm.search(trimmedQuery, documents.length);
    const scores = new Map(ranked.map((item) => [item.docId, item.score]));
    return toRankedResults(documents, scores);
  }

  const patternTypes: SearchMode[] = ['exact', 'prefix', 'suffix', 'substring', 'fuzzy'];

  if (mode === 'hybrid') {
    for (const patternType of patternTypes) {
      const matchResult = runPatternSearch(documents, trimmedQuery, patternType);
      for (const match of matchResult.matches) {
        const current = matchedScores.get(match.docId) ?? 0;
        matchedScores.set(match.docId, current + (patternType === 'fuzzy' ? 0.5 : 1));
        if (!matchedTerms.has(match.docId)) {
          matchedTerms.set(match.docId, []);
        }
        matchedTerms.get(match.docId)!.push(match.matchedText);
      }
    }

    const vsmScores = vsm.search(trimmedQuery, documents.length);
    for (const item of vsmScores) {
      matchedScores.set(item.docId, (matchedScores.get(item.docId) ?? 0) + item.score);
    }

    return toRankedResults(documents, matchedScores, matchedTerms);
  }

  const matchResult = runPatternSearch(documents, trimmedQuery, mode);
  for (const match of matchResult.matches) {
    matchedScores.set(match.docId, 1);
    if (!matchedTerms.has(match.docId)) {
      matchedTerms.set(match.docId, []);
    }
    matchedTerms.get(match.docId)!.push(match.matchedText);
  }

  return toRankedResults(documents, matchedScores, matchedTerms);
}
