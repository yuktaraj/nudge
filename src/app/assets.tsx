import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton, SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { hasSupabaseConfig } from '@/lib/env';
import { listCachedAssets, listCachedSources } from '@/lib/parsing/cache';
import { refreshParsingState } from '@/lib/parsing/pipeline';
import { askSource, startProcessing, verifyCitations } from '@/lib/parsing/supabase-api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AskResponse, GeneratedAssetRecord, SourceRecord } from '@/types/parsing';

type AssetView = 'summary' | 'notes' | 'flashcards' | 'quiz';

const assetTabs: { id: AssetView; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'notes', label: 'Notes' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'quiz', label: 'Quiz' },
];

function sourceLabel(source?: SourceRecord) {
  if (!source) {
    return 'Generated source';
  }

  if (source.status === 'ready') {
    return 'Ready';
  }

  if (source.status === 'needs_ocr') {
    return 'Needs OCR';
  }

  if (source.status === 'failed') {
    return 'Failed';
  }

  return 'Processing';
}

function sourceType(source?: SourceRecord) {
  if (!source) return 'Study material';
  if (source.mimeType.includes('pdf')) return 'PDF';
  if (source.mimeType.includes('presentation')) return 'Slides';
  if (source.mimeType.includes('wordprocessing')) return 'Document';
  if (source.mimeType.includes('text')) return 'Text notes';
  return 'Study material';
}

function sourceTopicLabel(source?: SourceRecord) {
  if (!source?.subject && !source?.topic) return null;
  return [source.subject, source.topic].filter(Boolean).join(' - ');
}

function subjectFor(source?: SourceRecord) {
  return source?.subject?.trim() || 'Unsorted';
}

function topicFor(source?: SourceRecord) {
  return source?.topic?.trim() || 'General';
}

function sourceForAsset(asset: GeneratedAssetRecord, sources: SourceRecord[]) {
  return sources.find((source) => source.id === asset.sourceId);
}

function isLegacyAsset(asset: GeneratedAssetRecord) {
  // Packs generated before the cited pipeline have no *_items arrays.
  const content = asset.content;
  return (
    !content.note_items?.length &&
    !content.flashcard_items?.length &&
    !content.quiz_items?.length
  );
}

