import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ReviewCard } from '@/lib/spaced-repetition';
import {
    buildMasteryByTopic,
    buildRetentionCurve,
    buildReviewLoad,
    buildSessionConsistency,
    detectWeakTopics,
    getStudyStreak,
} from '@/lib/study-analytics';
import { loadStudyReviewState } from '@/lib/study-review-loader';
import type { FocusSessionRecord } from '@/types/study-state';

const accentColors = ['#ff4d8b', '#b8a4ed', '#e8b94a', '#a4d4c5', '#60A5FA'];

function pct(value: number) {
  return `${value}%`;
}

export default function AnalyticsScreen() {
  const theme = useTheme();
  const isDark = theme.background === '#07111F';
  const [reviewCards, setReviewCards] = useState<ReviewCard[]>([]);
  const [sessions, setSessions] = useState<FocusSessionRecord[]>([]);
  const now = useMemo(() => new Date(), [reviewCards, sessions]);
  const retentionCurve = useMemo(() => buildRetentionCurve(reviewCards, now), [reviewCards, now]);
  const masteryByTopic = useMemo(() => buildMasteryByTopic(reviewCards, now), [reviewCards, now]);
  const weakTopics = useMemo(() => detectWeakTopics(reviewCards, now), [reviewCards, now]);
  const reviewLoad = useMemo(() => buildReviewLoad(reviewCards, now), [reviewCards, now]);
  const consistency = useMemo(() => buildSessionConsistency(sessions, now), [sessions, now]);
  const streak = useMemo(() => getStudyStreak(sessions, now), [sessions, now]);
  const currentRetention = retentionCurve[0]?.value ?? 0;
  const weekRetention = retentionCurve[6]?.value ?? currentRetention;

  useEffect(() => {
    let isMounted = true;

    loadStudyReviewState().then(({ reviewCards: nextCards, sessions: nextSessions }) => {
      if (!isMounted) return;
      setReviewCards(nextCards);
      setSessions(nextSessions);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <StudyScreen
      eyebrow="Progress"
      title="See what’s improving"
      subtitle="Retention, weak topics, review load, and study rhythm in one place.">
      <View style={styles.grid}>
        <StudyCard style={[styles.summaryCard, styles.blueLiftCard, isDark && styles.blueLiftCardDark]}>
          <ThemedText type="caption">Retention</ThemedText>
          <ThemedText type="metric">{pct(currentRetention)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            projected {pct(weekRetention)} in a week
          </ThemedText>
        </StudyCard>

        <StudyCard style={[styles.summaryCard, styles.aquaLiftCard, isDark && styles.aquaLiftCardDark]}>
          <ThemedText type="caption">Study streak</ThemedText>
          <ThemedText type="metric">{streak}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            active day{streak === 1 ? '' : 's'}
          </ThemedText>
        </StudyCard>

        <StudyCard style={[styles.summaryCard, styles.goldLiftCard]}>
          <ThemedText type="caption">Review load</ThemedText>
          <ThemedText type="metric">{reviewLoad.today}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            due today
          </ThemedText>
        </StudyCard>
      </View>

      <StudyCard style={styles.quickReadCard}>
        <SectionHeader title="Quick Read" detail="The shortest useful version." />
        <View style={styles.quickReadGrid}>
          <ThemedView type="backgroundElement" style={styles.quickReadItem}>
            <ThemedText type="smallBold">Retention is {pct(currentRetention)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Projected to settle near {pct(weekRetention)} without extra reviews.
            </ThemedText>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.quickReadItem}>
            <ThemedText type="smallBold">{weakTopics[0]?.topic ?? 'No weak topic yet'} needs attention</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {weakTopics[0] ? 'Mix it into the next short review block.' : 'Generate flashcards to unlock weak-topic detection.'}
            </ThemedText>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.quickReadItem}>
            <ThemedText type="smallBold">{reviewLoad.today} cards due today</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Keep the load light and consistent.
            </ThemedText>
          </ThemedView>
        </View>
      </StudyCard>

      <View style={styles.grid}>
        <StudyCard style={styles.panel}>
          <SectionHeader title="Retention Curve" detail="If no extra reviews happen." />
          <View style={styles.curveRow}>
            {retentionCurve.map((point, index) => (
              <View key={point.label} style={styles.curveColumn}>
                <ThemedView type="backgroundElement" style={styles.curveTrack}>
                  <View
                    style={[
                      styles.curveFill,
                      {
                        backgroundColor: accentColors[index % accentColors.length],
                        height: `${point.value}%`,
                      },
                    ]}
                  />
                </ThemedView>
                <ThemedText type="smallBold">{point.value}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {point.label}
                </ThemedText>
              </View>
            ))}
          </View>
        </StudyCard>

        <StudyCard style={styles.panel}>
          <SectionHeader title="Review Load" detail="What is coming up." />
          <View style={styles.loadGrid}>
            <ThemedView type="backgroundElement" style={styles.loadTile}>
              <ThemedText type="caption" themeColor="textSecondary">Today</ThemedText>
              <ThemedText type="metric">{reviewLoad.today}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.loadTile}>
              <ThemedText type="caption" themeColor="textSecondary">Tomorrow</ThemedText>
              <ThemedText type="metric">{reviewLoad.tomorrow}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.loadTile}>
              <ThemedText type="caption" themeColor="textSecondary">This week</ThemedText>
              <ThemedText type="metric">{reviewLoad.week}</ThemedText>
            </ThemedView>
          </View>
        </StudyCard>
      </View>

      <View style={styles.grid}>
        <StudyCard style={styles.panel}>
          <SectionHeader title="Mastery by Topic" detail="Based on recall, stability, and difficulty." />
          {masteryByTopic.length > 0 ? (
            masteryByTopic.map((item, index) => (
              <View key={`${item.course}-${item.topic}`} style={styles.masteryRow}>
                <View style={styles.masteryLabel}>
                  <ThemedText type="smallBold">{item.topic}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.course} - {item.value}%
                  </ThemedText>
                </View>
                <ThemedView type="backgroundElement" style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: accentColors[index % accentColors.length],
                        width: `${item.value}%`,
                      },
                    ]}
                  />
                </ThemedView>
              </View>
            ))
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyState}>
              <ThemedText type="smallBold">No mastery data yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Upload or seed PDFs, then generate flashcards to see topic progress.
              </ThemedText>
            </ThemedView>
          )}
        </StudyCard>

        <StudyCard style={styles.panel}>
          <SectionHeader title="Weak Topics" detail="Practice these soon." />
          {weakTopics.length > 0 ? (
            weakTopics.map((item, index) => (
              <ThemedView key={`${item.course}-${item.topic}`} type="backgroundElement" style={styles.weakRow}>
                <View style={[styles.riskDot, { backgroundColor: accentColors[index % accentColors.length] }]} />
                <View style={styles.flexCopy}>
                  <ThemedText type="smallBold">{item.topic}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.course} - {item.overdue} due - difficulty {item.averageDifficulty.toFixed(1)}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">{item.risk}</ThemedText>
              </ThemedView>
            ))
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyState}>
              <ThemedText type="smallBold">No weak topics yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Weak topics appear after flashcards are ready.
              </ThemedText>
            </ThemedView>
          )}
        </StudyCard>
      </View>

      <StudyCard>
        <SectionHeader title="Session Consistency" detail="Focus blocks completed in the last 7 days." />
        <View style={styles.consistencyHeader}>
          <View>
            <ThemedText type="caption" themeColor="textSecondary">Total</ThemedText>
            <ThemedText type="metric">{consistency.totalMinutes}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">minutes</ThemedText>
          </View>
          <View>
            <ThemedText type="caption" themeColor="textSecondary">Average</ThemedText>
            <ThemedText type="metric">{consistency.averageMinutes}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">min / active day</ThemedText>
          </View>
          <View>
            <ThemedText type="caption" themeColor="textSecondary">Active</ThemedText>
            <ThemedText type="metric">{consistency.activeDays}/7</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">days</ThemedText>
          </View>
        </View>
        <View style={styles.sessionBars}>
          {consistency.days.map((day, index) => (
            <View key={`${day.label}-${index}`} style={styles.sessionDay}>
              <ThemedView type="backgroundElement" style={styles.sessionTrack}>
                <View
                  style={[
                    styles.sessionFill,
                    {
                      backgroundColor: accentColors[index % accentColors.length],
                      height: `${Math.min(100, (day.minutes / 60) * 100)}%`,
                    },
                  ]}
                />
              </ThemedView>
              <ThemedText type="smallBold">{day.minutes}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{day.label}</ThemedText>
            </View>
          ))}
        </View>
      </StudyCard>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  summaryCard: {
    flexBasis: 180,
    flexGrow: 1,
    minWidth: 0,
  },
  blueLiftCard: {
    backgroundColor: 'rgba(184, 164, 237, 0.22)',
    boxShadow: '0 24px 70px rgba(184, 164, 237, 0.18)',
  },
  aquaLiftCard: {
    backgroundColor: 'rgba(164, 212, 197, 0.28)',
    boxShadow: '0 24px 70px rgba(164, 212, 197, 0.16)',
  },
  goldLiftCard: {
    backgroundColor: 'rgba(232, 185, 74, 0.18)',
  },
  blueLiftCardDark: {
    backgroundColor: 'rgba(184, 164, 237, 0.16)',
  },
  aquaLiftCardDark: {
    backgroundColor: 'rgba(164, 212, 197, 0.12)',
  },
  panel: {
    flexBasis: 320,
    flexGrow: 1,
    minWidth: 0,
  },
  quickReadCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  quickReadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  quickReadItem: {
    borderCurve: 'continuous',
    borderRadius: 18,
    flexBasis: 180,
    flexGrow: 1,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  curveRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  curveColumn: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.one,
    minWidth: 32,
  },
  curveTrack: {
    borderRadius: 999,
    height: 150,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  curveFill: {
    borderRadius: 999,
    minHeight: 8,
    width: '100%',
  },
  loadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  loadTile: {
    borderRadius: 22,
    borderCurve: 'continuous',
    flexBasis: 104,
    flexGrow: 1,
    padding: Spacing.four,
  },
  masteryRow: {
    gap: Spacing.two,
  },
  masteryLabel: {
    flexDirection: 'row',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  progressTrack: {
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  weakRow: {
    alignItems: 'center',
    borderRadius: 22,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  riskDot: {
    borderRadius: 999,
    height: 14,
    width: 14,
  },
  flexCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
  },
  emptyState: {
    borderCurve: 'continuous',
    borderRadius: 18,
    gap: Spacing.one,
    padding: Spacing.four,
  },
  consistencyHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  sessionBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  sessionDay: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.one,
    minWidth: 32,
  },
  sessionTrack: {
    borderRadius: 999,
    height: 120,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  sessionFill: {
    borderRadius: 999,
    minHeight: 6,
    width: '100%',
  },
});
