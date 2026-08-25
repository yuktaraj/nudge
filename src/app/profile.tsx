import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ActionButton, StudyCard } from '@/components/study-card';
import { StudyScreen } from '@/components/study-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.background === '#07111F';

  const [email, setEmail] = useState<string | null>('Loading...');
  const [name, setName] = useState<string | null>('');

  useEffect(() => {
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

  return (
    <StudyScreen
      eyebrow="Account"
      title="Your Profile"
      subtitle="View your session details and manage your account."
    >
      <View style={styles.grid}>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
  glowCard: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' },
  glowCardDark: { boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)' },
  infoRow: { marginBottom: Spacing.three, gap: Spacing.one },
});