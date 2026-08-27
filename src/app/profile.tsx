import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ActionButton, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteExamPlan, loadExamPlans, saveExamPlan, type ExamPlan } from '@/lib/exam-proximity';
import { loadStudyReviewState } from '@/lib/study-review-loader';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.background === '#07111F';

  const [email, setEmail] = useState<string | null>('Loading...');
  const [name, setName] = useState<string | null>('');
  const [examCourse, setExamCourse] = useState('');
  const [examDate, setExamDate] = useState('');
  const [targetRecall, setTargetRecall] = useState(0.9);
  const [examMessage, setExamMessage] = useState('');
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [savedExamPlans, setSavedExamPlans] = useState<ExamPlan[]>([]);
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);

  useEffect(() => {
    loadExamPlans().then((plans) => {
      setSavedExamPlans(plans);
    });
    loadStudyReviewState().then(({ reviewCards, sources }) => {
      const subjects = new Set([
        ...reviewCards.map((card) => card.course),
        ...sources.map((source) => source.course).filter((course): course is string => Boolean(course)),
      ]);
      setAvailableSubjects([...subjects].sort());
    });
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? 'No email found');
        setName(user.user_metadata?.full_name ?? 'Student');
      } else {
        setEmail('Not logged in');
      }
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    
    // Force a clean reload on web to unmount tabs, or normal route replace on mobile
    if (Platform.OS === 'web') {
      window.location.href = '/login';
    } else {
      router.replace('/login');
    }
  };

  const handleSaveExam = async () => {
    const parsedDate = new Date(`${examDate}T23:59:59`);
    if (!availableSubjects.includes(examCourse)) {
      setExamMessage('Select a subject for the exam.');
      return;
    }
    if (!examDate || Number.isNaN(parsedDate.getTime())) {
      setExamMessage('Select an exam date.');
      return;
    }
    const plan: ExamPlan = { course: examCourse, examDate, targetRecall };
    await saveExamPlan(plan);
    setSavedExamPlans(await loadExamPlans());
    setExamCourse('');
    setExamDate('');
    setExamMessage('Exam plan saved.');
  };

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS !== 'ios') setIsDatePickerVisible(false);
    if (selectedDate) {
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      setExamDate(`${year}-${month}-${day}`);
    }
  };

  const handleClearExam = () => {
    setExamCourse('');
    setExamDate('');
    setExamMessage('Form cleared. Saved exam plans are unchanged.');
  };

  const handleDeleteExam = async (plan: ExamPlan) => {
    await deleteExamPlan(plan);
    setSavedExamPlans(await loadExamPlans());
    setExamMessage('Exam plan deleted.');
  };

  return (
    <StudyScreen
      eyebrow="Account"
      title="Your Profile"
      subtitle="View your session details and manage your account."
    >
      <View style={styles.grid}>
        <StudyCard style={[styles.column, styles.glowCard, isDark && styles.glowCardDark]}>
          <ThemedText type="caption" themeColor="textSecondary">Exam proximity mode</ThemedText>
          <ThemedText type="small">Add exams to prioritize high-yield review within seven days of each exam.</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Subject</ThemedText>
          <View style={styles.subjectWrap}>
            {availableSubjects.length > 0 ? availableSubjects.map((subject) => {
              const isSelected = subject === examCourse;
              return (
                <Pressable
                  key={subject}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setExamCourse(subject)}
                  style={[
                    styles.subjectOption,
                    { backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement, borderColor: isSelected ? theme.primary : theme.hairline },
                  ]}>
                  <ThemedText type="smallBold">{subject}</ThemedText>
                </Pressable>
              );
            }) : (
              <ThemedText type="small" themeColor="textSecondary">Add study material before setting an exam.</ThemedText>
            )}
          </View>
          <ThemedText type="caption" themeColor="textSecondary">Exam date</ThemedText>
          {Platform.OS === 'web' ? (
            React.createElement('input', {
              type: 'date',
              value: examDate,
              min: new Date().toISOString().slice(0, 10),
              'aria-label': 'Exam date',
              onChange: (event: { target: { value: string } }) => setExamDate(event.target.value),
              style: {
                ...StyleSheet.flatten(styles.textInput),
                color: theme.text,
                borderColor: theme.hairline,
                backgroundColor: theme.backgroundElement,
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                fontSize: 16,
              },
            })
          ) : (
            <>
              <Pressable
                onPress={() => setIsDatePickerVisible(true)}
                style={[styles.dateButton, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline }]}>
                <ThemedText type="smallBold">{examDate || 'Select exam date'}</ThemedText>
              </Pressable>
              {isDatePickerVisible ? (
                <DateTimePicker
                  value={examDate ? new Date(`${examDate}T12:00:00`) : new Date()}
                  mode="date"
                  display="calendar"
                  minimumDate={new Date()}
                  onChange={handleDateChange}
                />
              ) : null}
            </>
          )}
          <ThemedText type="caption" themeColor="textSecondary">Mastery threshold</ThemedText>
          <ThemedText type="small">Set the recall goal you want to reach before this exam.</ThemedText>
          <View style={styles.subjectWrap}>
            {[0.8, 0.85, 0.9, 0.95].map((threshold) => {
              const isSelected = threshold === targetRecall;
              return (
                <Pressable
                  key={threshold}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setTargetRecall(threshold)}
                  style={[styles.subjectOption, { backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement, borderColor: isSelected ? theme.primary : theme.hairline }]}>
                  <ThemedText type="smallBold">{Math.round(threshold * 100)}%</ThemedText>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.buttonRow}>
            <ActionButton label="Save exam" onPress={handleSaveExam} />
            <ActionButton label="Clear" variant="secondary" onPress={handleClearExam} />
          </View>
          {examMessage ? <ThemedText type="small" themeColor="textSecondary">{examMessage}</ThemedText> : null}
          {savedExamPlans.length > 0 ? (
            <View style={styles.savedPlans}>
              <ThemedText type="caption" themeColor="textSecondary">Saved exams</ThemedText>
              {savedExamPlans.map((plan) => (
                <View key={`${plan.course}-${plan.examDate}`} style={styles.savedPlanRow}>
                  <View style={styles.savedPlanCopy}>
                    <ThemedText type="smallBold">{plan.course}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{plan.examDate.slice(0, 10)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Goal: {Math.round(plan.targetRecall * 100)}% recall</ThemedText>
                  </View>
                  <ActionButton label="Delete" variant="secondary" onPress={() => handleDeleteExam(plan)} />
                </View>
              ))}
            </View>
          ) : null}
        </StudyCard>
        <StudyCard style={[styles.column, styles.glowCard, isDark && styles.glowCardDark]}>
          {name ? (
            <View style={styles.infoRow}>
              <ThemedText type="smallBold" themeColor="textSecondary">Full Name</ThemedText>
              <ThemedText type="default">{name}</ThemedText>
            </View>
          ) : null}

          <View style={[styles.infoRow, { marginBottom: Spacing.four }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">Email Address</ThemedText>
            <ThemedText type="default">{email}</ThemedText>
          </View>

          <ActionButton
            label="Sign Out"
            variant="secondary"
            onPress={handleSignOut}
          />
        </StudyCard>
      </View>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  grid: { alignSelf: 'center', alignItems: 'stretch', flexDirection: 'column', gap: Spacing.three, maxWidth: 720, width: '100%' },
  column: { minWidth: 0, width: '100%' },
  glowCard: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' },
  glowCardDark: { boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)' },
  infoRow: { marginBottom: Spacing.three, gap: Spacing.one },
  textInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, marginTop: Spacing.one },
  dateButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, marginTop: Spacing.one },
  subjectWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  subjectOption: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  savedPlans: { gap: Spacing.one, marginTop: Spacing.three },
  savedPlanRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  savedPlanCopy: { flex: 1, gap: 2 },
});