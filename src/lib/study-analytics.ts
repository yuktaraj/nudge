import {
    getDueState,
    getRetrievability,
    type ReviewCard,
} from '@/lib/spaced-repetition';
import type { FocusSessionRecord } from '@/types/study-state';

const dayMs = 86_400_000;

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * dayMs);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function calculateAverageRecall(cards: ReviewCard[], now = new Date()) {
  if (cards.length === 0) return 0;

  return cards.reduce((sum, card) => sum + getRetrievability(card, now), 0) / cards.length;
}

export function calculateCourseRecall(cards: ReviewCard[], course: string, now = new Date()) {
  return calculateAverageRecall(cards.filter((card) => card.course === course), now);
}

export function calculateAverageDifficulty(cards: ReviewCard[]) {
  if (cards.length === 0) return 0;

  return cards.reduce((sum, card) => sum + card.difficulty, 0) / cards.length;
}

export function calculateDashboardReviewMetrics(cards: ReviewCard[], now = new Date()) {
  const averageRecall = calculateAverageRecall(cards, now);
  const averageDifficulty = calculateAverageDifficulty(cards);
  const dueCount = cards.filter((card) => getDueState(card, now)).length;
  const lowRecallRisk = (1 - averageRecall) * 55;
  const overdueRisk = Math.min(dueCount * 8, 30);
  const difficultyRisk = averageDifficulty * 1.5;
  const riskToday = cards.length === 0
    ? 0
    : clamp(Math.round(lowRecallRisk + overdueRisk + difficultyRisk), 0, 100);

  return {
    averageDifficulty,
    averageRecall,
    dueCount,
    riskToday,
  };
}

function topicMasteryScore(cards: ReviewCard[], now: Date) {
  const averageRecall = calculateAverageRecall(cards, now);
  const averageDifficulty = calculateAverageDifficulty(cards);
  const averageStability = cards.reduce((sum, card) => sum + Math.min(card.stability, 30) / 30, 0) / Math.max(cards.length, 1);

  return clamp(Math.round(averageRecall * 68 + averageStability * 20 + (1 - averageDifficulty / 10) * 12), 1, 99);
}

export function buildRetentionCurve(cards: ReviewCard[], now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(now, index);
    const recall =
      cards.reduce((sum, card) => sum + getRetrievability(card, date), 0) / Math.max(cards.length, 1);

    return {
      label: index === 0 ? 'Today' : `D+${index}`,
      value: Math.round(recall * 100),
    };
  });
}

export function buildMasteryByTopic(cards: ReviewCard[], now = new Date()) {
  const topics = new Map<string, ReviewCard[]>();

  for (const card of cards) {
    topics.set(card.topic, [...(topics.get(card.topic) ?? []), card]);
  }

  return [...topics.entries()]
    .map(([topic, topicCards]) => ({
      cards: topicCards.length,
      topic,
      value: topicMasteryScore(topicCards, now),
    }))
    .sort((first, second) => second.value - first.value);
}

export function detectWeakTopics(cards: ReviewCard[], now = new Date()) {
  return buildMasteryByTopic(cards, now)
    .map((topic) => {
      const topicCards = cards.filter((card) => card.topic === topic.topic);
      const overdue = topicCards.filter((card) => new Date(card.dueAt).getTime() <= now.getTime()).length;
      const averageDifficulty = calculateAverageDifficulty(topicCards);

      return {
        ...topic,
        averageDifficulty,
        overdue,
        risk: Math.round((100 - topic.value) * 0.65 + overdue * 12 + averageDifficulty * 2.5),
      };
    })
    .sort((first, second) => second.risk - first.risk)
    .slice(0, 4);
}

export type ProgressMilestone = {
  masteredTopics: number;
  nextMilestone: number | null;
  percentage: number;
  totalTopics: number;
  course: string;
};

