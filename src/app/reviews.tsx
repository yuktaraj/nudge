import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton, SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
    applyDifficultyInference,
    buildDailyReviewQueue,
    buildExamProximityQueue,
    daysUntilExam,
    formatDueDate,
    getElapsedDays,
    getRetrievability,
    isExamProximityMode,
    isHighDifficultyTopic,
    recallGrades,
    reviewCard,
    studyAreaKey,
    type RecallGrade,
    type ReviewCard,
} from '@/lib/spaced-repetition';
import { calculateCourseRecall, detectWeakTopics } from '@/lib/study-analytics';
import { loadStudyReviewState } from '@/lib/study-review-loader';
import { saveExamDate, saveImportantTopics, saveMasteryThresholds, saveReviewCards } from '@/lib/study-state';

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
  const [examDate, setExamDate] = useState('');
  const [examDateInput, setExamDateInput] = useState('');
  const [quizCount, setQuizCount] = useState(0);
  const [masteryThresholds, setMasteryThresholds] = useState<Record<string, number>>({});
  const [goalCourse, setGoalCourse] = useState('');
  const [goalInput, setGoalInput] = useState('90');
  const [importantTopics, setImportantTopics] = useState<string[]>([]);
  const [importantTopicsInput, setImportantTopicsInput] = useState('');
  const now = useMemo(() => new Date(), [cards]);
  const proximityMode = isExamProximityMode(examDate, now);
  const daysToExam = daysUntilExam(examDate, now);
  const highYieldTopics = useMemo(
    () => detectWeakTopics(cards, now).map((item) => item.topic),
    [cards, now]
  );
  const courses = useMemo(() => [...new Set(cards.map((card) => card.course))], [cards]);
  const selectedCourse = goalCourse || courses[0] || '';
  const selectedRecall = selectedCourse ? calculateCourseRecall(cards, selectedCourse, now) : 0;
  const selectedGoal = masteryThresholds[selectedCourse] ?? 0;
  const queueSize = proximityMode && selectedGoal > selectedRecall
    ? Math.min(10, 6 + Math.ceil((selectedGoal - selectedRecall) * 4))
    : 6;
  const queue = useMemo(
    () => proximityMode
      ? buildExamProximityQueue(cards, now, queueSize, highYieldTopics, masteryThresholds, importantTopics)
      : buildDailyReviewQueue(cards, now),
    [cards, now, proximityMode, highYieldTopics, masteryThresholds, queueSize, importantTopics]
  );
  const activeCard = cards.find((card) => card.id === activeCardId) ?? queue[0];
  const activeRetrievability = activeCard ? getRetrievability(activeCard, now) : 0;
  const dueCount = cards.filter((card) => new Date(card.dueAt).getTime() <= now.getTime()).length;
  const averageRecall =
    cards.reduce((sum, card) => sum + getRetrievability(card, now), 0) / Math.max(cards.length, 1);

  useEffect(() => {
    let isMounted = true;

    loadStudyReviewState().then(({ reviewCards: nextCards, assets, examDate: nextExamDate, masteryThresholds: nextThresholds, importantTopics: nextImportantTopics }) => {
      if (!isMounted) return;
      setCards(nextCards);
      setQuizCount(assets.reduce((count, asset) => count + asset.content.quiz.length, 0));
      setExamDate(nextExamDate ?? '');
      setExamDateInput(nextExamDate ?? '');
      setMasteryThresholds(nextThresholds);
      setImportantTopics(nextImportantTopics);
      setImportantTopicsInput(nextImportantTopics.join(', '));
      setActiveCardId((current) => nextCards.find((card) => card.id === current)?.id ?? nextCards[0]?.id ?? '');
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function updateExamDate() {
    const normalized = examDateInput.trim();
    if (normalized && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return;
    await saveExamDate(normalized || undefined);
    setExamDate(normalized);
  }

  async function saveGoal() {
    if (!selectedCourse) return;
    const goal = Math.min(99, Math.max(1, Number(goalInput)));
    if (!Number.isFinite(goal)) return;
    const nextThresholds = { ...masteryThresholds, [selectedCourse]: goal };
    await saveMasteryThresholds(nextThresholds);
    setMasteryThresholds(nextThresholds);
  }

  async function saveImportantTopicTags() {
    const nextTopics = [...new Set(importantTopicsInput.split(',').map((topic) => topic.trim()).filter(Boolean))];
    await saveImportantTopics(nextTopics);
    setImportantTopics(nextTopics);
  }

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
    const reviewedCards = cards.map((card) => (card.id === reviewedCard.id ? reviewedCard : card));
    const nextCards = applyDifficultyInference(reviewedCards, reviewedCard.topic);
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
    const nextCard = (proximityMode
      ? buildExamProximityQueue(nextCards, new Date(), queueSize, highYieldTopics, masteryThresholds, importantTopics)
      : buildDailyReviewQueue(nextCards, new Date())
    ).find(
      (card) => !nextReviewedAreas.includes(studyAreaKey(card))
    );
    if (nextCard) {
      setActiveCardId(nextCard.id);
    } else {
      setIsComplete(true);
    }
  }

  function restartReview() {
    const nextQueue = proximityMode
      ? buildExamProximityQueue(cards, new Date(), queueSize, highYieldTopics, masteryThresholds, importantTopics)
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
      <StudyCard style={[styles.modeBanner, proximityMode && { borderColor: theme.brandPink }]}>
        <View style={styles.modeBannerCopy}>
          <ThemedText type="caption" themeColor="textSecondary">Exam Proximity Mode</ThemedText>
          <ThemedText type="sectionTitle">
            {proximityMode
              ? `${daysToExam === 0 ? 'Exam day' : `${daysToExam} days to exam`}: high-yield review is on.`
              : 'Set an exam date to tune your final-week queue.'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {proximityMode
              ? `Weak topics first, mixed practice, and no more than two new cards in this queue. ${quizCount} quizzes ready.`
              : 'Use YYYY-MM-DD. The mode activates automatically seven days before the exam.'}
          </ThemedText>
        </View>
        <View style={styles.examDateControls}>
          <TextInput
            value={examDateInput}
            onChangeText={setExamDateInput}
            placeholder="2026-09-01"
            placeholderTextColor={theme.textSecondary}
            style={[styles.examDateInput, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            accessibilityLabel="Exam date"
          />
          <ActionButton label="Save date" variant="secondary" onPress={updateExamDate} />
          {proximityMode && quizCount > 0 ? (
            <ActionButton label="Open quizzes" onPress={() => router.push('/assets')} />
          ) : null}
        </View>
      </StudyCard>
      {courses.length > 0 ? (
        <StudyCard style={styles.goalCard}>
          <View style={styles.goalCopy}>
            <ThemedText type="caption" themeColor="textSecondary">Mastery Threshold</ThemedText>
            <ThemedText type="sectionTitle">Set a recall goal before your exam.</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Courses below their goal receive a more intense review queue during Exam Proximity Mode.
            </ThemedText>
          </View>
          <View style={styles.goalControls}>
            <TextInput
              value={goalCourse || courses[0]}
              onChangeText={setGoalCourse}
              placeholder="Course"
              placeholderTextColor={theme.textSecondary}
              style={[styles.examDateInput, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            />
            <TextInput
              value={goalInput}
              onChangeText={setGoalInput}
              keyboardType="number-pad"
              style={[styles.goalInput, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            />
            <ThemedText type="small">%</ThemedText>
            <ActionButton label="Save goal" variant="secondary" onPress={saveGoal} />
            {selectedGoal > 0 ? <ThemedText type="small" themeColor="textSecondary">Current recall: {Math.round(selectedRecall * 100)}%</ThemedText> : null}
          </View>
        </StudyCard>
      ) : null}
      <StudyCard style={styles.importantCard}>
        <View style={styles.goalCopy}>
          <ThemedText type="caption" themeColor="textSecondary">Important Topics</ThemedText>
          <ThemedText type="sectionTitle">Tag what matters most.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            During exam week, these topics receive extra priority alongside low-stability cards.
          </ThemedText>
        </View>
        <View style={styles.goalControls}>
          <TextInput
            value={importantTopicsInput}
            onChangeText={setImportantTopicsInput}
            placeholder="e.g. Chain rule, Derivatives"
            placeholderTextColor={theme.textSecondary}
            style={[styles.importantInput, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
          />
          <ActionButton label="Save topics" variant="secondary" onPress={saveImportantTopicTags} />
        </View>
      </StudyCard>
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
          <ThemedText type="caption">{proximityMode ? 'Quizzes' : 'Mix'}</ThemedText>
          <ThemedText type="metric">{proximityMode ? quizCount : new Set(queue.map((card) => card.course)).size}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {proximityMode ? 'ready to mix in' : 'subjects interleaved'}
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
              {isHighDifficultyTopic(cards, activeCard.topic) ? (
                <ThemedView style={[styles.difficultyPill, { backgroundColor: theme.error }]}>
                  <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>High Difficulty</ThemedText>
                </ThemedView>
              ) : null}
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
              title={proximityMode ? 'Exam Queue' : 'Interleaved Queue'}
              detail={proximityMode ? 'High-yield topics, due reviews, and limited new cards.' : '4-6 mixed topics today — no repeats.'}
            />
            {queue.map((card, index) => {
              const isActive = card.id === activeCard.id;
              const recall = getRetrievability(card, now);

              return (
                <Pressable
                  key={card.id}
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
                        {formatDueDate(card.dueAt, now)} - {percent(recall)}
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
  modeBanner: {
    borderCurve: 'continuous',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  modeBannerCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 220,
  },
  examDateControls: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  examDateInput: {
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 140,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  goalCard: {
    borderCurve: 'continuous',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  goalCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 220,
  },
  goalControls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  goalInput: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    width: 76,
  },
  importantCard: {
    borderCurve: 'continuous',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  importantInput: {
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 220,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
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
  difficultyPill: {
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
