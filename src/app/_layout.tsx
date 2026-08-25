import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Slot, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { FocusTimerProvider } from '@/components/focus-timer-controller';
import { ThemeControllerProvider, useThemeController } from '@/components/theme-controller';
import { supabase } from '@/lib/supabase';

export default function TabLayout() {
  return (
    <ThemeControllerProvider>
      <ThemedShell />
    </ThemeControllerProvider>
  );
}

function ThemedShell() {
  const { mode } = useThemeController();
  const segments = useSegments();
  
  // Check if the current route is the login screen
  const isLoginScreen = segments[0] === 'login';

  // We use `null` to represent "still checking" so the app doesn't flash the wrong screen
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // 1. Check if they have a session when the app first opens
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    // 2. Listen continuously for login/logout events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Wait until we know their auth status before rendering the app's UI
  if (isAuthenticated === null) {
    return null; 
  }

  // === THE GLOBAL AUTH GUARD ===
  // If they are NOT logged in and trying to view the app, force the URL to /login
  if (!isAuthenticated && !isLoginScreen) {
    return <Redirect href="/login" />;
  }
  
  // If they ARE logged in but try to go to the login page manually, force them to the dashboard
  if (isAuthenticated && isLoginScreen) {
    return <Redirect href="/" />;
  }

  return (
    <ThemeProvider value={mode === 'dark' ? DarkTheme : DefaultTheme}>
      <FocusTimerProvider>
        <AnimatedSplashOverlay />
        
        {/* If on the login screen, render it directly using <Slot />. Otherwise, render the standard AppTabs */}
        {isLoginScreen ? <Slot /> : <AppTabs />}
        
      </FocusTimerProvider>
    </ThemeProvider>
  );
}