export default function AssetsScreen() {
  const theme = useTheme();
  const isDark = theme.background === '#07111F';
  const [assets, setAssets] = useState<GeneratedAssetRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [assetView, setAssetView] = useState<AssetView>('summary');
  const [statusText, setStatusText] = useState('Loading study tools...');
  const [revealedCards, setRevealedCards] = useState<Record<string, boolean>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [askMessage, setAskMessage] = useState('');
  const [expandedCitation, setExpandedCitation] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const loadAssets = useCallback(async () => {
    const [cachedSources, cachedAssets] = await Promise.all([
      listCachedSources(),
      listCachedAssets(),
    ]);

    setAssets(cachedAssets);
    setSources(cachedSources);
    setSelectedAssetId((current) => current || cachedAssets[0]?.id || '');
    setStatusText(
      cachedAssets.length > 0
        ? 'Showing saved study tools.'
        : 'No generated study tools yet.'
    );

    if (!hasSupabaseConfig()) {
      return;
    }

    try {
      const remoteState = await refreshParsingState();
      const nextAssets = remoteState.assets;
      setAssets(nextAssets);
      setSources(remoteState.sources);
      setSelectedAssetId((current) => current || nextAssets[0]?.id || '');
      setStatusText(nextAssets.length > 0 ? 'Updated from Supabase.' : 'No generated study tools yet.');
    } catch {
      // Keep local cached state if remote refresh fails
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const groupedAssets = useMemo(() => {
    const groups = new Map<string, Map<string, GeneratedAssetRecord[]>>();

    assets.forEach((asset) => {
      const source = sourceForAsset(asset, sources);
      const subject = subjectFor(source);
      const topic = topicFor(source);
      const subjectGroup = groups.get(subject) ?? new Map<string, GeneratedAssetRecord[]>();
      subjectGroup.set(topic, [...(subjectGroup.get(topic) ?? []), asset]);
      groups.set(subject, subjectGroup);
    });

    return groups;
  }, [assets, sources]);

  const subjects = useMemo(() => [...groupedAssets.keys()].sort(), [groupedAssets]);
  const activeSubject = selectedSubject && groupedAssets.has(selectedSubject) ? selectedSubject : subjects[0] ?? '';
  const topics = useMemo(
    () => [...(groupedAssets.get(activeSubject)?.keys() ?? [])].sort(),
    [activeSubject, groupedAssets]
  );
  const activeTopic = selectedTopic && groupedAssets.get(activeSubject)?.has(selectedTopic)
    ? selectedTopic
    : topics[0] ?? '';
  const visibleAssets = useMemo(
    () => groupedAssets.get(activeSubject)?.get(activeTopic) ?? [],
    [activeSubject, activeTopic, groupedAssets]
  );

  const selectedAsset = useMemo(
    () =>
      visibleAssets.find((asset) => asset.id === selectedAssetId) ??
      visibleAssets[0] ??
      assets.find((asset) => asset.id === selectedAssetId) ??
      assets[0],
    [assets, selectedAssetId, visibleAssets]
  );
  const selectedSource = sources.find((source) => source.id === selectedAsset?.sourceId);

  useEffect(() => {
    if (!activeSubject || selectedSubject === activeSubject) return;
    setSelectedSubject(activeSubject);
  }, [activeSubject, selectedSubject]);

  useEffect(() => {
    if (!activeTopic || selectedTopic === activeTopic) return;
    setSelectedTopic(activeTopic);
  }, [activeTopic, selectedTopic]);

  useEffect(() => {
    if (!selectedAsset?.id || selectedAsset.id === selectedAssetId) return;
    setSelectedAssetId(selectedAsset.id);
  }, [selectedAsset?.id, selectedAssetId]);

  function toggleCard(cardKey: string) {
    setRevealedCards((current) => ({
      ...current,
      [cardKey]: !current[cardKey],
    }));
  }

  function selectQuizAnswer(questionKey: string, choice: string) {
    setQuizAnswers((current) => ({
      ...current,
      [questionKey]: choice,
    }));
  }

  async function submitQuestion() {
    if (!selectedAsset || askQuestion.trim().length === 0) return;

    setIsAsking(true);
    setAskMessage('');
    try {
      const result = await askSource(selectedAsset.sourceId, askQuestion.trim());
      setAskResult(result);
    } catch (error) {
      setAskResult(null);
      setAskMessage(error instanceof Error ? error.message : 'Could not answer that question.');
    } finally {
      setIsAsking(false);
    }
  }

  async function verifySelectedAsset() {
    if (!selectedAsset) return;

    setIsVerifying(true);
    setAskMessage('');
    try {
      const result = await verifyCitations(selectedAsset.sourceId);
      setAskMessage(
        `Verification done: kept ${result.kept.notes} notes, ${result.kept.flashcards} cards, ${result.kept.quiz} questions.`
      );
      await loadAssets();
    } catch (error) {
      setAskMessage(error instanceof Error ? error.message : 'Verification failed.');
    } finally {
      setIsVerifying(false);
    }
  }

  async function reprocessSelected() {
    if (!selectedAsset || isReprocessing) return;

    setIsReprocessing(true);
    setStatusText('Reprocessing with the new pipeline...');
    try {
      await startProcessing(selectedAsset.sourceId);

      // Poll until the source leaves the processing states (or give up after ~3 min).
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const remote = await refreshParsingState();
        setAssets(remote.assets);
        setSources(remote.sources);

        const source = remote.sources.find((entry) => entry.id === selectedAsset.sourceId);
        if (!source || source.status === 'ready' || source.status === 'failed') {
          setStatusText(
            source?.status === 'failed'
              ? `Reprocess failed: ${source.error ?? 'unknown error'}`
              : 'Reprocess complete - section-aware study pack generated.'
          );
          break;
        }
        setStatusText(`Reprocessing... ${source.stage} (${source.progress}%)`);
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Could not reprocess this document.');
    } finally {
      setIsReprocessing(false);
    }
  }

  return (
    <StudyScreen
      eyebrow="Study tools"
      title="Study from your uploads"
      subtitle="Summaries, notes, flashcards, and quizzes made from your materials.">
      <View style={styles.grid}>
        <StudyCard style={styles.sourcePanel}>
          <SectionHeader title="Choose Subject" detail={statusText} />
          <ActionButton label="Refresh" variant="secondary" onPress={loadAssets} />
          <View style={styles.selectorStack}>
            <View style={styles.optionWrap}>
              {subjects.map((subject) => {
                const isSelected = subject === activeSubject;

                return (
                  <Pressable
                    key={subject}
                    onPress={() => {
                      setSelectedSubject(subject);
                      setSelectedTopic('');
                      setSelectedAssetId('');
                    }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
                      style={[
                        styles.selectorPill,
                        { borderColor: isSelected ? theme.primary : theme.hairline },
                      ]}>
                      <ThemedText type="smallBold">{subject}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader title="Choose Topic" />
            <View style={styles.optionWrap}>
              {topics.map((topic) => {
                const isSelected = topic === activeTopic;

                return (
                  <Pressable
                    key={topic}
                    onPress={() => {
                      setSelectedTopic(topic);
                      setSelectedAssetId('');
                    }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
                      style={[
                        styles.selectorPill,
                        { borderColor: isSelected ? theme.primary : theme.hairline },
                      ]}>
                      <ThemedText type="smallBold">{topic}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader title="Choose Asset" />
          </View>
          {visibleAssets.map((asset) => {
            const source = sourceForAsset(asset, sources);
            const isSelected = asset.id === selectedAsset?.id;

            return (
              <Pressable
                key={asset.id}
                onPress={() => setSelectedAssetId(asset.id)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
                  style={[
                    styles.sourceButton,
                    { borderColor: isSelected ? theme.primary : theme.hairline },
                  ]}>
                  <View style={styles.sourceCopy}>
                    <ThemedText type="smallBold">{asset.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {sourceType(source)} - {asset.content.flashcards.length} cards
                    </ThemedText>
                    {sourceTopicLabel(source) ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {sourceTopicLabel(source)}
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedView
                    style={[
                      styles.readinessPill,
                      {
                        backgroundColor:
                          source?.status === 'ready' || !source ? theme.success : theme.brandOchre,
                      },
                    ]}>
                    <ThemedText type="smallBold">{sourceLabel(source)}</ThemedText>
                  </ThemedView>
                </ThemedView>
              </Pressable>
            );
          })}
        </StudyCard>

        <StudyCard style={styles.contentPanel}>
          {selectedAsset ? (
            <>
              <View style={styles.contentHeader}>
                <View style={styles.sourceCopy}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {sourceTopicLabel(selectedSource) ?? sourceType(selectedSource)}
                  </ThemedText>
                  <ThemedText type="subtitle">{selectedAsset.title}</ThemedText>
                </View>
                <View style={styles.headerActions}>
                  {isLegacyAsset(selectedAsset) && (
                    <ActionButton
                      label={isReprocessing ? 'Reprocessing...' : 'Reprocess'}
                      variant="secondary"
                      onPress={reprocessSelected}
                    />
                  )}
                  {selectedAsset.content.verified === false && (
                    <ActionButton
                      label={isVerifying ? 'Verifying...' : 'Verify citations'}
                      variant="secondary"
                      onPress={verifySelectedAsset}
                    />
                  )}
                  <ActionButton
                    label={isAskOpen ? 'Close ask' : 'Ask this document'}
                    variant="secondary"
                    onPress={() => {
                      setIsAskOpen((open) => !open);
                      setAskMessage('');
                    }}
                  />
                </View>
              </View>

              <View style={styles.tabRow}>
                {assetTabs.map((tab) => {
                  const isSelected = tab.id === assetView;

                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setAssetView(tab.id)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView
                        type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.assetTab}>
                        <ThemedText
                          type="smallBold"
                          themeColor={isSelected ? 'text' : 'textSecondary'}>
                          {tab.label}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  );
                })}
              </View>

              {isAskOpen && (
                <ThemedView type="backgroundElement" style={styles.askPanel}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Ask about {selectedAsset.title}
                  </ThemedText>
                  <View style={styles.askRow}>
                    <TextInput
                      editable={!isAsking}
                      multiline
                      onChangeText={setAskQuestion}
                      placeholder="Ask anything about this document..."
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.askInput, { borderColor: theme.hairline, color: theme.text }]}
                      value={askQuestion}
                    />
                    <ActionButton
                      label={isAsking ? 'Thinking...' : 'Ask'}
                      onPress={submitQuestion}
                    />
                  </View>

                  {askMessage ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {askMessage}
                    </ThemedText>
                  ) : null}

                  {askResult ? (
                    <View style={styles.askResult}>
                      <ThemedText type="default">{askResult.answer}</ThemedText>
                      {askResult.citations.length > 0 && (
                        <View style={styles.stack}>
                          <ThemedText type="caption" themeColor="textSecondary">
                            Citations - tap to view source
                          </ThemedText>
                          {askResult.citations.map((citation) => {
                            const citationKey = `${askResult.sourceId}-${citation.label}`;
                            const isExpanded = expandedCitation === citationKey;

                            return (
                              <Pressable
                                key={citationKey}
                                onPress={() => setExpandedCitation(isExpanded ? '' : citationKey)}
                                style={({ pressed }) => pressed && styles.pressed}>
                                <ThemedView type="backgroundSelected" style={styles.citationPill}>
                                  <ThemedText type="smallBold">
                                    {citation.label}
                                    {citation.sectionPath ? ` - ${citation.sectionPath}` : ''}
                                  </ThemedText>
                                  {isExpanded && (
                                    <ThemedText type="small" themeColor="textSecondary">
                                      {citation.snippet}
                                    </ThemedText>
                                  )}
                                </ThemedView>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : null}
                </ThemedView>
              )}

              {assetView === 'summary' && (
                <ThemedView style={[styles.summaryCard, styles.summaryGlow, isDark && styles.summaryGlowDark]}>
                  <ThemedText type="caption">Summary</ThemedText>
                  <ThemedText type="default">{selectedAsset.content.summary}</ThemedText>
                </ThemedView>
              )}

              {assetView === 'notes' && (
                <View style={styles.stack}>
                  {selectedAsset.content.detailed_notes.map((note, index) => (
                    <ThemedView key={`${note}-${index}`} type="backgroundElement" style={styles.noteRow}>
                      <ThemedView type="backgroundSelected" style={styles.indexBadge}>
                        <ThemedText type="smallBold">{index + 1}</ThemedText>
                      </ThemedView>
                      <ThemedText type="smallBold" style={styles.flexText}>
                        {note}
                      </ThemedText>
                    </ThemedView>
                  ))}
                </View>
              )}

              {assetView === 'flashcards' && (
                <View style={styles.cardGrid}>
                  {selectedAsset.content.flashcards.map((card, index) => {
                    const cardKey = `${selectedAsset.id}-card-${index}`;
                    const isRevealed = Boolean(revealedCards[cardKey]);

                    return (
                      <Pressable
                        key={`${card.front}-${index}`}
                        onPress={() => toggleCard(cardKey)}
                        style={({ pressed }) => [styles.flashcardPressable, pressed && styles.pressed]}>
                        <ThemedView type="backgroundElement" style={styles.flashcard}>
                          <ThemedText type="caption" themeColor="textSecondary">
                            {isRevealed ? 'Answer' : 'Prompt'}
                          </ThemedText>
                          <ThemedText type="sectionTitle">
                            {isRevealed ? card.back : card.front}
                          </ThemedText>
                          <ThemedView type="backgroundSelected" style={styles.answerBox}>
                            <ThemedText type="smallBold">
                              {isRevealed ? 'Tap to hide answer' : 'Tap to reveal answer'}
                            </ThemedText>
                          </ThemedView>
                        </ThemedView>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {assetView === 'quiz' && (
                <View style={styles.stack}>
                  {selectedAsset.content.quiz.map((question, index) => {
                    const questionKey = `${selectedAsset.id}-quiz-${index}`;
                    const selectedChoice = quizAnswers[questionKey];
                    const isAnswered = Boolean(selectedChoice);
                    const isCorrect = selectedChoice === question.answer;

                    return (
                      <ThemedView key={`${question.question}-${index}`} type="backgroundElement" style={styles.quizCard}>
                        <ThemedText type="caption" themeColor="textSecondary">
                          Question {index + 1}
                        </ThemedText>
                        <ThemedText type="sectionTitle">{question.question}</ThemedText>
                        <View style={styles.choiceList}>
                          {question.choices.map((choice) => {
                            const isSelected = selectedChoice === choice;

                            return (
                              <Pressable
                                key={choice}
                                onPress={() => selectQuizAnswer(questionKey, choice)}
                                style={({ pressed }) => pressed && styles.pressed}>
                                <ThemedView
                                  type={isSelected ? 'backgroundSelected' : 'card'}
                                  style={[
                                    styles.choicePill,
                                    {
                                      backgroundColor: isSelected
                                        ? theme.backgroundSelected
                                        : theme.backgroundElement,
                                      borderColor: isSelected ? theme.primary : theme.hairline,
                                    },
                                    isSelected && {
                                      borderColor: isCorrect ? theme.success : theme.error,
                                    },
                                  ]}>
                                  <ThemedText type="smallBold">{choice}</ThemedText>
                                </ThemedView>
                              </Pressable>
                            );
                          })}
                        </View>
                        {isAnswered && (
                          <ThemedView
                            type="backgroundSelected"
                            style={[
                              styles.resultPill,
                              { borderColor: isCorrect ? theme.success : theme.error },
                            ]}>
                            <ThemedText type="smallBold">
                              {isCorrect ? 'Correct' : 'Incorrect'}
                            </ThemedText>
                          </ThemedView>
                        )}
                      </ThemedView>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyState}>
              <ThemedText type="sectionTitle">No study tools yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Upload a file in Library, then refresh after it finishes.
              </ThemedText>
            </ThemedView>
          )}
        </StudyCard>
      </View>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  sourcePanel: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 0,
  },
  contentPanel: {
    flexGrow: 2,
    flexBasis: 320,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.72,
  },
  sourceButton: {
    borderWidth: 1,
    borderRadius: 24,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    justifyContent: 'space-between',
    padding: Spacing.four,
    minWidth: 0,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  selectorStack: {
    gap: Spacing.three,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  selectorPill: {
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  readinessPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  contentHeader: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  modelPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  askPanel: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.three,
    minWidth: 0,
    padding: Spacing.four,
  },
  askRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  askInput: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
    flex: 1,
    minHeight: 56,
    minWidth: 0,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  askResult: {
    gap: Spacing.three,
  },
  citationPill: {
    borderRadius: 16,
    borderCurve: 'continuous',
    gap: Spacing.one,
    minWidth: 0,
    padding: Spacing.three,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  assetTab: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  summaryCard: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.two,
    padding: Spacing.four,
    minWidth: 0,
  },
  summaryGlow: {
    backgroundColor: 'rgba(184, 164, 237, 0.22)',
    boxShadow: '0 22px 60px rgba(184, 164, 237, 0.18)',
  },
  summaryGlowDark: {
    backgroundColor: 'rgba(184, 164, 237, 0.14)',
  },
  stack: {
    gap: Spacing.three,
  },
  noteRow: {
    borderRadius: 18,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexText: {
    flex: 1,
    minWidth: 0,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  flashcard: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.three,
    minHeight: 220,
    minWidth: 0,
    padding: Spacing.four,
  },
  flashcardPressable: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
  },
  answerBox: {
    borderRadius: 20,
    borderCurve: 'continuous',
    marginTop: 'auto',
    padding: Spacing.four,
  },
  quizCard: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.three,
    minWidth: 0,
    padding: Spacing.four,
  },
  choiceList: {
    gap: Spacing.three,
  },
  choicePill: {
    borderWidth: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    minHeight: 64,
    padding: Spacing.four,
  },
  resultPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  emptyState: {
    borderRadius: 28,
    borderCurve: 'continuous',
    gap: Spacing.two,
    padding: Spacing.four,
  },
});
