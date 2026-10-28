import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteMyAccount } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';

// Reachable by both Customers and Renters (Account screen / Renter dashboard). Google Play requires
// that people can start account deletion from inside the app; the same request is also possible via
// the web page at rooms.talctechng.com/delete-account.
export default function DeleteAccountScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRenter = user?.role === 'renter';

  async function confirmDelete() {
    setError(null);
    if (!password) {
      setError('Enter your password to continue.');
      return;
    }
    setIsDeleting(true);
    try {
      await deleteMyAccount(password);
      await signOut();
    } catch (err) {
      setConfirmStep(false);
      setError(err instanceof ApiError ? err.message : 'Could not delete your account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable style={styles.backButton} onPress={() => router.back()} disabled={isDeleting}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Delete your account</Text>

        <View style={styles.warning}>
          <Text style={styles.warningTitle}>This cannot be undone</Text>
          <Text style={styles.warningText}>
            We will remove your name, email, phone number, ID details
            {isRenter ? ', address and bank details' : ' and saved card'} from TalcTech Rooms and close your account.
            {isRenter ? ' Your listings will be taken off the app.' : ' Any Executive membership will be cancelled and no further payments will be taken.'}
          </Text>
          <Text style={styles.warningText}>
            Records of past bookings and payments are kept without your name, because we are required to keep
            financial records for several years.
          </Text>
          <Text style={styles.warningText}>
            You cannot delete while you have a stay or viewing that has not happened yet
            {isRenter ? ', or a payout that has not been settled' : ''}. If that applies, we will tell you.
          </Text>
        </View>

        <Text style={styles.label}>Enter your password to confirm</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!isDeleting}
          placeholderTextColor={colors.textMuted}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {confirmStep ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>Are you sure? Your account will be deleted now.</Text>
            <Pressable style={styles.dangerButton} onPress={confirmDelete} disabled={isDeleting}>
              {isDeleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerButtonText}>Yes, delete my account</Text>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setConfirmStep(false)} disabled={isDeleting}>
              <Text style={styles.cancelButtonText}>No, keep my account</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[styles.dangerOutline, !password && styles.disabled]}
            onPress={() => setConfirmStep(true)}
            disabled={!password}
          >
            <Text style={styles.dangerOutlineText}>Delete my account</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backButton: { paddingHorizontal: 20, paddingVertical: 12 },
  backButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '600' },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 16 },
  warning: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.surface,
  },
  warningTitle: { fontSize: 16, fontWeight: '700', color: colors.danger, marginBottom: 6 },
  warningText: { fontSize: 14, lineHeight: 20, color: colors.text, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 22, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: 14, lineHeight: 20 },
  confirmBox: { marginTop: 20 },
  confirmText: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  dangerButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  dangerButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cancelButton: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '600' },
  dangerOutline: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  dangerOutlineText: { color: colors.danger, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
