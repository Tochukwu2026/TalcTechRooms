import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changeMyPassword, getMyProfile, updateMyProfile } from '@/api/customers';
import type { CustomerProfile } from '@/api/types';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AccountScreen() {
  const { signOut, updateUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Details form
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [detailsPassword, setDetailsPassword] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function applyProfile(next: CustomerProfile) {
    setProfile(next);
    setEmail(next.email);
    setPhone(next.phone ?? '');
  }

  // Reload on every focus so coming back from the upgrade screen shows the new tier.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoadError(null);
        try {
          const data = await getMyProfile();
          if (!cancelled) {
            applyProfile(data);
            // Keep the signed-in user (used by the home screen) in step with the server.
            updateUser({ email: data.email, tier: data.tier });
          }
        } catch (err) {
          if (!cancelled) {
            setLoadError(err instanceof ApiError ? err.message : 'Could not load your account right now.');
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const emailChanged = profile !== null && email.trim() !== profile.email;
  const phoneChanged = profile !== null && phone.trim() !== (profile.phone ?? '');
  const hasDetailChanges = emailChanged || phoneChanged;

  async function saveDetails() {
    if (!profile) return;
    setDetailsMessage(null);

    if (emailChanged && !detailsPassword) {
      setDetailsMessage({ kind: 'error', text: 'Enter your current password to change your email.' });
      return;
    }

    setIsSavingDetails(true);
    try {
      const changes: { email?: string; phone?: string; currentPassword?: string } = {};
      if (emailChanged) {
        changes.email = email.trim();
        changes.currentPassword = detailsPassword;
      }
      if (phoneChanged) {
        changes.phone = phone.trim();
      }
      const updated = await updateMyProfile(changes);
      applyProfile(updated);
      setDetailsPassword('');
      await updateUser({ email: updated.email });
      setDetailsMessage({ kind: 'ok', text: 'Your details have been saved.' });
    } catch (err) {
      setDetailsMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not save your details. Please try again.',
      });
    } finally {
      setIsSavingDetails(false);
    }
  }

  async function savePassword() {
    setPasswordMessage(null);
    if (!currentPassword || !newPassword) {
      setPasswordMessage({ kind: 'error', text: 'Fill in your current and new password.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ kind: 'error', text: 'Your new password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ kind: 'error', text: 'The new password and its confirmation do not match.' });
      return;
    }

    setIsSavingPassword(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ kind: 'ok', text: 'Your password has been changed.' });
    } catch (err) {
      setPasswordMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not change your password. Please try again.',
      });
    } finally {
      setIsSavingPassword(false);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const periodEnds = formatDate(profile?.executivePeriodEndsAt ?? null);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Account</Text>

        {loadError || !profile ? (
          <Text style={styles.error}>{loadError ?? 'Could not load your account.'}</Text>
        ) : (
          <>
            {/* Membership */}
            <View style={[styles.card, profile.tier === 'executive' && styles.cardExecutive]}>
              <Text style={styles.cardLabel}>Membership</Text>
              <Text style={styles.cardTitle}>
                {profile.tier === 'executive' ? 'Executive Customer' : 'Regular Customer'}
              </Text>
              {profile.tier === 'executive' ? (
                <Text style={styles.cardText}>
                  You can book Live and Video Viewings of accommodations.
                  {periodEnds ? ` Your current period runs until ${periodEnds}.` : ''}
                </Text>
              ) : (
                <>
                  <Text style={styles.cardText}>
                    Upgrade to Executive to book Live and Video Viewings of accommodations before you pay.
                  </Text>
                  <Pressable style={styles.primaryButton} onPress={() => router.push('/(customer)/upgrade')}>
                    <Text style={styles.primaryButtonText}>Upgrade to Executive</Text>
                  </Pressable>
                </>
              )}
            </View>

            {/* Details */}
            <Text style={styles.sectionTitle}>Your details</Text>

            <Text style={styles.label}>Full name</Text>
            <View style={[styles.input, styles.inputReadOnly]}>
              <Text style={styles.readOnlyText}>{profile.fullName}</Text>
            </View>
            <Text style={styles.hint}>Your name is matched to your ID, so it can't be changed here.</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="e.g. 08012345678"
              placeholderTextColor={colors.textMuted}
            />

            {emailChanged ? (
              <>
                <Text style={styles.label}>Current password</Text>
                <TextInput
                  style={styles.input}
                  value={detailsPassword}
                  onChangeText={setDetailsPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="Needed to change your email"
                  placeholderTextColor={colors.textMuted}
                />
              </>
            ) : null}

            {detailsMessage ? (
              <Text style={detailsMessage.kind === 'ok' ? styles.success : styles.error}>
                {detailsMessage.text}
              </Text>
            ) : null}

            <Pressable
              style={[styles.primaryButton, !hasDetailChanges && styles.buttonDisabled]}
              onPress={saveDetails}
              disabled={!hasDetailChanges || isSavingDetails}
            >
              {isSavingDetails ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Save changes</Text>
              )}
            </Pressable>

            {/* Password */}
            <Text style={styles.sectionTitle}>Change password</Text>

            <Text style={styles.label}>Current password</Text>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="At least 8 characters"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholderTextColor={colors.textMuted}
            />

            {passwordMessage ? (
              <Text style={passwordMessage.kind === 'ok' ? styles.success : styles.error}>
                {passwordMessage.text}
              </Text>
            ) : null}

            <Pressable style={styles.secondaryButton} onPress={savePassword} disabled={isSavingPassword}>
              {isSavingPassword ? (
                <ActivityIndicator color={colors.accentDark} />
              ) : (
                <Text style={styles.secondaryButtonText}>Change password</Text>
              )}
            </Pressable>
          </>
        )}

        <Pressable style={styles.logoutButton} onPress={signOut}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButtonText: {
    color: colors.accentDark,
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.surface,
  },
  cardExecutive: {
    borderColor: colors.accent,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 4,
  },
  cardText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: 28,
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 14,
    marginBottom: 6,
  },
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
  inputReadOnly: {
    backgroundColor: colors.border,
  },
  readOnlyText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 14,
  },
  success: {
    color: colors.success,
    fontSize: 14,
    marginTop: 14,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  secondaryButtonText: {
    color: colors.accentDark,
    fontSize: 15,
    fontWeight: '700',
  },
  logoutButton: {
    marginTop: 36,
    alignItems: 'center',
    paddingVertical: 12,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
