import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionButton, SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildCombinedExamQueue, getExamDaysRemaining, loadExamPlans, type ExamPlan } from '@/lib/exam-proximity';
import {
    buildDailyReviewQueue,
    formatDueDate,
    getElapsedDays,
    getRetrievability,
    recallGrades,
    reviewCard,
    studyAreaKey,
    type RecallGrade,
    type ReviewCard,
} from '@/lib/spaced-repetition';
import { loadStudyReviewState } from '@/lib/study-review-loader';
import { saveReviewCards } from '@/lib/study-state';

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDays(value: number) {
  if (value < 1) return `${Math.max(1, Math.round(value * 24))}h`;
  return `${value.toFixed(1)}d`;
}

function gradeColor(grade: RecallGrade, theme: ReturnType<typeof useTheme>) {
  if (grade === 'again') return theme.error;
  if (grade === 'hard') return theme.warning;
  if (grade === 'good') return theme.brandMint;
  return theme.brandLavender;
}

export default function ReviewsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [activeCardId, setActiveCardId] = useState('');
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [lastReviewed, setLastReviewed] = useState<ReviewCard | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [reviewedAreas, setReviewedAreas] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [examPlans, setExamPlans] = useState<ExamPlan[]>([]);
  const now = useMemo(() => new Date(), [cards]);
  const activeExamPlans = examPlans.filter((plan) => getExamDaysRemaining(plan, now) !== null);
  const examDaysRemaining = activeExamPlans.length > 0 ? Math.min(...activeExamPlans.map((plan) => getExamDaysRemaining(plan, now) ?? 7)) : null;
  const queue = useMemo(
    () => activeExamPlans.length > 0
      ? buildCombinedExamQueue(cards, activeExamPlans, now)
      : buildDailyReviewQueue(cards, now),
    [activeExamPlans, cards, now]
  );
  const activeCard = cards.find((card) => card.id === activeCardId) ?? queue[0];
  const activeRetrievability = activeCard ? getRetrievability(activeCard, now) : 0;
  const dueCount = cards.filter((card) => new Date(card.dueAt).getTime() <= now.getTime()).length;
  const averageRecall =
    cards.reduce((sum, card) => sum + getRetrievability(card, now), 0) / Math.max(cards.length, 1);

  useEffect(() => {
    let isMounted = true;

    loadStudyReviewState().then(({ reviewCards: nextCards }) => {
      if (!isMounted) return;
      setCards(nextCards);
      setActiveCardId((current) => nextCards.find((card) => card.id === current)?.id ?? nextCards[0]?.id ?? '');
    });
    loadExamPlans().then((plans) => {
      if (isMounted) setExamPlans(plans);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function chooseCard(cardId: string) {
    setActiveCardId(cardId);
    setIsAnswerVisible(false);
  }

  function gradeActiveCard(grade: RecallGrade) {
    if (!activeCard) return;

    // The day's target is the number of distinct study areas in the mixed queue (4-6).
    const target = Math.max(1, queue.length);
    const nextReviewedCount = reviewedCount + 1;
    const nextReviewedAreas = [...new Set([...reviewedAreas, studyAreaKey(activeCard)])];
    const reviewedCard = reviewCard(activeCard, grade, new Date());
    const nextCards = cards.map((card) => (card.id === reviewedCard.id ? reviewedCard : card));
    setCards(nextCards);
    saveReviewCards(nextCards);
    setLastReviewed(reviewedCard);
    setReviewedCount(nextReviewedCount);
    setReviewedAreas(nextReviewedAreas);
    setIsAnswerVisible(false);

    if (nextReviewedCount >= target) {
      setIsComplete(true);
      return;
    }

    // Move to the next study area we haven't covered yet — keeps the session mix repeat-free.
    const nextActivePlans = activeExamPlans.filter((plan) => getExamDaysRemaining(plan, new Date()) !== null);
    const nextQueue = nextActivePlans.length > 0
      ? buildCombinedExamQueue(nextCards, nextActivePlans, new Date())
      : buildDailyReviewQueue(nextCards, new Date());
    const nextCard = nextQueue.find(
      (card) => !nextReviewedAreas.includes(studyAreaKey(card))
    );
    if (nextCard) {
      setActiveCardId(nextCard.id);
    } else {
      setIsComplete(true);
    }
  }

  function restartReview() {
    const nextQueue = activeExamPlans.length > 0
      ? buildCombinedExamQueue(cards, activeExamPlans, new Date())
      : buildDailyReviewQueue(cards, new Date());
    setReviewedCount(0);
    setReviewedAreas([]);
    setIsComplete(false);
    setIsAnswerVisible(false);
    setActiveCardId(nextQueue[0]?.id ?? cards[0]?.id ?? '');
  }

  if (isComplete) {
    return (
      <StudyScreen
        eyebrow="Review"
        title="Session complete"
        subtitle="Nice work. Your schedule has been updated from today’s recall grades.">
        <StudyCard style={styles.completeCard}>
          <View style={[styles.trophyMark, { backgroundColor: theme.brandMint }]}>
            <ThemedText type="metric" style={{ color: '#0F172A' }}>
              {reviewedCount}
            </ThemedText>
          </View>
          <ThemedText type="subtitle">Cards reviewed</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Average recall is now {percent(averageRecall)}. Keep the next session short and mixed.
          </ThemedText>
          <View style={styles.completeStats}>
            <ThemedView type="backgroundElement" style={styles.completeStat}>
              <ThemedText type="caption" themeColor="textSecondary">Recall</ThemedText>
              <ThemedText type="smallBold">{percent(averageRecall)}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.completeStat}>
              <ThemedText type="caption" themeColor="textSecondary">Topics</ThemedText>
              <ThemedText type="smallBold">{new Set(cards.map((card) => card.topic)).size}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.completeStat}>
              <ThemedText type="caption" themeColor="textSecondary">Due left</ThemedText>
              <ThemedText type="smallBold">{dueCount}</ThemedText>
            </ThemedView>
          </View>
          <View style={styles.gradeGrid}>
            <ActionButton label="Study more" onPress={restartReview} />
            <ActionButton label="Dashboard" variant="secondary" onPress={() => router.push('/')} />
          </View>
        </StudyCard>
      </StudyScreen>
    );
  }

  if (!activeCard) {
    return (
      <StudyScreen
        eyebrow="Review"
        title="No review cards yet"
        subtitle="Once your PDFs finish processing, Nudge will turn their flashcards into your review queue.">
        <StudyCard style={styles.emptyHistory}>
          <ThemedText type="sectionTitle">Nothing due right now</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add or seed study materials, then open Study tools after the AI pack is ready.
          </ThemedText>
          <View style={styles.gradeGrid}>
            <ActionButton label="Add material" onPress={() => router.push('/library')} />
            <ActionButton label="Study tools" variant="secondary" onPress={() => router.push('/assets')} />
          </View>
        </StudyCard>
      </StudyScreen>
    );
  }

  return (
    <StudyScreen
      eyebrow="Review"
      title="Practice active recall"
      subtitle="Try to answer first, reveal the answer, then grade how it felt.">
      <View style={styles.summaryGrid}>
        <StudyCard style={[styles.summaryCard, { backgroundColor: 'rgba(184, 164, 237, 0.18)' }]}>
          <ThemedText type="caption">Due now</ThemedText>
          <ThemedText type="metric">{dueCount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            cards need attention
          </ThemedText>
        </StudyCard>
        <StudyCard style={[styles.summaryCard, { backgroundColor: 'rgba(164, 212, 197, 0.24)' }]}>
          <ThemedText type="caption">Recall</ThemedText>
          <ThemedText type="metric">{percent(averageRecall)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            average right now
          </ThemedText>
        </StudyCard>
        <StudyCard style={[styles.summaryCard, { backgroundColor: 'rgba(232, 185, 74, 0.18)' }]}>
          <ThemedText type="caption">Mix</ThemedText>
          <ThemedText type="metric">{new Set(queue.map((card) => card.course)).size}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            subjects interleaved
          </ThemedText>
        </StudyCard>
      </View>

      {activeCard ? (
        <View style={styles.reviewGrid}>
          <StudyCard style={styles.activeCard}>
            <View style={styles.cardHeader}>
              <View style={styles.flexCopy}>
                <ThemedText type="caption" themeColor="textSecondary">
                  {activeCard.course}
                </ThemedText>
                <ThemedText type="subtitle">{activeCard.prompt}</ThemedText>
              </View>
              <ThemedView type="backgroundSelected" style={styles.topicPill}>
                <ThemedText type="smallBold">{activeCard.topic}</ThemedText>
              </ThemedView>
            </View>

            <View style={styles.metricStrip}>
              <ThemedView type="backgroundElement" style={styles.metricPill}>
                <ThemedText type="caption" themeColor="textSecondary">
                  Recall
                </ThemedText>
                <ThemedText type="smallBold">{percent(activeRetrievability)}</ThemedText>
              </ThemedView>
              <ThemedView type="backgroundElement" style={styles.metricPill}>
                <ThemedText type="caption" themeColor="textSecondary">
                  Stability
                </ThemedText>
                <ThemedText type="smallBold">{formatDays(activeCard.stability)}</ThemedText>
              </ThemedView>
              <ThemedView type="backgroundElement" style={styles.metricPill}>
                <ThemedText type="caption" themeColor="textSecondary">
                  Difficulty
                </ThemedText>
                <ThemedText type="smallBold">{activeCard.difficulty.toFixed(1)}/10</ThemedText>
              </ThemedView>
              <ThemedView type="backgroundElement" style={styles.metricPill}>
                <ThemedText type="caption" themeColor="textSecondary">
                  Seen
                </ThemedText>
                <ThemedText type="smallBold">{formatDays(getElapsedDays(activeCard, now))} ago</ThemedText>
              </ThemedView>
            </View>

            <ThemedView type="backgroundElement" style={styles.answerPanel}>
              <ThemedText type="caption" themeColor="textSecondary">
                {isAnswerVisible ? 'Answer' : 'Active recall'}
              </ThemedText>
              <ThemedText type="sectionTitle">
                {isAnswerVisible
                  ? activeCard.answer
                  : 'Say the answer out loud or write it down before revealing.'}
              </ThemedText>
            </ThemedView>

            {!isAnswerVisible ? (
              <ActionButton label="Reveal answer" onPress={() => setIsAnswerVisible(true)} />
            ) : (
              <View style={styles.gradeGrid}>
                {recallGrades.map((grade) => (
                  <Pressable
                    key={grade.id}
                    onPress={() => gradeActiveCard(grade.id)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      style={[
                        styles.gradeButton,
                        {
                          backgroundColor: gradeColor(grade.id, theme),
                          borderColor: gradeColor(grade.id, theme),
                        },
                      ]}>
                      <ThemedText type="smallBold" style={{ color: '#0F172A' }}>
                        {grade.label}
                      </ThemedText>
                      <ThemedText type="small" style={{ color: '#0F172A' }}>
                        {grade.score}/4
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </View>
            )}
          </StudyCard>

          <StudyCard style={styles.sidePanel}>
            <SectionHeader
              title={examDaysRemaining !== null ? 'Exam Proximity Queue' : 'Interleaved Queue'}
              detail={examDaysRemaining !== null
                ? 'Topics rotate by priority, with one new card maximum per session.'
                : '4-6 mixed topics today — no repeats.'}
            />
            {queue.map((card, index) => {
              const isActive = card.id === activeCard.id;
              const recall = getRetrievability(card, now);

              return (
                <Pressable
                  key={card.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Study ${card.topic} from ${card.course}`}
                  onPress={() => chooseCard(card.id)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={isActive ? 'backgroundSelected' : 'backgroundElement'}
                    style={[
                      styles.queueRow,
                      { borderColor: isActive ? theme.primary : theme.hairline },
                    ]}>
                    <View style={styles.queueIndex}>
                      <ThemedText type="smallBold">{index + 1}</ThemedText>
                    </View>
                    <View style={styles.flexCopy}>
                      <ThemedText type="smallBold">{card.topic}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {card.course} - {formatDueDate(card.dueAt, now)} - {percent(recall)}
                      </ThemedText>
                    </View>
                  </ThemedView>
                </Pressable>
              );
            })}
          </StudyCard>
        </View>
      ) : null}

      <StudyCard>
        <SectionHeader title="Latest Review" detail="How the schedule changed." />
        {lastReviewed?.reviewHistory[0] ? (
          <ThemedView type="backgroundElement" style={styles.historyPanel}>
            <View style={styles.historyItem}>
              <ThemedText type="caption" themeColor="textSecondary">
                Grade
              </ThemedText>
              <ThemedText type="smallBold">{lastReviewed.reviewHistory[0].grade}</ThemedText>
            </View>
            <View style={styles.historyItem}>
              <ThemedText type="caption" themeColor="textSecondary">
                Stability
              </ThemedText>
              <ThemedText type="smallBold">
                {lastReviewed.reviewHistory[0].stabilityBefore}d to{' '}
                {lastReviewed.reviewHistory[0].stabilityAfter}d
              </ThemedText>
            </View>
            <View style={styles.historyItem}>
              <ThemedText type="caption" themeColor="textSecondary">
                Difficulty
              </ThemedText>
              <ThemedText type="smallBold">
                {lastReviewed.reviewHistory[0].difficultyBefore} to{' '}
                {lastReviewed.reviewHistory[0].difficultyAfter}
              </ThemedText>
            </View>
            <View style={styles.historyItem}>
              <ThemedText type="caption" themeColor="textSecondary">
                Next due
              </ThemedText>
              <ThemedText type="smallBold">
                {formatDueDate(lastReviewed.reviewHistory[0].nextDueAt)}
              </ThemedText>
            </View>
          </ThemedView>
        ) : (
          <ThemedView type="backgroundElement" style={styles.emptyHistory}>
            <ThemedText type="smallBold">No review yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Reveal an answer and grade it to update the schedule.
            </ThemedText>
          </ThemedView>
        )}
      </StudyCard>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  summaryCard: {
    flexBasis: 180,
    flexGrow: 1,
    minWidth: 0,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  activeCard: {
    flexBasis: 320,
    flexGrow: 2,
    minWidth: 0,
  },
  sidePanel: {
    flexBasis: 280,
    flexGrow: 1,
    minWidth: 0,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  flexCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
  },
  topicPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  metricStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metricPill: {
    borderRadius: 18,
    borderCurve: 'continuous',
    flexBasis: 132,
    flexGrow: 1,
    gap: Spacing.half,
    padding: Spacing.four,
  },
  answerPanel: {
    borderRadius: 24,
    borderCurve: 'continuous',
    gap: Spacing.two,
    minHeight: 132,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  gradeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  gradeButton: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
    minWidth: 116,
    padding: Spacing.four,
  },
  pressed: {
    opacity: 0.72,
  },
  queueRow: {
    alignItems: 'center',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  queueIndex: {
    alignItems: 'center',
    backgroundColor: 'rgba(184, 164, 237, 0.2)',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  historyPanel: {
    borderRadius: 24,
    borderCurve: 'continuous',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  historyItem: {
    flexBasis: 160,
    flexGrow: 1,
    gap: Spacing.one,
  },
  emptyHistory: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.one,
    padding: Spacing.four,
  },
  completeCard: {
    alignItems: 'flex-start',
  },
  trophyMark: {
    alignItems: 'center',
    borderRadius: 28,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
  completeStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    width: '100%',
  },
  completeStat: {
    borderRadius: 18,
    borderCurve: 'continuous',
    flexBasis: 96,
    flexGrow: 1,
    padding: Spacing.three,
  },
});
