import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.background === '#07111F';

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Missing Fields', 'Please fill in both email and password.');
      return;
    }

    setLoading(true);
    
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Login Failed', error.message);
    } else {
      router.replace('/'); 
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || (isSignUp && !fullName)) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    setLoading(false);

    if (error) {
      Alert.alert('Registration Error', error.message);
    } else {
      Alert.alert('Success', 'Account created! You can now sign in.');
      setIsSignUp(false);
    }
  };

  return (
    <StudyScreen
      eyebrow="Authentication"
      title={isSignUp ? 'Create an Account' : 'Welcome to Nudge'}
      subtitle={
        isSignUp
          ? 'Sign up to start tracking your study modules and generating materials.'
          : 'Sign in to access your assigned courses and study blocks.'
      }
    >
      <View style={styles.grid}>
        <StudyCard style={[styles.column, styles.glowCard, isDark && styles.glowCardDark]}>
          
          {isSignUp && (
            <View style={styles.inputContainer}>
              <ThemedText type="smallBold" style={styles.label}>Full Name</ThemedText>
              <TextInput
                style={[styles.input, { borderColor: theme.textMuted, color: theme.text, backgroundColor: theme.background }]}
                placeholder="e.g. Alex Johnson"
                placeholderTextColor={theme.textSecondary}
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <ThemedText type="smallBold" style={styles.label}>Email Address</ThemedText>
            <TextInput
              style={[styles.input, { borderColor: theme.textMuted, color: theme.text, backgroundColor: theme.background }]}
              placeholder="student@example.com"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputContainer}>
            <ThemedText type="smallBold" style={styles.label}>Password</ThemedText>
            <TextInput
              style={[styles.input, { borderColor: theme.textMuted, color: theme.text, backgroundColor: theme.background }]}
              placeholder="••••••••"
              placeholderTextColor={theme.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <View style={styles.buttonRow}>
            <ActionButton 
              label={loading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Sign In')} 
              onPress={isSignUp ? handleSignUp : handleSignIn} 
            />
          </View>

          <View style={styles.buttonRow}>
            <ActionButton 
              label={isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"} 
              variant="secondary" 
              onPress={() => setIsSignUp(!isSignUp)} 
            />
          </View>
        </StudyCard>
      </View>
    </StudyScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
  glowCard: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' },
  glowCardDark: { boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)' },
  inputContainer: { marginBottom: Spacing.three },
  label: { marginBottom: Spacing.one },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  buttonRow: { marginTop: Spacing.two },
});