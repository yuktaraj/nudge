import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import React from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { FocusTimerProvider } from '@/components/focus-timer-controller';
import { ThemeControllerProvider, useThemeController } from '@/components/theme-controller';
import { AuthProvider, useAuth } from '@/lib/auth';

export default function TabLayout() {
  return (
    <ThemeControllerProvider>
      <ThemedShell />
    </ThemeControllerProvider>
  );
}

function ThemedShell() {
  const { mode } = useThemeController();

  return (
    <ThemeProvider value={mode === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AuthenticatedShell />
      </AuthProvider>
    </ThemeProvider>
  );
}

function AuthenticatedShell() {
  const { isLoading } = useAuth();

  if (isLoading) return null;

  return (
    <FocusTimerProvider>
      <AnimatedSplashOverlay />
      <AppTabs />
    </FocusTimerProvider>
  );
}
