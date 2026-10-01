import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';

const DOCUMENT_TYPES: { value: 'nin' | 'passport' | 'pvc'; label: string }[] = [
  { value: 'nin', label: 'NIN' },
  { value: 'passport', label: 'Passport' },
  { value: 'pvc', label: "Voter's Card" },
];

export default function RegisterScreen() {
  const { registerAndSignIn } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [documentType, setDocumentType] = useState<'nin' | 'passport' | 'pvc'>('nin');
  const [documentNumber, setDocumentNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setNotice(null);

    if (!fullName.trim() || !email.trim() || !password || !documentNumber.trim()) {
      setError('Please fill in your name, email, password, and ID number.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { idVerificationPassed } = await registerAndSignIn({
        email: email.trim(),
        phone: phone.trim() || undefined,
        fullName: fullName.trim(),
        password,
        documentType,
        documentNumber: documentNumber.trim(),
      });

      if (!idVerificationPassed) {
        setNotice(
          'Account created, but ID verification did not pass - you can browse, but booking ' +
            'may be restricted until this is resolved.'
        );
      }
      router.replace('/(customer)/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Join TalcTech Rooms to book a stay</Text>

        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor={colors.textMuted}
          value={fullName}
          onChangeText={setFullName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone (optional)"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min. 8 characters)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Text style={styles.label}>ID type</Text>
        <View style={styles.segmentRow}>
          {DOCUMENT_TYPES.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.segment, documentType === option.value && styles.segmentActive]}
              onPress={() => setDocumentType(option.value)}
            >
              <Text
                style={[
                  styles.segmentText,
                  documentType === option.value && styles.segmentTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="ID number"
          placeholderTextColor={colors.textMuted}
          value={documentNumber}
          onChangeText={setDocumentNumber}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable style={styles.button} onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </Pressable>

        <Pressable style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Already have an account? Log in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.goldDark,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 28,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    marginBottom: 14,
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 8,
  },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  segmentText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#fff',
  },
  error: {
    color: colors.danger,
    marginBottom: 14,
    fontSize: 14,
  },
  notice: {
    color: colors.goldDark,
    marginBottom: 14,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: colors.goldDark,
    fontSize: 14,
    fontWeight: '500',
  },
});
