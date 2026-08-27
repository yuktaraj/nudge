import AsyncStorage from '@react-native-async-storage/async-storage';

import { getRetrievability, interleaveReviewQueue, type ReviewCard } from '@/lib/spaced-repetition';

export type ExamPlan = {
  course: string;
  examDate: string;
  targetRecall: number;
};

const examPlanKey = 'nudge.examPlan';

export function getExamDaysRemaining(plan: ExamPlan | null, now = new Date()) {
  if (!plan) return null;
  const examTime = /^\d{4}-\d{2}-\d{2}$/.test(plan.examDate)
    ? new Date(`${plan.examDate}T23:59:59`).getTime()
    : new Date(plan.examDate).getTime();
  if (Number.isNaN(examTime)) return null;

  const days = Math.ceil((examTime - now.getTime()) / 86_400_000);
  return days >= 0 && days <= 7 ? days : null;
}

export function isExamProximityActive(plan: ExamPlan | null, now = new Date()) {
  return getExamDaysRemaining(plan, now) !== null;
}

export function getSubjectRecall(cards: ReviewCard[], course: string, now = new Date()) {
  const subjectCards = cards.filter((card) => card.course === course);
  return subjectCards.reduce((sum, card) => sum + getRetrievability(card, now), 0) / Math.max(subjectCards.length, 1);
}

export function buildExamProximityQueue(
  cards: ReviewCard[],
  plan: ExamPlan,
  now = new Date(),
  maxTasks = 4
) {
  const courseCards = cards.filter((card) => card.course === plan.course);
  const currentRecall = getSubjectRecall(cards, plan.course, now);
  const targetRecall = plan.targetRecall ?? 0.9;
  const intensity = currentRecall < targetRecall ? Math.min(8, 4 + Math.ceil((targetRecall - currentRecall) * 20)) : 4;
  const mixedCards = interleaveReviewQueue(courseCards, now);
  const highYieldCards = [...mixedCards].sort((first, second) => {
    const difficultyDelta = second.difficulty - first.difficulty;
    if (difficultyDelta !== 0) return difficultyDelta;
    return getRetrievability(first, now) - getRetrievability(second, now);
  });
  const reviewed = highYieldCards.filter((card) => card.reviewHistory.length > 0);
  const newCards = highYieldCards.filter((card) => card.reviewHistory.length === 0);
  return [...reviewed, ...newCards.slice(0, 1)].slice(0, Math.max(1, Math.max(maxTasks, intensity)));
}

export function buildCombinedExamQueue(
  cards: ReviewCard[],
  plans: ExamPlan[],
  now = new Date(),
  maxTasks = 8
) {
  const activePlans = plans.filter((plan) => getExamDaysRemaining(plan, now) !== null);
  const queues = activePlans.map((plan) => buildExamProximityQueue(cards, plan, now, maxTasks));
  const selected: ReviewCard[] = [];

  queues.forEach((queue) => {
    const firstCard = queue.find((card) => !selected.some((selectedCard) => selectedCard.id === card.id));
    if (firstCard) selected.push(firstCard);
  });

  const remaining = queues
    .flat()
    .filter((card) => !selected.some((selectedCard) => selectedCard.id === card.id))
    .sort((first, second) => getRetrievability(first, now) - getRetrievability(second, now));

  return [...selected, ...remaining].slice(0, Math.max(1, maxTasks));
}

export async function loadExamPlan(): Promise<ExamPlan | null> {
  const plans = await loadExamPlans();
  return plans.sort((first, second) => getExamSortTime(first) - getExamSortTime(second))[0] ?? null;
}

function getExamSortTime(plan: ExamPlan) {
  return /^\d{4}-\d{2}-\d{2}$/.test(plan.examDate)
    ? new Date(`${plan.examDate}T23:59:59`).getTime()
    : new Date(plan.examDate).getTime();
}

export async function loadExamPlans(): Promise<ExamPlan[]> {
  try {
    const stored = await AsyncStorage.getItem(examPlanKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Partial<ExamPlan> | Array<Partial<ExamPlan>>;
    const plans = Array.isArray(parsed) ? parsed : [parsed];
    return plans.filter((plan): plan is Partial<ExamPlan> & Pick<ExamPlan, 'course' | 'examDate'> => Boolean(plan.course && plan.examDate)).map((plan) => ({
      course: plan.course,
      examDate: plan.examDate.slice(0, 10),
      targetRecall: plan.targetRecall ?? 0.9,
    }));
  } catch {
    return [];
  }
}

export async function saveExamPlan(plan: ExamPlan | null) {
  if (!plan) {
    return;
  }
  const plans = await loadExamPlans();
  const nextPlans = [
    ...plans.filter((savedPlan) => savedPlan.course !== plan.course),
    plan,
  ];
  await AsyncStorage.setItem(examPlanKey, JSON.stringify(nextPlans));
}

export async function deleteExamPlan(plan: ExamPlan) {
  const plans = await loadExamPlans();
  const nextPlans = plans.filter(
    (savedPlan) => savedPlan.course !== plan.course || savedPlan.examDate !== plan.examDate
  );
  if (nextPlans.length === 0) {
    await AsyncStorage.removeItem(examPlanKey);
    return;
  }
  await AsyncStorage.setItem(examPlanKey, JSON.stringify(nextPlans));
}