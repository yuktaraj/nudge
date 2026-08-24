import type { ReviewCard } from '@/lib/spaced-repetition';

export type FocusSessionRecord = {
  completedAt: string;
  id: number;
  minutes: number;
  mode: string;
  note?: string;
  phase: 'study' | 'break';
};

export type PersistedStudyState = {
  examDate?: string;
  importantTopics: string[];
  masteryThresholds: Record<string, number>;
  reviewCards: ReviewCard[];
  sessions: FocusSessionRecord[];
};
