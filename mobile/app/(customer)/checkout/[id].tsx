import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { getCheckoutPreview } from '@/api/accommodations';
import { initializeBooking, verifyBooking } from '@/api/bookings';
import type { CheckoutPreview } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { formatNaira } from '@/utils/format';

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{ id: string; checkIn: string; checkOut: string; units: string }>();
  const insets = useSafeAreaInsets();
  const units = Number(params.units || '1');

  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Guards against the WebView-close handler and a later "I've paid" tap both firing a verify
  // call for the same reference.
  const hasVerifiedRef = useRef(false);

  useEffect(() => {
    (async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const data = await getCheckoutPreview(params.id, params.checkIn, params.checkOut, units);
        setPreview(data);
      } catch (err) {
        setPreviewError(err instanceof ApiError ? err.message : 'Could not load the checkout summary.');
      } finally {
        setIsLoadingPreview(false);
      }
    })();
  }, [params.id, params.checkIn, params.checkOut, units]);

  async function startPayment() {
    setPaymentError(null);
    setIsStartingPayment(true);
    try {
      const result = await initializeBooking(params.id, params.checkIn, params.checkOut, units);
      setReference(result.reference);
      hasVerifiedRef.current = false;

      // In PAYSTACK_MODE=mock (the backend's default until real Paystack credentials are set
      // - see backend/README.md), authorizationUrl is a fake, non-loadable placeholder
      // (mockProvider.js) rather than a real hosted checkout page. Detect that and skip
      // straight to verification instead of opening a WebView to a page that can't load.
      if (result.authorizationUrl.includes('mock-paystack.local')) {
        await finishVerification(result.reference);
      } else {
        setCheckoutUrl(result.authorizationUrl);
      }
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : 'Could not start payment. Please try again.');
    } finally {
      setIsStartingPayment(false);
    }
  }

  async function finishVerification(ref: string) {
    if (hasVerifiedRef.current) return;
    hasVerifiedRef.current = true;
    setIsVerifying(true);
    setCheckoutUrl(null);
    try {
      const booking = await verifyBooking(ref);
      router.replace({
        pathname: '/(customer)/confirmation',
        params: { bookingId: String(booking.id) },
      });
    } catch (err) {
      if (err instanceof ApiError && err.body?.status === 'payment_failed') {
        setPaymentError('Payment was not successful. Please try again.');
      } else if (err instanceof ApiError) {
        setPaymentError(err.message);
      } else {
        setPaymentError('Could not confirm your booking. Please try again.');
      }
    } finally {
      setIsVerifying(false);
    }
  }

  function closeWebViewWithoutConfirming() {
    // The Customer closed the Paystack page without tapping "I've paid" - still worth trying
    // to verify (safe to call more than once per backend's own comment), in case they actually
    // did complete payment and just closed the tab instead of waiting for a redirect.
    if (reference) {
      finishVerification(reference);
    } else {
      setCheckoutUrl(null);
    }
  }

  if (isLoadingPreview) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (previewError || !preview) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.error}>{previewError ?? 'Could not load checkout.'}</Text>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Checkout</Text>
        <Text style={styles.subtitle}>
          {params.checkIn} → {params.checkOut} · {preview.nights} night{preview.nights === 1 ? '' : 's'} ·{' '}
          {preview.unitsRequested} unit{preview.unitsRequested === 1 ? '' : 's'}
        </Text>

        <View style={styles.breakdown}>
          <Row label="Rent" value={formatNaira(preview.rentNaira)} />
          <Row label="Admin Costs" value={formatNaira(preview.adminCostsNaira)} />
          <Row label="VAT (7.5%)" value={formatNaira(preview.vatNaira)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatNaira(preview.totalChargedNaira)} emphasize />
        </View>

        {paymentError ? <Text style={styles.error}>{paymentError}</Text> : null}

        <Pressable
          style={styles.primaryButton}
          onPress={startPayment}
          disabled={isStartingPayment || isVerifying}
        >
          {isStartingPayment || isVerifying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Pay {formatNaira(preview.totalChargedNaira)}</Text>
          )}
        </Pressable>
      </ScrollView>

      <Modal visible={Boolean(checkoutUrl)} animationType="slide">
        <View style={[styles.webviewHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={closeWebViewWithoutConfirming}>
            <Text style={styles.webviewHeaderButton}>Close</Text>
          </Pressable>
          <Text style={styles.webviewHeaderTitle}>Secure Payment</Text>
          <Pressable onPress={() => reference && finishVerification(reference)}>
            <Text style={[styles.webviewHeaderButton, styles.webviewHeaderButtonPrimary]}>I've Paid</Text>
          </Pressable>
        </View>
        {checkoutUrl ? <WebView source={{ uri: checkoutUrl }} style={styles.webview} /> : null}
      </Modal>
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
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 20,
  },
  breakdown: {
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
    marginTop: 14,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: colors.accentDark,
    fontWeight: '600',
  },
  webviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  webviewHeaderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  webviewHeaderButton: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  webviewHeaderButtonPrimary: {
    color: colors.accentDark,
    fontWeight: '700',
  },
  webview: {
    flex: 1,
  },
});
