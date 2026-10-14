import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { ActionButton, SectionHeader, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hasSupabaseConfig } from '@/lib/env';
import { listCachedAssets, listCachedSources, removeCachedSource } from '@/lib/parsing/cache';
import { pickStudyFiles } from '@/lib/parsing/document-picker';
import { refreshParsingState, uploadAndProcessFiles } from '@/lib/parsing/pipeline';
import { deleteSource, startProcessing } from '@/lib/parsing/supabase-api';
import type { GeneratedAssetRecord, SourceRecord } from '@/types/parsing';
import {
  useDocumentSearch,
  type SearchMode,
  buildReformulatedQuery,
} from '@/lib/ir/search';

/** Color per retrieval mode for result badges */
const modeColors: Partial<Record<SearchMode, string>> = {
  exact:     '#1e6fd9',
  prefix:    '#7c3aed',
  suffix:    '#0891b2',
  substring: '#0d9488',
  fuzzy:     '#d97706',
  boolean:   '#dc2626',
  vsm:       '#16a34a',
  hybrid:    '#6b7280',
};

const commonSubjects = [
  'Biology',
  'Chemistry',
  'Physics',
  'Math',
  'History',
  'Literature',
  'Finance',
  'Computer Science',
  'Psychology',
  'Economics',
  'General',
];

const subjectKeywordMap: Array<{ keywords: string[]; subject: string }> = [
  { keywords: ['biology', 'cell', 'genetics', 'reproduction', 'neural', 'organism'], subject: 'Biology' },
  { keywords: ['chemistry', 'molecule', 'reaction', 'acid', 'base', 'organic'], subject: 'Chemistry' },
  { keywords: ['physics', 'force', 'motion', 'energy', 'wave', 'electricity'], subject: 'Physics' },
  { keywords: ['math', 'calculus', 'algebra', 'geometry', 'derivative', 'integral'], subject: 'Math' },
  { keywords: ['history', 'source', 'empire', 'war', 'revolution', 'civilization'], subject: 'History' },
  { keywords: ['literature', 'poem', 'novel', 'theme', 'character', 'essay'], subject: 'Literature' },
  { keywords: ['finance', 'market', 'trading', 'defi', 'liquidity', 'portfolio'], subject: 'Finance' },
  { keywords: ['code', 'programming', 'algorithm', 'database', 'software', 'computer'], subject: 'Computer Science' },
  { keywords: ['psychology', 'memory', 'attention', 'behavior', 'cognition'], subject: 'Psychology' },
  { keywords: ['economics', 'supply', 'demand', 'inflation', 'gdp', 'trade'], subject: 'Economics' },
];