export function buildProgressMilestones(
  cards: ReviewCard[],
  now = new Date(),
  masteryTarget = 80
): ProgressMilestone[] {
  const byCourse = new Map<string, ReviewCard[]>();

  for (const card of cards) {
    byCourse.set(card.course, [...(byCourse.get(card.course) ?? []), card]);
  }

  return [...byCourse.entries()]
    .map(([course, courseCards]) => {
      const topics = buildMasteryByTopic(courseCards, now);
      const masteredTopics = topics.filter((topic) => topic.value >= masteryTarget).length;
      const totalTopics = topics.length;
      const nextMilestone = masteredTopics < totalTopics ? Math.min(totalTopics, masteredTopics + 1) : null;

      return {
        course,
        masteredTopics,
        nextMilestone,
        percentage: totalTopics === 0 ? 0 : Math.round((masteredTopics / totalTopics) * 100),
        totalTopics,
      };
    })
    .sort((first, second) => second.percentage - first.percentage);
}

export function buildReviewLoad(cards: ReviewCard[], now = new Date()) {
  const todayEnd = addDays(startOfDay(now), 1);
  const tomorrowEnd = addDays(startOfDay(now), 2);
  const weekEnd = addDays(startOfDay(now), 7);

  return {
    today: cards.filter((card) => new Date(card.dueAt).getTime() <= todayEnd.getTime()).length,
    tomorrow: cards.filter((card) => {
      const due = new Date(card.dueAt).getTime();
      return due > todayEnd.getTime() && due <= tomorrowEnd.getTime();
    }).length,
    week: cards.filter((card) => {
      const due = new Date(card.dueAt).getTime();
      return due > tomorrowEnd.getTime() && due <= weekEnd.getTime();
    }).length,
  };
}

export function buildSessionConsistency(sessions: FocusSessionRecord[], now = new Date()) {
  const studySessions = sessions.filter((session) => session.phase === 'study');
  const today = startOfDay(now);
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => addDays(today, -index));
  const minutesByDate = new Map<string, number>();

  for (const session of studySessions) {
    const date = startOfDay(new Date(session.completedAt));
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString();
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + session.minutes);
  }

  const days = lastSevenDays.reverse().map((date) => {
    const key = date.toISOString();
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
      minutes: minutesByDate.get(key) ?? 0,
    };
  });
  const activeDays = days.filter((day) => day.minutes > 0).length;
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);

  return {
    activeDays,
    averageMinutes: activeDays === 0 ? 0 : Math.round(totalMinutes / activeDays),
    days,
    totalMinutes,
  };
}

export function getStudyStreak(sessions: FocusSessionRecord[], now = new Date()) {
  const studyDays = new Set(
    sessions
      .filter((session) => session.phase === 'study')
      .map((session) => startOfDay(new Date(session.completedAt)).toISOString())
  );
  let streak = 0;
  let cursor = startOfDay(now);

  while (studyDays.has(cursor.toISOString())) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

export type StudyRhythm = {
  endHour: number;
  label: string;
  percentage: number;
  sessionCount: number;
  startHour: number;
};

function formatHour(hour: number) {
  const date = new Date(2020, 0, 1, hour);
  return date.toLocaleTimeString(undefined, { hour: 'numeric' });
}

function formatWindow(startHour: number) {
  const endHour = (startHour + 2) % 24;
  return `${formatHour(startHour)}-${formatHour(endHour)}`;
}

export function detectStudyRhythm(sessions: FocusSessionRecord[]): StudyRhythm | null {
  const studySessions = sessions.filter((session) => {
    const date = new Date(session.completedAt);
    return session.phase === 'study' && !Number.isNaN(date.getTime());
  });
  if (studySessions.length === 0) return null;

  const counts = new Map<number, number>();
  for (const session of studySessions) {
    const hour = new Date(session.completedAt).getHours();
    const startHour = Math.floor(hour / 2) * 2;
    counts.set(startHour, (counts.get(startHour) ?? 0) + 1);
  }

  const [startHour, sessionCount] = [...counts.entries()].sort((first, second) => second[1] - first[1])[0];
  return {
    endHour: (startHour + 2) % 24,
    label: formatWindow(startHour),
    percentage: Math.round((sessionCount / studySessions.length) * 100),
    sessionCount,
    startHour,
  };
}

export function nextStudyRhythmWindow(rhythm: StudyRhythm | null, now = new Date()) {
  if (!rhythm) return null;
  const next = new Date(now);
  next.setHours(rhythm.startHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}
