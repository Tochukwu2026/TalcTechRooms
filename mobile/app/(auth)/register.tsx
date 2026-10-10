import { useEffect, useState } from 'react';
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
import { getExecutiveSubscriptionPreview } from '@/api/auth';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { formatNaira } from '@/utils/format';

const DOCUMENT_TYPES: { value: 'nin' | 'passport' | 'pvc'; label: string }[] = [
  { value: 'nin', label: 'NIN' },
  { value: 'passport', label: 'Passport' },
  { value: 'pvc', label: "Voter's Card" },
];

// Two very different accounts share this one screen (per the spec, both sign up with name +
// ID document) - a role toggle up top swaps which extra fields show and which endpoint/context
// method gets called, rather than building two near-duplicate screens.
type AccountKind = 'customer' | 'renter';

export default function RegisterScreen() {
  const { registerAndSignIn, registerRenterAndSignIn } = useAuth();
  const [accountKind, setAccountKind] = useState<AccountKind>('customer');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState(''); // Renter only
  const [tier, setTier] = useState<'regular' | 'executive'>('regular'); // Customer only
  const [documentType, setDocumentType] = useState<'nin' | 'passport' | 'pvc'>('nin');
  const [documentNumber, setDocumentNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [executivePriceNaira, setExecutivePriceNaira] = useState<number | null>(null);

  // Fetch the real Executive-tier monthly price once, so the toggle below shows an actual
  // figure rather than nothing - this is a public, unauthenticated endpoint (no login needed to
  // see pricing before signing up). A failure here just leaves the price line off; it doesn't
  // block registration.
  useEffect(() => {
    getExecutiveSubscriptionPreview()
      .then((preview) => setExecutivePriceNaira(preview.totalChargedNaira))
      .catch(() => {});
  }, []);

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
    if (accountKind === 'renter' && !address.trim()) {
      setError('Please enter your address.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (accountKind === 'renter') {
        const { idVerificationPassed } = await registerRenterAndSignIn({
          email: email.trim(),
          phone: phone.trim() || undefined,
          fullName: fullName.trim(),
          password,
          address: address.trim(),
          documentType,
          documentNumber: documentNumber.trim(),
        });
        if (!idVerificationPassed) {
          setNotice(
            'Account created, but ID verification did not pass - an Admin will review this ' +
              'before you can post an Accommodation.'
          );
        }
        router.replace('/(renter)/dashboard');
      } else {
        const { idVerificationPassed, executivePaymentRequired } = await registerAndSignIn({
          email: email.trim(),
          phone: phone.trim() || undefined,
          fullName: fullName.trim(),
          password,
          tier,
          documentType,
          documentNumber: documentNumber.trim(),
        });
        if (!idVerificationPassed) {
          setNotice(
            'Account created, but ID verification did not pass - you can browse, but booking ' +
              'may be restricted until this is resolved.'
          );
        }
        // Executive is paid for at sign-up: straight into the payment screen. The account already
        // exists as Regular, so abandoning the payment still leaves a working free account.
        if (executivePaymentRequired && idVerificationPassed) {
          router.replace({ pathname: '/(customer)/upgrade', params: { signup: '1' } });
        } else {
          router.replace('/(customer)/home');
        }
      }
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
        <Text style={styles.subtitle}>
          {accountKind === 'customer' ? 'Join TalcTech Rooms to book a stay' : 'List your property on TalcTech Rooms'}
        </Text>

        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segment, accountKind === 'customer' && styles.segmentActive]}
            onPress={() => setAccountKind('customer')}
          >
            <Text style={[styles.segmentText, accountKind === 'customer' && styles.segmentTextActive]}>
              I'm a Guest
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segment, accountKind === 'renter' && styles.segmentActive]}
            onPress={() => setAccountKind('renter')}
          >
            <Text style={[styles.segmentText, accountKind === 'renter' && styles.segmentTextActive]}>
              I'm a Renter
            </Text>
          </Pressable>
        </View>

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

        {accountKind === 'renter' ? (
          <TextInput
            style={styles.input}
            placeholder="Address"
            placeholderTextColor={colors.textMuted}
            value={address}
            onChangeText={setAddress}
            multiline
          />
        ) : null}

        {accountKind === 'customer' ? (
          <>
            <Text style={styles.label}>Account tier</Text>
            <View style={styles.segmentRow}>
              <Pressable
                style={[styles.segment, tier === 'regular' && styles.segmentActive]}
                onPress={() => setTier('regular')}
              >
                <Text style={[styles.segmentText, tier === 'regular' && styles.segmentTextActive]}>Regular</Text>
              </Pressable>
              <Pressable
                style={[styles.segment, tier === 'executive' && styles.segmentActive]}
                onPress={() => setTier('executive')}
              >
                <Text style={[styles.segmentText, tier === 'executive' && styles.segmentTextActive]}>Executive</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {tier === 'executive'
                ? `Executive adds Live and Video Viewing bookings before you stay. You pay${
                    executivePriceNaira ? ` ${formatNaira(executivePriceNaira)}` : ''
                  } for the first month right after creating your account, and your card is saved so it renews every month. You can switch renewal off any time in Account.`
                : 'Regular Customers can search and book stays. Switch to Executive above to also unlock Live/Video Viewing bookings.'}
            </Text>
          </>
        ) : null}

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

        {accountKind === 'renter' ? (
          <Text style={styles.hint}>
            After signing up, an Admin will need to approve your Renter account before you can
            post an Accommodation. You can still sign in and check your status in the meantime.
          </Text>
        ) : null}

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
    color: colors.accentDark,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 20,
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
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#fff',
  },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 14,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    marginBottom: 14,
    fontSize: 14,
  },
  notice: {
    color: colors.accentDark,
    marginBottom: 14,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.accent,
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
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: '500',
  },
});
