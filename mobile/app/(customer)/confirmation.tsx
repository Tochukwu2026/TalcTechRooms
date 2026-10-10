import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBooking } from '@/api/bookings';
import type { Booking } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { formatNaira } from '@/utils/format';

export default function ConfirmationScreen() {
  const params = useLocalSearchParams<{ bookingId: string }>();
  const insets = useSafeAreaInsets();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getBooking(params.bookingId);
        setBooking(data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load your booking.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [params.bookingId]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
        <Text style={styles.title}>Booking Confirmed</Text>
        <Text style={styles.subtitle}>
          A confirmation has been sent to your email and phone.
        </Text>

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : booking ? (
          <View style={styles.card}>
            <Row label="Booking #" value={String(booking.id)} />
            <Row label="Check-in" value={String(booking.checkInDate)} />
            <Row label="Check-out" value={String(booking.checkOutDate)} />
            <Row label="Units" value={String(booking.unitsBooked)} />
            <View style={styles.divider} />
            <Row label="Total Paid" value={formatNaira(booking.totalChargedNaira)} emphasize />
          </View>
        ) : null}

        <Pressable style={styles.primaryButton} onPress={() => router.replace('/(customer)/home')}>
          <Text style={styles.primaryButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, emphasize && styles.rowLabelEmphasis]}>{label}</Text>
      <Text style={[styles.rowValue, emphasize && styles.rowValueEmphasis]}>{value}</Text>
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    paddingTop: 48,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  checkMark: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
  },
  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rowLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  rowLabelEmphasis: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  rowValueEmphasis: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 32,
    width: '100%',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
