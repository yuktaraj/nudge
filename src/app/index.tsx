import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActionButton, SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  dedupeByStudyArea,
  formatDueDate,
  getDueState,
  getRetrievability,
  interleaveReviewQueue,
  type ReviewCard,
} from '@/lib/spaced-repetition';
import { calculateDashboardReviewMetrics, detectWeakTopics, getStudyStreak } from '@/lib/study-analytics';
import { loadStudyReviewState } from '@/lib/study-review-loader';
import { supabase } from '@/lib/supabase';

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function riskMessage(risk: number) {
  if (risk < 35) return 'You’re in a good spot after recent reviews.';
  if (risk < 70) return 'A short review will help keep things fresh.';
  return 'Some cards are slipping. Start with a quick review.';
}

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.background === '#07111F';
  
  // Added a loading state to prevent the dashboard from flashing before the redirect
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  const [hasRealMaterials, setHasRealMaterials] = useState(false);
  const [hasReviewState, setHasReviewState] = useState(false);
  const [reviewCards, setReviewCards] = useState<ReviewCard[]>([]);
  const [studyStreak, setStudyStreak] = useState(0);
  
  const hasStudyPlan = hasRealMaterials || hasReviewState;
  
  const reviewMetrics = useMemo(
    () => calculateDashboardReviewMetrics(reviewCards),
    [reviewCards]
  );
  
  const dueReviewCards = useMemo(
    () =>
      reviewCards
        .filter((card) => getDueState(card))
        .sort((first, second) => getRetrievability(first) - getRetrievability(second))
        .slice(0, 3),
    [reviewCards]
  );

  const todaysQueue = useMemo(
    () => dedupeByStudyArea(interleaveReviewQueue(reviewCards)).slice(0, 4),
    [reviewCards]
  );
  
  const weakTopicItems = useMemo(() => detectWeakTopics(reviewCards), [reviewCards]);
  
  const studyBlocks = useMemo(
    () => [
      {
        focus: dueReviewCards[0]?.course ?? 'Add study material',
        label: 'First review',
        state: dueReviewCards[0] ? 'Due' : 'Ready',
        time: 'Now',
      },
      {
        focus: dueReviewCards[1]?.course ?? 'Read notes',
        label: 'Short recall',
        state: dueReviewCards[1] ? 'Due' : 'Optional',
        time: 'Later',
      },
      {
        focus: dueReviewCards[2]?.course ?? 'Try a quiz',
        label: 'Mixed practice',
        state: dueReviewCards[2] ? 'Light' : 'Optional',
        time: 'Evening',
      },
    ],
    [dueReviewCards]
  );

  useFocusEffect(useCallback(() => {
    let isMounted = true;

    // Check if the user is logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;

      // If no session exists, send them to login immediately
      if (!session) {
        router.replace('/login');
        return;
      }

      // If logged in, turn off the loading screen
      setIsCheckingAuth(false);

      // Fetch their study materials
      loadStudyReviewState().then(({ reviewCards: nextCards, sessions, sources }) => {
        if (!isMounted) return;
        setHasRealMaterials(sources.some((source) => !source.id.startsWith('fixture-')));
        setHasReviewState(nextCards.length > 0);
        setReviewCards(nextCards);
        setStudyStreak(getStudyStreak(sessions));
      });
    });

    return () => {
      isMounted = false;
    };
  }, []));

  // If we are still checking if they are logged in, show a loading screen instead of the dashboard
  if (isCheckingAuth) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <StudyScreen
      eyebrow="Today"
      title={hasStudyPlan ? 'Your study plan is ready' : 'Start with one study material'}
      subtitle={
        hasStudyPlan
          ? 'A simple queue for what to review, read, and focus on next.'
          : 'Upload a PDF, slide deck, image, or pasted notes. Nudge will turn it into a study pack.'
      }>
      <View style={styles.heroGrid}>
        <StudyCard style={[styles.heroCard, styles.heroGlowCard, isDark && styles.heroGlowCardDark]}>
          <ThemedText type="caption" style={{ color: theme.primary }}>
            {hasStudyPlan ? 'Risk today' : 'First step'}
          </ThemedText>
          <ThemedText type="metric">
            {hasStudyPlan ? `${reviewMetrics.riskToday}%` : 'Upload'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hasStudyPlan
              ? riskMessage(reviewMetrics.riskToday)
              : 'Create summaries, notes, flashcards, quizzes, and a review queue from one source.'}
          </ThemedText>
          <View style={styles.buttonRow}>
            <ActionButton
              label={hasStudyPlan ? 'Start review' : 'Add first material'}
              onPress={() => router.push(hasStudyPlan ? '/reviews' : '/library')}
            />
            <ActionButton
              label={hasStudyPlan ? 'Add material' : 'See study tools'}
              variant="secondary"
              onPress={() => router.push(hasStudyPlan ? '/library' : '/assets')}
            />
          </View>
        </StudyCard>

        <View style={styles.metricGrid}>
          <StudyCard style={[styles.metricCard, { backgroundColor: theme.brandTeal, borderColor: 'transparent' }]}>
            <ThemedText type="caption" style={styles.tileText}>Review</ThemedText>
            <ThemedText type="metric" style={styles.tileText}>{reviewMetrics.dueCount}</ThemedText>
            <ThemedText type="small" style={styles.tileText}>cards due now</ThemedText>
          </StudyCard>
          <StudyCard style={[styles.metricCard, { backgroundColor: theme.brandPeach, borderColor: 'transparent' }]}>
            <ThemedText type="caption" style={styles.tileText}>Recall</ThemedText>
            <ThemedText type="metric" style={styles.tileText}>{formatPercent(reviewMetrics.averageRecall)}</ThemedText>
            <ThemedText type="small" style={styles.tileText}>average right now</ThemedText>
          </StudyCard>
          <StudyCard style={[styles.metricCard, { backgroundColor: theme.brandLavender, borderColor: 'transparent' }]}>
            <ThemedText type="caption" style={styles.tileText}>Streak</ThemedText>
            <ThemedText type="metric" style={styles.tileText}>{studyStreak}</ThemedText>
            <ThemedText type="small" style={styles.tileText}>active day{studyStreak === 1 ? '' : 's'}</ThemedText>
          </StudyCard>
        </View>
      </View>

      <View style={styles.grid}>
        <StudyCard style={[styles.column, styles.playfulPanel, isDark && styles.playfulPanelDark]}>
          <SectionHeader title="Today’s Queue" detail="A mix of topics — no repeats." />
          {todaysQueue.length > 0 ? (
            todaysQueue.map((item) => (
              <ThemedView key={item.id} style={styles.queueItem}>
                <View style={[styles.accentDot, { backgroundColor: theme.brandPink }]} />
                <View style={styles.queueCopy}>
                  <ThemedText type="smallBold">{item.topic}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.course} - difficulty {item.difficulty.toFixed(1)}
                  </ThemedText>
                </View>
                <View style={styles.queueMeta}>
                  <ThemedText type="smallBold">1 card</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDueDate(item.dueAt)}
                  </ThemedText>
                </View>
              </ThemedView>
            ))
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyPanel}>
              <ThemedText type="smallBold">No reviews due yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Seed or upload materials to build your first queue.
              </ThemedText>
            </ThemedView>
          )}
        </StudyCard>

        <StudyCard style={[styles.column, styles.playfulPanelAlt, isDark && styles.playfulPanelAltDark]}>
          <SectionHeader title="Study Blocks" detail="A gentle plan for the day." />
          {studyBlocks.map((block) => (
            <ThemedView key={block.label} type="backgroundElement" style={styles.blockRow}>
              <ThemedText type="smallBold">{block.time}</ThemedText>
              <View style={styles.queueCopy}>
                <ThemedText type="smallBold">{block.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {block.focus}
                </ThemedText>
              </View>
              <ThemedView type="backgroundSelected" style={styles.statusPill}>
                <ThemedText type="smallBold">{block.state}</ThemedText>
              </ThemedView>
            </ThemedView>
          ))}
        </StudyCard>
      </View>

      <View style={styles.grid}>
        <StudyCard style={[styles.column, styles.playfulPanelAlt, isDark && styles.playfulPanelAltDark]}>
          <SectionHeader title="Notes From Nudge" detail="Small things to keep in mind." />
          {[
            reviewCards.length > 0
              ? 'Your review mix now comes from generated flashcards.'
              : 'Upload or seed PDFs to generate summaries, notes, cards, and quizzes.',
            'Alternating subjects can make recall practice more durable.',
            studyStreak > 0
              ? `You have a ${studyStreak}-day study streak.`
              : 'Complete a focus block to start your streak.',
          ].map((insight) => (
            <ThemedView key={insight} style={styles.insightRow}>
              <View style={[styles.accentDot, { backgroundColor: theme.brandCoral }]} />
              <ThemedText type="smallBold" style={styles.insightText}>
                {insight}
              </ThemedText>
            </ThemedView>
          ))}
        </StudyCard>

        <StudyCard style={[styles.column, styles.playfulPanel, isDark && styles.playfulPanelDark]}>
          <SectionHeader title="Needs Practice" detail="Mix these into your next session." />
          <View style={styles.topicWrap}>
            {(weakTopicItems.length > 0 ? weakTopicItems.map((item) => item.topic) : ['No weak topics yet']).map((topic) => (
              <ThemedView key={topic} type="backgroundElement" style={styles.topicPill}>
                <ThemedText type="smallBold">{topic}</ThemedText>
              </ThemedView>
            ))}
          </View>
        </StudyCard>
      </View>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  heroCard: {
    flexGrow: 2,
    flexBasis: 320,
    minWidth: 0,
  },
  heroGlowCard: {
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
  },
  heroGlowCardDark: {
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
  },
  metricGrid: {
    flexGrow: 1,
    flexBasis: 260,
    gap: Spacing.two,
    minWidth: 0,
  },
  metricCard: {
    minHeight: 116,
  },
  tileText: {
    color: '#ffffff',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  column: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 0,
  },
  playfulPanel: {
    backgroundColor: 'rgba(28, 176, 246, 0.08)',
  },
  playfulPanelAlt: {
    backgroundColor: 'rgba(88, 204, 2, 0.08)',
  },
  playfulPanelDark: {
    backgroundColor: 'rgba(28, 176, 246, 0.1)',
  },
  playfulPanelAltDark: {
    backgroundColor: 'rgba(88, 204, 2, 0.1)',
  },
  queueItem: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  accentDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    boxShadow: '0 0 18px rgba(96, 165, 250, 0.34)',
  },
  queueCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  queueMeta: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  blockRow: {
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  insightRow: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  insightText: {
    flex: 1,
    minWidth: 0,
  },
  topicWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  topicPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  emptyPanel: {
    borderCurve: 'continuous',
    borderRadius: 18,
    gap: Spacing.one,
    padding: Spacing.four,
  },
});