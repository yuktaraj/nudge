import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ActionButton, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

export default function AuthScreen() {
  const theme = useTheme();
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    if (!email.trim() || password.length < 6) {
      setMessage('Enter an email and a password with at least 6 characters.');
      return;
    }

    setIsBusy(true);
    setMessage('');
    try {
      if (isCreatingAccount) await signUp(email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not authenticate.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <StudyScreen
      eyebrow="Nudge"
      title={isCreatingAccount ? 'Create your account' : 'Welcome back'}
      subtitle="Sign in to keep your study materials, reviews, and progress available on every device.">
      <StudyCard style={styles.card}>
        <View style={styles.form}>
          <View style={styles.field}>
            <ThemedText type="caption" themeColor="textSecondary">Email</ThemedText>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            />
          </View>
          <View style={styles.field}>
            <ThemedText type="caption" themeColor="textSecondary">Password</ThemedText>
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            />
          </View>
          {message ? <ThemedText type="small" style={{ color: theme.error }}>{message}</ThemedText> : null}
          <ActionButton
            label={isBusy ? 'Please wait...' : isCreatingAccount ? 'Create account' : 'Sign in'}
            onPress={submit}
          />
          <ActionButton
            label={isCreatingAccount ? 'I already have an account' : 'Create a new account'}
            variant="secondary"
            onPress={() => {
              setIsCreatingAccount((current) => !current);
              setMessage('');
            }}
          />
        </View>
      </StudyCard>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: 560,
    width: '100%',
  },
  field: {
    gap: Spacing.one,
  },
  form: {
    gap: Spacing.three,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
