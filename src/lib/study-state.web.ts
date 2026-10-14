import type { ReviewCard } from '@/lib/spaced-repetition';
import type { FocusSessionRecord, PersistedStudyState, RelevanceFeedbackRecord } from '@/types/study-state';

const reviewCardsKey = 'nudge.reviewCards';
const sessionsKey = 'nudge.focusSessions';
const relevanceFeedbackKey = 'nudge.relevanceFeedback';
let memoryState: PersistedStudyState = {
  reviewCards: [],
  sessions: [],
  relevanceFeedback: [],
};
let activeStateUser = '';

/**
 * Scope review cards and focus sessions to one account. Storage keys are
 * namespaced per user; legacy unscoped data is ignored.
 */
export function setStudyStateUser(userId: string) {
  if (activeStateUser === userId) return;
  activeStateUser = userId;
  memoryState = { reviewCards: [], sessions: [], relevanceFeedback: [] };
}

function scopedKey(key: string) {
  return `${key}:${activeStateUser || 'anonymous'}`;
}

function canUseStorage() {
  return typeof localStorage !== 'undefined';
}

function readStorage<T>(key: string): T[] {
  if (!canUseStorage()) return [];

  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function writeStorage<T>(key: string, values: T[]) {
  if (canUseStorage()) {
    localStorage.setItem(key, JSON.stringify(values));
  }
}

export async function saveReviewCards(cards: ReviewCard[]) {
  memoryState = { ...memoryState, reviewCards: cards };
  writeStorage(scopedKey(reviewCardsKey), cards);
}

export async function loadReviewCards(): Promise<ReviewCard[]> {
  const stored = readStorage<ReviewCard>(scopedKey(reviewCardsKey));
  return stored.length > 0 ? stored : memoryState.reviewCards;
}

export async function saveFocusSession(session: FocusSessionRecord) {
  const sessions = [session, ...readStorage<FocusSessionRecord>(scopedKey(sessionsKey))].slice(0, 100);
  memoryState = { ...memoryState, sessions };
  writeStorage(scopedKey(sessionsKey), sessions);
}

export async function loadFocusSessions(): Promise<FocusSessionRecord[]> {
  const stored = readStorage<FocusSessionRecord>(scopedKey(sessionsKey));
  return stored.length > 0 ? stored : memoryState.sessions;
}

export async function saveRelevanceFeedback(record: RelevanceFeedbackRecord) {
  const id = record.id ?? `${record.query}:${record.docId}:${Date.now()}`;
  const feedbackItem: RelevanceFeedbackRecord = { ...record, id };
  const current = readStorage<RelevanceFeedbackRecord>(scopedKey(relevanceFeedbackKey));
  const feedback = [feedbackItem, ...current.filter((item) => item.id !== id)].slice(0, 500);
  memoryState = { ...memoryState, relevanceFeedback: feedback };
  writeStorage(scopedKey(relevanceFeedbackKey), feedback);
}

export async function loadRelevanceFeedback(): Promise<RelevanceFeedbackRecord[]> {
  const stored = readStorage<RelevanceFeedbackRecord>(scopedKey(relevanceFeedbackKey));
  return stored.length > 0 ? stored : (memoryState.relevanceFeedback ?? []);
}

export async function clearRelevanceFeedback(): Promise<void> {
  memoryState = { ...memoryState, relevanceFeedback: [] };
  if (canUseStorage()) {
    localStorage.removeItem(scopedKey(relevanceFeedbackKey));
  }
}

export async function loadStudyState(): Promise<PersistedStudyState> {
  const [reviewCards, sessions, relevanceFeedback] = await Promise.all([
    loadReviewCards(),
    loadFocusSessions(),
    loadRelevanceFeedback(),
  ]);
  return { reviewCards, sessions, relevanceFeedback };
}
