import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAccommodation } from '@/api/accommodations';
import { bookViewing, getLiveAvailability, getVideoAvailability } from '@/api/viewings';
import type { PublicAccommodation, ViewingType } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';

// Executive Feature Viewing bookings - see backend viewingService.js for the rules this screen
// surfaces: Video Viewing is any of the next 30 days (capped at 1 per listing per rolling 7
// days); Live Viewing only offers the specific dates the Renter marked as available and not yet
// booked by someone else (capped at 1 per listing + 3 total across all listings, per calendar
// month). Both are 403'd server-side for a non-Executive Customer - this screen is only reached
// from the listing screen's "Book a Viewing" button, which is itself hidden unless
// user.tier === 'executive', so reaching here at all implies Executive, but the screen still
// surfaces the 403 message plainly if that somehow isn't the case (e.g. a stale session).

export default function BookViewingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [listing, setListing] = useState<PublicAccommodation | null>(null);
  const [isLoadingListing, setIsLoadingListing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewingType, setViewingType] = useState<ViewingType>('video');
  const [dates, setDates] = useState<string[]>([]);
  const [isLoadingDates, setIsLoadingDates] = useState(true);
  const [datesError, setDatesError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoadingListing(true);
      setLoadError(null);
      try {
        setListing(await getAccommodation(params.id));
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Could not load this listing.');
      } finally {
        setIsLoadingListing(false);
      }
    })();
  }, [params.id]);

  const loadDates = useCallback(async (type: ViewingType) => {
    setIsLoadingDates(true);
    setDatesError(null);
    setSelectedDate(null);
    try {
      const result = type === 'video' ? await getVideoAvailability(params.id) : await getLiveAvailability(params.id);
      setDates(result.dates);
    } catch (err) {
      setDatesError(err instanceof ApiError ? err.message : 'Could not load available dates.');
      setDates([]);
    } finally {
      setIsLoadingDates(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadDates(viewingType);
  }, [viewingType, loadDates]);

  function switchType(type: ViewingType) {
    if (type === viewingType) return;
    setViewingType(type);
    setBookError(null);
    setConfirmedDate(null);
  }

  async function confirmBooking() {
    if (!selectedDate) return;
    setIsBooking(true);
    setBookError(null);
    try {
      const viewing = await bookViewing(params.id, { viewingType, scheduledDate: selectedDate });
      setConfirmedDate(viewing.scheduledDate);
    } catch (err) {
      setBookError(err instanceof ApiError ? err.message : 'Could not book this viewing.');
    } finally {
      setIsBooking(false);
    }
  }

  if (isLoadingListing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  if (loadError || !listing) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.error}>{loadError ?? 'Listing not found.'}</Text>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (confirmedDate) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.confirmTitle}>Viewing booked!</Text>
        <Text style={styles.confirmBody}>
          Your {viewingType === 'video' ? 'Video' : 'Live'} Viewing for {listing.location_text} is scheduled for{' '}
          {confirmedDate}. We&apos;ve sent a confirmation by email and SMS.
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.replace({ pathname: '/(customer)/viewings/my' })}
        >
          <Text style={styles.primaryButtonText}>View My Viewings</Text>
        </Pressable>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Back to listing</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.scrollContent}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <View style={styles.body}>
        <Text style={styles.title}>Book a Viewing</Text>
        <Text style={styles.location}>{listing.location_text}</Text>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, viewingType === 'video' && styles.tabActive]}
            onPress={() => switchType('video')}
          >
            <Text style={[styles.tabText, viewingType === 'video' && styles.tabTextActive]}>Video Viewing</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, viewingType === 'live' && styles.tabActive]}
            onPress={() => switchType('live')}
          >
            <Text style={[styles.tabText, viewingType === 'live' && styles.tabTextActive]}>Live Viewing</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          {viewingType === 'video'
            ? 'A video call walkthrough of the listing, any time in the next 30 days. Limited to one per listing every 7 days.'
            : 'An in-person walkthrough, only on dates the Renter has made available. Limited to one per listing and three total per month.'}
        </Text>

        {isLoadingDates ? (
          <ActivityIndicator color={colors.gold} style={styles.datesLoading} />
        ) : datesError ? (
          <Text style={styles.error}>{datesError}</Text>
        ) : dates.length === 0 ? (
          <Text style={styles.emptyText}>
            {viewingType === 'live'
              ? 'The Renter has not marked any upcoming dates available for a Live Viewing yet.'
              : 'No dates available right now.'}
          </Text>
        ) : (
          <View style={styles.chipRow}>
            {dates.map((dateStr) => {
              const isSelected = selectedDate === dateStr;
              return (
                <Pressable
                  key={dateStr}
                  style={[styles.dateChip, isSelected && styles.dateChipActive]}
                  onPress={() => setSelectedDate(dateStr)}
                >
                  <Text style={[styles.dateChipText, isSelected && styles.dateChipTextActive]}>
                    {dateStr.slice(5)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {bookError ? <Text style={styles.error}>{bookError}</Text> : null}

        <Pressable
          style={[styles.primaryButton, !selectedDate && styles.primaryButtonDisabled]}
          onPress={confirmBooking}
          disabled={!selectedDate || isBooking}
        >
          {isBooking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              Confirm {viewingType === 'video' ? 'Video' : 'Live'} Viewing{selectedDate ? ` — ${selectedDate}` : ''}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
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
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingBottom: 48,
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
  body: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  location: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 20,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  tabTextActive: {
    color: '#fff',
  },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: 18,
  },
  datesLoading: {
    marginTop: 10,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 54,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  dateChipActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  dateChipText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  dateChipTextActive: {
    color: '#fff',
  },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.border,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 10,
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: colors.goldDark,
    fontWeight: '600',
  },
  confirmTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.success,
    marginBottom: 10,
    textAlign: 'center',
  },
  confirmBody: {
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
});
