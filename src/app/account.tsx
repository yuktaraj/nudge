import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ActionButton, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { hasSupabaseConfig } from '@/lib/env';

export default function AccountScreen() {
  const theme = useTheme();
  const { createRecoveryCode, redeemRecoveryCode, session, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  async function generateCode() {
    setIsBusy(true);
    setMessage('');
    try {
      const result = await createRecoveryCode();
      setGeneratedCode(result.code);
      setExpiresAt(new Date(result.expiresAt).toLocaleDateString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create a recovery code.');
    } finally {
      setIsBusy(false);
    }
  }

  async function redeemCode() {
    if (!code.trim()) {
      setMessage('Enter a recovery code first.');
      return;
    }
    setIsBusy(true);
    setMessage('');
    try {
      await redeemRecoveryCode(code);
      setMessage('This device is now connected to your synced study data.');
      setCode('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not redeem that code.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <StudyScreen
      eyebrow="Account"
      title="Account & Sync"
      subtitle="Keep your study materials available on another device without creating an email account.">
      <StudyCard style={styles.card}>
        <ThemedText type="sectionTitle">Current device</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {session?.user.email ? `Signed in as ${session.user.email}` : 'Using local study storage'}
        </ThemedText>
        {hasSupabaseConfig() ? (
          <>
            <ActionButton
              label={isBusy ? 'Please wait...' : 'Generate recovery code'}
              onPress={generateCode}
              disabled={isBusy}
            />
            {generatedCode ? (
              <View style={[styles.codePanel, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="caption" themeColor="textSecondary">Your one-time recovery code</ThemedText>
                <ThemedText type="metric" style={styles.code}>{generatedCode}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Enter this code on your other device. It expires on {expiresAt} and should be kept private.
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.divider} />
            <ThemedText type="sectionTitle">Connect another device</ThemedText>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.hairline, color: theme.text }]}
            />
            <ActionButton label="Use recovery code" variant="secondary" onPress={redeemCode} disabled={isBusy} />
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Sync is unavailable in local-only mode. Configure your developer-owned Supabase project to enable it.
          </ThemedText>
        )}
        {message ? <ThemedText type="small" style={{ color: theme.primary }}>{message}</ThemedText> : null}
        <ActionButton label="Sign out" variant="secondary" onPress={signOut} />
      </StudyCard>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    maxWidth: 640,
    width: '100%',
  },
  code: {
    letterSpacing: 2,
  },
  codePanel: {
    borderRadius: 18,
    gap: Spacing.one,
    padding: Spacing.four,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: Spacing.one,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
