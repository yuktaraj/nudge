import type { ReviewCard } from '@/lib/spaced-repetition';
import type { FocusSessionRecord, PersistedStudyState } from '@/types/study-state';

const reviewCardsKey = 'nudge.reviewCards';
const sessionsKey = 'nudge.focusSessions';
const examDateKey = 'nudge.examDate';
const masteryThresholdsKey = 'nudge.masteryThresholds';
const importantTopicsKey = 'nudge.importantTopics';
let memoryState: PersistedStudyState = {
  importantTopics: [],
  masteryThresholds: {},
  reviewCards: [],
  sessions: [],
};

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
  writeStorage(reviewCardsKey, cards);
}

export async function loadReviewCards(): Promise<ReviewCard[]> {
  const stored = readStorage<ReviewCard>(reviewCardsKey);
  return stored.length > 0 ? stored : memoryState.reviewCards;
}

export async function saveFocusSession(session: FocusSessionRecord) {
  const sessions = [session, ...readStorage<FocusSessionRecord>(sessionsKey)].slice(0, 100);
  memoryState = { ...memoryState, sessions };
  writeStorage(sessionsKey, sessions);
}

export async function loadFocusSessions(): Promise<FocusSessionRecord[]> {
  const stored = readStorage<FocusSessionRecord>(sessionsKey);
  return stored.length > 0 ? stored : memoryState.sessions;
}

export async function saveExamDate(examDate?: string) {
  memoryState = { ...memoryState, examDate };
  if (canUseStorage()) {
    if (examDate) localStorage.setItem(examDateKey, examDate);
    else localStorage.removeItem(examDateKey);
  }
}

export async function loadExamDate(): Promise<string | undefined> {
  if (!canUseStorage()) return memoryState.examDate;
  return localStorage.getItem(examDateKey) ?? undefined;
}

export async function saveMasteryThresholds(masteryThresholds: Record<string, number>) {
  memoryState = { ...memoryState, masteryThresholds };
  if (canUseStorage()) localStorage.setItem(masteryThresholdsKey, JSON.stringify(masteryThresholds));
}

export async function loadMasteryThresholds(): Promise<Record<string, number>> {
  if (!canUseStorage()) return memoryState.masteryThresholds;
  try {
    return JSON.parse(localStorage.getItem(masteryThresholdsKey) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export async function saveImportantTopics(importantTopics: string[]) {
  memoryState = { ...memoryState, importantTopics };
  if (canUseStorage()) localStorage.setItem(importantTopicsKey, JSON.stringify(importantTopics));
}

export async function loadImportantTopics(): Promise<string[]> {
  if (!canUseStorage()) return memoryState.importantTopics;
  try {
    return JSON.parse(localStorage.getItem(importantTopicsKey) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export async function loadStudyState(): Promise<PersistedStudyState> {
  const [reviewCards, sessions, examDate, masteryThresholds, importantTopics] = await Promise.all([
    loadReviewCards(),
    loadFocusSessions(),
    loadExamDate(),
    loadMasteryThresholds(),
    loadImportantTopics(),
  ]);
  return { examDate, importantTopics, masteryThresholds, reviewCards, sessions };
}
