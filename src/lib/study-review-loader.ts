import { buildReviewCardsFromGeneratedAssets, mergeReviewCardsWithGeneratedCards } from '@/lib/generated-review-cards';
import { hasSupabaseConfig } from '@/lib/env';
import { listCachedAssets, listCachedSources } from '@/lib/parsing/cache';
import { refreshParsingState } from '@/lib/parsing/pipeline';
import type { ReviewCard } from '@/lib/spaced-repetition';
import { loadFocusSessions, loadReviewCards, saveReviewCards } from '@/lib/study-state';
import type { GeneratedAssetRecord, SourceRecord } from '@/types/parsing';
import type { FocusSessionRecord } from '@/types/study-state';

const legacyDemoIds = new Set([
  'bio-neurotransmitter-release',
  'psych-chunking',
  'calc-chain-rule',
  'history-primary-source-bias',
  'bio-ltp',
  'psych-retrieval-practice',
]);

const legacyDemoCourses = new Set([
  'Biology 204',
  'Psychology 210',
  'Calculus I',
  'Modern History',
]);

export function removeLegacyDemoReviewCards(cards: ReviewCard[]) {
  return cards.filter((card) => !legacyDemoIds.has(card.id) && !legacyDemoCourses.has(card.course));
}

async function loadSourcesAndAssets() {
  const [cachedSources, cachedAssets] = await Promise.all([
    listCachedSources(),
    listCachedAssets(),
  ]);

  if (!hasSupabaseConfig()) {
    return {
      assets: cachedAssets,
      sources: cachedSources,
    };
  }

  try {
    const remote = await refreshParsingState();
    return remote;
  } catch {
    return {
      assets: cachedAssets,
      sources: cachedSources,
    };
  }
}

export type StudyReviewState = {
  assets: GeneratedAssetRecord[];
  reviewCards: ReviewCard[];
  sessions: FocusSessionRecord[];
  sources: SourceRecord[];
};

export async function loadStudyReviewState(): Promise<StudyReviewState> {
  const [{ assets, sources }, savedCards, sessions] = await Promise.all([
    loadSourcesAndAssets(),
    loadReviewCards(),
    loadFocusSessions(),
  ]);
  const cleanedSavedCards = removeLegacyDemoReviewCards(savedCards);
  const generatedCards = buildReviewCardsFromGeneratedAssets(assets, sources);
  const reviewCards = mergeReviewCardsWithGeneratedCards(cleanedSavedCards, generatedCards);

  if (
    savedCards.length !== cleanedSavedCards.length ||
    (cleanedSavedCards.length === 0 && reviewCards.length > 0)
  ) {
    await saveReviewCards(reviewCards);
  }

  return {
    assets,
    reviewCards,
    sessions,
    sources,
  };
}