function uniqueValues(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferSubjectSuggestions(text: string) {
  const normalized = text.toLowerCase();
  return subjectKeywordMap
    .filter((item) => item.keywords.some((keyword) => normalized.includes(keyword)))
    .map((item) => item.subject);
}

function formatSize(size?: number) {
  if (!size) {
    return 'Unknown size';
  }

  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function inferType(source: SourceRecord) {
  const lowerTitle = source.title.toLowerCase();

  if (source.mimeType.includes('pdf') || lowerTitle.endsWith('.pdf')) {
    return 'PDF';
  }

  if (lowerTitle.endsWith('.ppt') || lowerTitle.endsWith('.pptx')) {
    return 'Lecture slides';
  }

  if (lowerTitle.endsWith('.doc') || lowerTitle.endsWith('.docx')) {
    return 'Document';
  }

  if (source.mimeType.includes('text')) {
    return 'Text notes';
  }

  if (source.mimeType.startsWith('image/')) {
    return 'Image';
  }

  return 'Study material';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stageLabel(source: SourceRecord) {
  if (source.status === 'ready') return 'Ready for review';
  if (source.status === 'needs_ocr') return 'Needs OCR';
  if (source.status === 'failed') return 'Failed';

  const labels: Record<SourceRecord['stage'], string> = {
    chunk: 'Chunking text',
    complete: 'Ready for review',
    embed: 'Reading key ideas',
    extract_text: 'Extracting text',
    failed: 'Failed',
    generate: 'Generating study pack',
    metadata: 'Preparing upload',
    ocr: 'Waiting for OCR',
    upload: 'Uploading file',
  };

  return labels[source.stage];
}

function countAssets(source: SourceRecord, assets: GeneratedAssetRecord[]) {
  const asset = assets.find((item) => item.sourceId === source.id);

  return {
    flashcards: asset?.content.flashcards.length ?? 0,
    notes: asset?.content.detailed_notes.length ?? 0,
    quizzes: asset?.content.quiz.length ?? 0,
  };
}

function sourceRank(source: SourceRecord) {
  const updatedAt = new Date(source.updatedAt).getTime();
  return {
    progress: source.progress,
    updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
  };
}

function dedupeSources(sources: SourceRecord[]) {
  const byId = new Map<string, SourceRecord>();

  for (const source of sources) {
    const existing = byId.get(source.id);
    if (!existing) {
      byId.set(source.id, source);
      continue;
    }

    const existingRank = sourceRank(existing);
    const nextRank = sourceRank(source);
    if (
      nextRank.updatedAt > existingRank.updatedAt ||
      (nextRank.updatedAt === existingRank.updatedAt && nextRank.progress >= existingRank.progress)
    ) {
      byId.set(source.id, source);
    }
  }

  return [...byId.values()].sort((first, second) => sourceRank(second).updatedAt - sourceRank(first).updatedAt);
}

function mergeRemoteWithLocalDiagnostics(remoteSources: SourceRecord[], localSources: SourceRecord[]) {
  const localById = new Map(localSources.map((source) => [source.id, source]));

  return dedupeSources(remoteSources.map((remoteSource) => {
    const localSource = localById.get(remoteSource.id);
    if (localSource?.status === 'failed' && localSource.error && remoteSource.status !== 'ready' && !remoteSource.error) {
      return {
        ...remoteSource,
        error: localSource.error,
        stage: 'failed',
        status: 'failed',
      };
    }

    return remoteSource;
  }));
}

function buildStudyTitle(subject: string, topic: string) {
  const nextSubject = subject.trim();
  const nextTopic = topic.trim();

  if (nextSubject && nextTopic) return `${nextSubject} - ${nextTopic}`;
  return nextSubject || nextTopic;
}

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 520;
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [assets, setAssets] = useState<GeneratedAssetRecord[]>([]);
  const [subject, setSubject] = useState('');
  const [isSubjectPickerOpen, setIsSubjectPickerOpen] = useState(false);
  const [isCustomSubjectOpen, setIsCustomSubjectOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(
    hasSupabaseConfig()
      ? 'Ready for PDFs, slides, docs, or notes.'
      : 'Connect Supabase to upload files.'
  );

  const searchDocuments = useMemo(() => {
    const assetBySourceId = new Map<string, GeneratedAssetRecord[]>();
    for (const asset of assets) {
      const list = assetBySourceId.get(asset.sourceId) ?? [];
      list.push(asset);
      assetBySourceId.set(asset.sourceId, list);
    }

    return sources.map((source) => {
      const matchedAssets = assetBySourceId.get(source.id) ?? [];
      const contentParts: string[] = [
        source.title,
        source.subject ?? '',
        source.topic ?? '',
        inferType(source),
      ];

      for (const asset of matchedAssets) {
        if (asset.title && asset.title !== source.title) {
          contentParts.push(asset.title);
        }
        if (asset.content) {
          if (asset.content.summary) {
            contentParts.push(asset.content.summary);
          }
          if (Array.isArray(asset.content.detailed_notes)) {
            contentParts.push(...asset.content.detailed_notes);
          }
          if (Array.isArray(asset.content.flashcards)) {
            for (const card of asset.content.flashcards) {
              contentParts.push(card.front, card.back);
            }
          }
          if (Array.isArray(asset.content.quiz)) {
            for (const q of asset.content.quiz) {
              contentParts.push(q.question, ...q.choices, q.answer);
            }
          }
          if (Array.isArray(asset.content.weak_topics)) {
            contentParts.push(...asset.content.weak_topics);
          }
        }
      }

      return {
        id: source.id,
        title: source.title,
        text: contentParts.filter(Boolean).join(' '),
      };
    });
  }, [sources, assets]);

  const {
    results,
    query,
    setQuery,
    mode,
    setMode,
    feedbackModel,
    setFeedbackModel,
    submitFeedback,
    clearFeedback,
    hasFeedback,
    relevantDocs,
    nonRelevantDocs,
  } = useDocumentSearch(searchDocuments, 'hybrid');

  // Auto-reformulate query when a document is marked relevant
  const handleMarkRelevant = useCallback((docId: string) => {
    const currentDocIds = results.map((r) => r.docId);
    submitFeedback(docId, true, currentDocIds);

    // Immediately reformulate query using relevance feedback
    const newRelevantIds = [...new Set([...relevantDocs, docId])];
    const newNonRelevantIds = currentDocIds.filter((id) => id !== docId && !relevantDocs.includes(id));

    if (newRelevantIds.length > 0) {
      const reformulated = buildReformulatedQuery(
        query,
        newRelevantIds.map((id) => ({
          docId: id,
          vector: new Map(
            (searchDocuments.find((doc) => doc.id === id)?.text
              .toLowerCase()
              .match(/\w+/g) ?? []).map((term) => [term, 1] as [string, number])
          ),
        })),
        newNonRelevantIds.map((id) => ({
          docId: id,
          vector: new Map(
            (searchDocuments.find((doc) => doc.id === id)?.text
              .toLowerCase()
              .match(/\w+/g) ?? []).map((term) => [term, 1] as [string, number])
          ),
        })),
        feedbackModel
      );
      setQuery(reformulated);
    }
  }, [results, relevantDocs, query, feedbackModel, submitFeedback, setQuery, searchDocuments]);

  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const filteredSources = useMemo(() => {
    if (!query.trim()) return dedupeSources(sources);
    const ids = new Set(results.map((r) => r.docId));
    if (ids.size === 0) return [];
    return dedupeSources(sources.filter((source) => ids.has(source.id)));
  }, [results, sources, query]);

  const loadLocal = useCallback(async () => {
    const [cachedSources, cachedAssets] = await Promise.all([
      listCachedSources(),
      listCachedAssets(),
    ]);

    setSources(dedupeSources(cachedSources));
    setAssets(cachedAssets);
  }, []);

  const refresh = useCallback(async () => {
    await loadLocal();

    if (!hasSupabaseConfig()) {
      return;
    }

    try {
      const nextState = await refreshParsingState();
      setSources((current) => dedupeSources(mergeRemoteWithLocalDiagnostics(nextState.sources, current)));
      setAssets(nextState.assets);
      setUploadMessage('Library updated.');
    } catch {
      // Keep local cached state if remote refresh fails
    }
  }, [loadLocal]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  const generatedTotals = useMemo(
    () =>
      assets.reduce(
        (totals, asset) => ({
          notes: totals.notes + asset.content.detailed_notes.length,
          flashcards: totals.flashcards + asset.content.flashcards.length,
          quizzes: totals.quizzes + asset.content.quiz.length,
        }),
        { notes: 0, flashcards: 0, quizzes: 0 }
      ),
    [assets]
  );

  const parsingCount = sources.filter(
    (source) => source.status === 'queued' || source.status === 'uploading' || source.status === 'processing'
  ).length;
  const subjectOptions = useMemo(() => {
    const existingSubjects = sources.map((source) => source.subject ?? '');
    const suggestionText = [
      topic,
      pastedText,
      query,
      ...sources.map((source) => `${source.title} ${source.topic ?? ''}`),
    ].join(' ');

    return uniqueValues([
      ...inferSubjectSuggestions(suggestionText),
      ...existingSubjects,
      ...commonSubjects,
    ]).slice(0, 16);
  }, [pastedText, query, sources, topic]);

  function makeTextFile() {
    const text = pastedText.trim();
    if (text.length < 50) return null;

    const title = `${buildStudyTitle(subject, topic) || 'Pasted notes'}.txt`;
    if (typeof File !== 'undefined') {
      return {
        file: new File([text], title, { type: 'text/plain' }),
        mimeType: 'text/plain',
        name: title,
        size: text.length,
      };
    }

    return {
      mimeType: 'text/plain',
      name: title,
      size: text.length,
      uri: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    };
  }

  async function chooseFiles(includeFilePicker = true) {
    if (!hasSupabaseConfig()) {
      setUploadMessage('Connect Supabase first, then restart the app.');
      return;
    }

    setIsBusy(true);
    try {
      const files = includeFilePicker ? await pickStudyFiles() : [];
      const textFile = makeTextFile();
      const uploadFiles = textFile ? [...files, textFile] : files;
      const uploadTitle = buildStudyTitle(subject, topic);

      if (uploadFiles.length === 0) {
        setUploadMessage(
          pastedText.trim().length > 0
            ? 'Paste at least 50 characters, or choose a file.'
            : 'No files selected.'
        );
        return;
      }

      const results = await uploadAndProcessFiles(uploadFiles, {
        subject: subject.trim(),
        title: uploadTitle || undefined,
        topic: topic.trim(),
      });
      setIsSubjectPickerOpen(false);
      setIsCustomSubjectOpen(false);
      setSources((current) => dedupeSources([...results.map((result) => result.source), ...current]));
      const failedResults = results.filter((result) => result.source.status === 'failed');
      setUploadMessage(
        failedResults.length > 0
          ? failedResults[0].source.error ?? 'Upload succeeded, but processing did not start.'
          : `${uploadFiles.length} source${uploadFiles.length === 1 ? '' : 's'} uploaded and queued.`
      );
      if (failedResults.length === 0) {
        if (!includeFilePicker && textFile) {
          setPastedText('');
        }
        await refresh();
      }
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function retrySource(sourceId: string) {
    if (!hasSupabaseConfig()) {
      setUploadMessage('Connect Supabase first, then restart the app.');
      return;
    }

    setIsBusy(true);
    try {
      await startProcessing(sourceId);
      setUploadMessage('Processing restarted for that source.');
      await refresh();
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Could not restart processing.');
    } finally {
      setIsBusy(false);
    }
  }

  async function removeSource(sourceId: string) {
    setIsBusy(true);
    try {
      if (hasSupabaseConfig() && !sourceId.startsWith('fixture-')) {
        await deleteSource(sourceId);
      }
      await removeCachedSource(sourceId);
      setSources((current) => dedupeSources(current.filter((source) => source.id !== sourceId)));
      setAssets((current) => current.filter((asset) => asset.sourceId !== sourceId));
      setUploadMessage('Upload deleted.');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Could not delete upload.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <StudyScreen
      eyebrow="Library"
      title="Add your study materials"
      subtitle="Upload notes, PDFs, slides, or docs. Nudge turns them into study tools.">
      <View style={styles.grid}>
        <StudyCard style={[styles.uploadCard, styles.uploadSurface, isCompact && styles.uploadCardCompact]}>
          <View style={[styles.accentStrip, { backgroundColor: theme.brandMint }]} />
          <ThemedText type="caption">Upload</ThemedText>
          <ThemedText type="subtitle">Choose a file</ThemedText>
          <ThemedText type="small">
            We’ll read it and make summaries, notes, flashcards, and quizzes.
          </ThemedText>
          <View style={styles.metadataGrid}>
            <View style={styles.inputGroup}>
              <ThemedText type="smallBold">Subject</ThemedText>
              <Pressable
                onPress={() => setIsSubjectPickerOpen((current) => !current)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  style={[
                    styles.subjectSelect,
                    {
                      backgroundColor: theme.card,
                      borderColor: isSubjectPickerOpen ? theme.primary : theme.hairline,
                    },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={!subject ? { color: theme.textSecondary } : undefined}>
                    {subject || 'Choose subject'}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>
                    {isSubjectPickerOpen ? 'Close' : 'Pick'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {isSubjectPickerOpen && (
                <ThemedView type="backgroundElement" style={styles.subjectPanel}>
                  <View style={styles.subjectChipGrid}>
                    {subjectOptions.map((option) => {
                      const isSelected = option.toLowerCase() === subject.trim().toLowerCase();

                      return (
                        <Pressable
                          key={option}
                          onPress={() => {
                            setSubject(option);
                            setIsCustomSubjectOpen(false);
                            setIsSubjectPickerOpen(false);
                          }}
                          style={({ pressed }) => pressed && styles.pressed}>
                          <ThemedView
                            type={isSelected ? 'backgroundSelected' : 'card'}
                            style={[
                              styles.subjectChip,
                              { borderColor: isSelected ? theme.primary : theme.hairline },
                            ]}>
                            <ThemedText type="smallBold">{option}</ThemedText>
                          </ThemedView>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => setIsCustomSubjectOpen((current) => !current)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView
                        type="card"
                        style={[styles.subjectChip, { borderColor: theme.primary }]}>
                        <ThemedText type="smallBold">Custom</ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                  {isCustomSubjectOpen && (
                    <TextInput
                      value={subject}
                      onChangeText={setSubject}
                      placeholder="Type a subject"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.textInput,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.hairline,
                          color: theme.text,
                        },
                      ]}
                      returnKeyType="done"
                    />
                  )}
                </ThemedView>
              )}
            </View>
            <View style={styles.inputGroup}>
              <ThemedText type="smallBold">Topic</ThemedText>
              <TextInput
                value={topic}
                onChangeText={setTopic}
                placeholder="Reproduction"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.hairline,
                    color: theme.text,
                  },
                ]}
                returnKeyType="done"
              />
            </View>
          </View>
          <ThemedView style={[styles.uploadDropzone, { borderColor: theme.primary }]}>
            <ThemedText type="sectionTitle">Ready when you are</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {uploadMessage}
            </ThemedText>
          </ThemedView>
          <View style={styles.inputGroup}>
            <ThemedText type="smallBold">Paste notes instead</ThemedText>
            <TextInput
              multiline
              value={pastedText}
              onChangeText={setPastedText}
              placeholder="Paste lecture notes or textbook text here..."
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.textArea,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.hairline,
                  color: theme.text,
                },
              ]}
            />
          </View>
          <View style={styles.buttonRow}>
            <ActionButton
              label={isBusy ? 'Uploading...' : 'Choose file'}
              onPress={() => {
                void chooseFiles();
              }}
            />
            <ActionButton
              label="Upload pasted notes"
              variant="secondary"
              disabled={isBusy || pastedText.trim().length < 50}
              onPress={() => chooseFiles(false)}
            />
            <ActionButton label="Refresh" variant="secondary" onPress={refresh} />
          </View>
          <ActionButton
            label="View study tools"
            variant="secondary"
            style={styles.fullWidthAction}
            onPress={() => router.push('/assets')}
          />
        </StudyCard>

        <StudyCard style={styles.statusCard}>
          <SectionHeader title="Study Tools" detail={`${parsingCount} being prepared`} />
          <View style={styles.assetGrid}>
            <View style={styles.assetRow}>
              <ThemedText type="metric">{generatedTotals.notes}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                notes
              </ThemedText>
            </View>
            <View style={styles.assetRow}>
              <ThemedText type="metric">{generatedTotals.flashcards}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                flashcards
              </ThemedText>
            </View>
            <View style={styles.assetRow}>
              <ThemedText type="metric">{generatedTotals.quizzes}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                quizzes
              </ThemedText>
            </View>
          </View>
        </StudyCard>
      </View>

      <StudyCard>
        <SectionHeader title="Recent Uploads" detail="Search with IR techniques." />
        <View style={styles.searchBar}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by title, subject, topic, or concept"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.textInput,
              {
                backgroundColor: theme.card,
                borderColor: theme.hairline,
                color: theme.text,
              },
            ]}
          />
          {hasFeedback ? (
            <ActionButton
              label="Clear Feedback"
              variant="secondary"
              style={styles.compactButton}
              onPress={clearFeedback}
            />
          ) : null}
        </View>
        <View style={styles.modeGrid}>
          {(
            [
              ['hybrid', 'Hybrid'],
              ['exact', 'Exact'],
              ['prefix', 'Prefix'],
              ['suffix', 'Suffix'],
              ['fuzzy', 'Fuzzy'],
              ['boolean', 'Boolean'],
              ['vsm', 'VSM'],
            ] as Array<[SearchMode, string]>
          ).map(([modeValue, label]) => (
            <Pressable
              key={modeValue}
              onPress={() => setMode(modeValue)}
              style={({ pressed }) => [
                styles.modeButton,
                mode === modeValue && { borderColor: theme.primary, backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">{label}</ThemedText>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setFeedbackModel(feedbackModel === 'rocchio' ? 'ide_regular' : feedbackModel === 'ide_regular' ? 'ide_dec_hi' : 'rocchio')}
            style={({ pressed }) => [
              styles.modeButton,
              { borderColor: theme.primary },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Feedback: {feedbackModel === 'rocchio' ? 'Rocchio' : feedbackModel === 'ide_regular' ? 'IDE Reg' : 'IDE DecHi'}</ThemedText>
          </Pressable>
        </View>
        {Boolean(query.trim()) && results.length > 0 ? (
          <View style={styles.resultsList}>
            <SectionHeader
              title="IR Results"
              detail={`${results.length} ranked · click to mark relevant`}
            />
            {results.slice(0, 5).map((result, index) => {
              const isRelevant = relevantDocs.includes(result.docId);
              const isNotRelevant = nonRelevantDocs.includes(result.docId);
              return (
                <Pressable
                  key={result.docId}
                  onPress={() => handleMarkRelevant(result.docId)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type="backgroundElement"
                    style={[
                      styles.resultRow,
                      isRelevant && { borderWidth: 1.5, borderColor: theme.success },
                      isNotRelevant && { opacity: 0.55 },
                    ]}>
                    <View style={styles.resultHeader}>
                      <ThemedText type="smallBold" style={{ flex: 1 }}>{result.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">#{index + 1} · {result.score.toFixed(3)}</ThemedText>
                    </View>
                    {result.retrievedBy.length > 0 ? (
                      <View style={styles.modeBadgeRow}>
                        {result.retrievedBy.map((m) => (
                          <ThemedView key={m} style={[styles.modeBadge, { backgroundColor: modeColors[m] ?? theme.primary + '22' }]}>
                            <ThemedText type="small" style={{ color: modeColors[m] ? '#fff' : theme.primary, fontWeight: '700', fontSize: 10 }}>{m.toUpperCase()}</ThemedText>
                          </ThemedView>
                        ))}
                        {isRelevant ? (
                          <ThemedView style={[styles.modeBadge, { backgroundColor: theme.success }]}>
                            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700', fontSize: 10 }}>✓ RELEVANT</ThemedText>
                          </ThemedView>
                        ) : null}
                      </View>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      {result.matchedTerms.length > 0 ? `Matches: ${result.matchedTerms.slice(0, 4).join(', ')}` : 'Conceptual match'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {filteredSources.length === 0 ? (
          <ThemedView type="backgroundElement" style={styles.emptyState}>
            <ThemedText type="smallBold">
              {sources.length === 0 ? 'Your library is empty' : 'No matching uploads'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {sources.length === 0
                ? 'Upload a file or paste notes to create your first study pack.'
                : 'Try a different title, subject, or topic.'}
            </ThemedText>
          </ThemedView>
        ) : filteredSources.map((source) => {
          const sourceAssets = countAssets(source, assets);

          return (
            <ThemedView
              key={source.id}
              type="backgroundElement"
              style={[styles.sourceRow, isCompact && styles.sourceRowCompact]}>
              <View style={styles.sourceCopy}>
                <ThemedText type="smallBold">{source.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {inferType(source)} - {formatSize(source.size)} - {formatDate(source.createdAt)}
                </ThemedText>
                {Boolean(source.subject || source.topic) ? (
                  <View style={styles.tagRow}>
                    {source.subject ? (
                      <ThemedView type="backgroundSelected" style={styles.labelPill}>
                        <ThemedText type="smallBold">{source.subject}</ThemedText>
                      </ThemedView>
                    ) : null}
                    {source.topic ? (
                      <ThemedView type="backgroundElement" style={styles.labelPill}>
                        <ThemedText type="smallBold">{source.topic}</ThemedText>
                      </ThemedView>
                    ) : null}
                  </View>
                ) : null}
                {Boolean(source.error) ? (
                  <ThemedText type="smallBold" style={{ color: theme.error }}>
                    {source.error}
                  </ThemedText>
                ) : null}
                <ThemedView style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${source.progress}%`,
                        backgroundColor:
                          source.status === 'ready' ? theme.success : theme.brandCoral,
                      },
                    ]}
                  />
                </ThemedView>
              </View>
              <View style={styles.sourceMeta}>
                <View style={styles.sourceMetaTop}>
                  <ThemedView
                    type={source.status === 'ready' ? 'backgroundSelected' : 'cardStrong'}
                    style={styles.statusPill}>
                    <ThemedText type="smallBold">{stageLabel(source)}</ThemedText>
                  </ThemedView>
                  <ThemedText type="small" themeColor="textSecondary">
                    {sourceAssets.notes} notes / {sourceAssets.flashcards} cards /{' '}
                    {sourceAssets.quizzes} quizzes
                  </ThemedText>
                </View>
                <View style={styles.sourceActions}>
                   {Boolean(source.status === 'failed' || source.status === 'needs_ocr') ? (
                     <ActionButton
                       label={source.status === 'needs_ocr' ? 'Retry OCR' : 'Retry'}
                       variant="secondary"
                       onPress={() => retrySource(source.id)}
                     />
                   ) : null}
                   <ActionButton
                     label="Delete"
                     variant="secondary"
                     onPress={() => removeSource(source.id)}
                   />
                 </View>
              </View>
            </ThemedView>
          );
        })}
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
  uploadCard: {
    flexGrow: 2,
    flexBasis: 320,
    minWidth: 0,
    overflow: 'hidden',
  },
  uploadCardCompact: {
    gap: Spacing.three,
  },
  uploadSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    boxShadow: '0 20px 56px rgba(96, 165, 250, 0.12), 0 0 42px rgba(164, 212, 197, 0.18)',
  },
  accentStrip: {
    borderRadius: 999,
    height: 6,
    width: 92,
  },
  uploadDropzone: {
    borderWidth: 1,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderStyle: 'dashed',
    gap: Spacing.one,
    padding: Spacing.four,
  },
  metadataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  inputGroup: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  subjectSelect: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    width: '100%',
  },
  subjectPanel: {
    borderRadius: 18,
    borderCurve: 'continuous',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  subjectChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  subjectChip: {
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  textInput: {
    borderCurve: 'continuous',
    borderRadius: 18,
    borderWidth: 1,
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontSize: 15,
    fontWeight: '700',
    minHeight: 50,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    width: '100%',
  },
  textArea: {
    borderCurve: 'continuous',
    borderRadius: 18,
    borderWidth: 1,
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontSize: 15,
    fontWeight: '600',
    minHeight: 112,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    textAlignVertical: 'top',
    width: '100%',
  },
  statusCard: {
    flexGrow: 1,
    flexBasis: 260,
    minWidth: 0,
  },
  assetGrid: {
    gap: Spacing.three,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  searchBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  compactButton: {
    minHeight: 42,
    paddingHorizontal: Spacing.three,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  modeButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  modeButtonSelected: {
    backgroundColor: 'transparent',
  },
  feedbackButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  resultsList: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  resultRow: {
    borderRadius: 16,
    borderCurve: 'continuous',
    padding: Spacing.three,
    gap: Spacing.one,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  fullWidthAction: {
    alignSelf: 'flex-start',
  },
  assetRow: {
    gap: Spacing.one,
  },
  sourceRow: {
    borderRadius: 20,
    borderCurve: 'continuous',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.three,
    justifyContent: 'flex-start',
    padding: Spacing.four,
    minWidth: 0,
  },
  sourceRowCompact: {
    padding: Spacing.four,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.three,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(10, 10, 10, 0.12)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  labelPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  sourceMeta: {
    alignItems: 'flex-start',
    gap: Spacing.three,
    minWidth: 0,
    width: '100%',
  },
  sourceMetaTop: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: Spacing.one,
  },
  sourceActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  emptyState: {
    borderRadius: 22,
    borderCurve: 'continuous',
    gap: Spacing.one,
    padding: Spacing.four,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  modeBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  modeBadge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pressed: {
    opacity: 0.78,
  },
});
