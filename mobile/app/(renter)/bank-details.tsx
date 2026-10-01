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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRenterMe, updateBankDetails } from '@/api/renters';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { NIGERIAN_BANK_NAMES } from '@/utils/nigerianBanks';

export default function BankDetailsScreen() {
  const insets = useSafeAreaInsets();

  const [bankName, setBankName] = useState<string | null>(null);
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const renter = await getRenterMe();
        setBankName(renter.bank_name);
        setBankAccountNumber(renter.bank_account_number ?? '');
        setBankAccountName(renter.bank_account_name ?? '');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load your current bank details.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setError(null);
    setNotice(null);
    if (!bankName) {
      setError('Please choose your bank.');
      return;
    }
    if (bankAccountNumber.trim().length < 6) {
      setError('Please enter a valid account number.');
      return;
    }
    if (!bankAccountName.trim()) {
      setError('Please enter the account name.');
      return;
    }

    setIsSaving(true);
    try {
      await updateBankDetails({
        bankName,
        bankAccountNumber: bankAccountNumber.trim(),
        bankAccountName: bankAccountName.trim(),
      });
      setNotice('Bank details saved. Your payouts will be sent here.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your bank details.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={[styles.backButton, { marginTop: insets.top }]} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Bank Details</Text>
        <Text style={styles.subtitle}>
          This is where your booking payouts are sent, after TalcTech's commission, VAT and admin
          costs are deducted.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Text style={styles.label}>Bank</Text>
        <View style={styles.chipRow}>
          {NIGERIAN_BANK_NAMES.map((name) => (
            <Pressable
              key={name}
              style={[styles.chip, bankName === name && styles.chipActive]}
              onPress={() => setBankName(name)}
            >
              <Text style={[styles.chipText, bankName === name && styles.chipTextActive]}>{name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Account number</Text>
        <TextInput
          style={styles.input}
          placeholder="10-digit account number"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          value={bankAccountNumber}
          onChangeText={setBankAccountNumber}
        />

        <Text style={styles.label}>Account name</Text>
        <TextInput
          style={styles.input}
          placeholder="Name on the account"
          placeholderTextColor={colors.textMuted}
          value={bankAccountName}
          onChangeText={setBankAccountName}
        />

        <Pressable style={styles.button} onPress={handleSave} disabled={isSaving}>
          {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Bank Details</Text>}
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButtonText: {
    color: colors.goldDark,
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
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 19,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
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
});
