import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const colors = useTheme();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      iconColor={{ default: colors.textSecondary, selected: colors.text }}
      indicatorColor={colors.backgroundSelected}
      labelStyle={{
        default: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
        selected: { color: colors.text, fontSize: 12, fontWeight: '700' },
      }}
      tintColor={colors.text}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'rectangle.grid.2x2', selected: 'rectangle.grid.2x2.fill' }}
          md="dashboard"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          md="library_books"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="assets">
        <NativeTabs.Trigger.Label>Assets</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'sparkles.rectangle.stack', selected: 'sparkles.rectangle.stack.fill' }}
          md="auto_awesome"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="study">
        <NativeTabs.Trigger.Label>Study</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'timer', selected: 'timer' }} md="timer" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reviews">
        <NativeTabs.Trigger.Label>Reviews</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'rectangle.stack', selected: 'rectangle.stack.fill' }}
          md="style"
        />
        <NativeTabs.Trigger.Badge selectedBackgroundColor={colors.brandPink}>
          26
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="account_circle"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
