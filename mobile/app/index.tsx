import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';

// The app's launch screen: waits for AuthProvider's initial SecureStore check, then redirects
// into either the signed-in Customer area or the auth flow. Nothing to tap here - it should
// only be visible for a brief moment.
export default function Index() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    // No-op effect placeholder kept simple on purpose - the actual redirect logic below
    // already reacts to isLoading/user changes via the component's own re-render.
  }, [isLoading, user]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>TalcTech Rooms</Text>
        <ActivityIndicator size="large" color={colors.gold} style={styles.spinner} />
      </View>
    );
  }

  if (user) {
    return user.role === 'renter' ? (
      <Redirect href="/(renter)/dashboard" />
    ) : (
      <Redirect href="/(customer)/home" />
    );
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.goldDark,
    marginBottom: 24,
  },
  spinner: {
    marginTop: 12,
  },
});
