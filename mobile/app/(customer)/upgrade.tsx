import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { getExecutiveSubscriptionPreview } from '@/api/auth';
import { initializeExecutiveUpgrade, verifyExecutiveUpgrade } from '@/api/customers';
import type { ExecutiveSubscriptionPreview } from '@/api/types';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';
import { formatNaira } from '@/utils/format';

// Same payment pattern as the booking checkout screen: start a Paystack charge, show Paystack's
// page in a WebView, then ask the backend to confirm the payment. The tier only changes on the
// server once the payment is confirmed - this screen just mirrors that.
export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { updateUser } = useAuth();
  // Set when this screen is opened straight from sign-up (chose Executive while registering).
  const { signup } = useLocalSearchParams<{ signup?: string }>();
  const isSignup = signup === '1';

  const [preview, setPreview] = useState<ExecutiveSubscriptionPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  // Stops the WebView-close handler and an "I've Paid" tap both verifying the same payment at once.
  const isVerifyingRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        setPreview(await getExecutiveSubscriptionPreview());
      } catch (err) {
        setPreviewError(err instanceof ApiError ? err.message : 'Could not load the Executive price.');
      } finally {
        setIsLoadingPreview(false);
      }
    })();
  }, []);

  async function startPayment() {
    setPaymentError(null);
    setIsStartingPayment(true);
    try {
      const result = await initializeExecutiveUpgrade();
      setReference(result.reference);

      // In the backend's mock payment mode, authorizationUrl is a fake placeholder with no real
      // page behind it - skip straight to confirming, same as the booking checkout does.
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
    if (isVerifyingRef.current) return;
    isVerifyingRef.current = true;
    setIsVerifying(true);
    setCheckoutUrl(null);
    try {
      await verifyExecutiveUpgrade(ref);
      await updateUser({ tier: 'executive' });
      setUpgraded(true);
    } catch (err) {
      if (err instanceof ApiError && err.body?.status === 'payment_failed') {
        setPaymentError('Payment was not successful. You have not been charged for an upgrade. Please try again.');
      } else if (err instanceof ApiError) {
        setPaymentError(err.message);
      } else {
        setPaymentError('Could not confirm your payment. Please try again.');
      }
    } finally {
      isVerifyingRef.current = false;
      setIsVerifying(false);
    }
  }

  function closeWebViewWithoutConfirming() {
    // They may have paid and simply closed the page - still worth asking the backend.
    if (reference) {
      finishVerification(reference);
    } else {
      setCheckoutUrl(null);
    }
  }

  if (upgraded) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.successTitle}>You're an Executive Customer</Text>
        <Text style={styles.successText}>
          You can now book Live and Video Viewings from any accommodation page.
        </Text>
        <Pressable style={[styles.primaryButton, styles.successButton]} onPress={() => router.replace('/(customer)/home')}>
          <Text style={styles.primaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
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
        <Text style={styles.error}>{previewError ?? 'Could not load the Executive price.'}</Text>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {isSignup ? null : (
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>{'‹ Back'}</Text>
        </Pressable>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{isSignup ? 'Complete your Executive sign-up' : 'Upgrade to Executive'}</Text>
        <Text style={styles.subtitle}>
          Book Live and Video Viewings of accommodations before you pay. Your card is charged now for the first month,
          then renews automatically every month. You can switch renewal off any time in Account - you then go back to a
          Regular account when the paid month ends.
        </Text>

        <View style={styles.breakdown}>
          <Row label="Executive subscription (1 month)" value={formatNaira(preview.baseFeeNaira)} />
          <Row label="Admin Costs" value={formatNaira(preview.adminCostsNaira)} />
          <Row label="VAT (7.5%)" value={formatNaira(preview.vatNaira)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatNaira(preview.totalChargedNaira)} emphasize />
        </View>

        {paymentError ? <Text style={styles.error}>{paymentError}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={startPayment} disabled={isStartingPayment || isVerifying}>
          {isStartingPayment || isVerifying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Pay {formatNaira(preview.totalChargedNaira)}</Text>
          )}
        </Pressable>

        {isSignup ? (
          <Pressable style={styles.skipButton} onPress={() => router.replace('/(customer)/home')} disabled={isStartingPayment || isVerifying}>
            <Text style={styles.skipButtonText}>Continue as Regular for now (free)</Text>
          </Pressable>
        ) : null}
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
    paddingHorizontal: 28,
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
    lineHeight: 20,
    color: colors.textMuted,
    marginTop: 6,
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
    gap: 12,
  },
  rowLabel: {
    flex: 1,
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
    textAlign: 'center',
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
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  successText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  successButton: {
    alignSelf: 'stretch',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  skipButtonText: {
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: '600',
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
