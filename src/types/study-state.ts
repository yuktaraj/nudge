import type { ReviewCard } from '@/lib/spaced-repetition';

export type FocusSessionRecord = {
  completedAt: string;
  id: number;
  minutes: number;
  mode: string;
  note?: string;
  phase: 'study' | 'break';
};

export type RelevanceFeedbackRecord = {
  id?: string;
  query: string;
  docId: string;
  relevant: boolean;
  timestamp: string;
};

export type PersistedStudyState = {
  reviewCards: ReviewCard[];
  sessions: FocusSessionRecord[];
  relevanceFeedback?: RelevanceFeedbackRecord[];
};
