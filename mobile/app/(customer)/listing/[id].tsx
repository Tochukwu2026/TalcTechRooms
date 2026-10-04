import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAccommodation, getAvailability } from '@/api/accommodations';
import type { AvailabilityResponse, PublicAccommodation } from '@/api/types';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import DateField from '@/components/DateField';
import { colors } from '@/theme/colors';
import { ACCOMMODATION_TYPE_LABELS, formatNaira } from '@/utils/format';

export default function ListingDetailScreen() {
  const params = useLocalSearchParams<{ id: string; checkIn?: string; checkOut?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [listing, setListing] = useState<PublicAccommodation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [checkIn, setCheckIn] = useState(params.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(params.checkOut ?? '');
  const [units, setUnits] = useState('1');
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await getAccommodation(params.id);
        setListing(data);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Could not load this listing.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [params.id]);

  const checkAvailability = useCallback(async () => {
    setAvailabilityError(null);
    if (!checkIn.trim() || !checkOut.trim()) {
      setAvailabilityError('Enter both a check-in and check-out date.');
      return;
    }
    setIsCheckingAvailability(true);
    try {
      const result = await getAvailability(params.id, checkIn.trim(), checkOut.trim());
      setAvailability(result);
    } catch (err) {
      setAvailabilityError(err instanceof ApiError ? err.message : 'Could not check availability.');
      setAvailability(null);
    } finally {
      setIsCheckingAvailability(false);
    }
  }, [params.id, checkIn, checkOut]);

  function goToCheckout() {
    router.push({
      pathname: '/(customer)/checkout/[id]',
      params: {
        id: params.id,
        checkIn: checkIn.trim(),
        checkOut: checkOut.trim(),
        units: units.trim() || '1',
      },
    });
  }

  if (isLoading) {
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

  const canBook = Boolean(
    availability && availability.unitsAvailable >= Number(units || '1') && Number(units || '1') > 0
  );

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.scrollContent}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      {listing.images.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
          {listing.images.map((img) => (
            <Image key={String(img.id)} source={{ uri: img.url }} style={styles.heroImage} />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.heroImage, styles.heroImagePlaceholder]}>
          <Text style={styles.heroImagePlaceholderText}>No photos yet</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.type}>{ACCOMMODATION_TYPE_LABELS[listing.type] ?? listing.type}</Text>
        <Text style={styles.location}>{listing.location_text}</Text>
        <Text style={styles.price}>{formatNaira(listing.nightly_rent_naira)} / night</Text>

        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.description}>{listing.description}</Text>

        {user?.tier === 'executive' ? (
          <Pressable
            style={styles.viewingButton}
            onPress={() =>
              router.push({ pathname: '/(customer)/viewings/[id]', params: { id: params.id } })
            }
          >
            <Text style={styles.viewingButtonText}>Book a Viewing (Executive)</Text>
          </Pressable>
        ) : null}

        {listing.amenities.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Amenities</Text>
            <View style={styles.amenityRow}>
              {listing.amenities.map((a) => (
                <View key={String(a.id)} style={styles.amenityChip}>
                  <Text style={styles.amenityText}>{a.name}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Check availability</Text>
        <View style={styles.dateRow}>
          <DateField
            label="Check-in"
            value={checkIn}
            onChange={setCheckIn}
            minimumDate={new Date()}
            style={styles.dateInput}
          />
          <DateField
            label="Check-out"
            value={checkOut}
            onChange={setCheckOut}
            minimumDate={checkIn ? new Date(checkIn) : new Date()}
            style={styles.dateInput}
          />
        </View>
        <View style={styles.unitsRow}>
          <Text style={styles.label}>Units</Text>
          <TextInput
            style={styles.unitsInput}
            keyboardType="number-pad"
            value={units}
            onChangeText={setUnits}
          />
        </View>

        <Pressable style={styles.secondaryButton} onPress={checkAvailability} disabled={isCheckingAvailability}>
          {isCheckingAvailability ? (
            <ActivityIndicator color={colors.goldDark} />
          ) : (
            <Text style={styles.secondaryButtonText}>Check Availability</Text>
          )}
        </Pressable>

        {availabilityError ? <Text style={styles.error}>{availabilityError}</Text> : null}

        {availability ? (
          <Text style={styles.availabilityText}>
            {availability.unitsAvailable} of {availability.numberOfUnits} unit
            {availability.numberOfUnits === 1 ? '' : 's'} available for {availability.nights} night
            {availability.nights === 1 ? '' : 's'}.
          </Text>
        ) : null}

        <Pressable
          style={[styles.primaryButton, !canBook && styles.primaryButtonDisabled]}
          onPress={goToCheckout}
          disabled={!canBook}
        >
          <Text style={styles.primaryButtonText}>Continue to Checkout</Text>
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
  imageScroll: {
    width: '100%',
    height: 240,
  },
  heroImage: {
    width: 380,
    height: 240,
  },
  heroImagePlaceholder: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  heroImagePlaceholderText: {
    color: colors.textMuted,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  type: {
    fontSize: 13,
    color: colors.goldDark,
    fontWeight: '600',
  },
  location: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  price: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  amenityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  amenityChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  amenityText: {
    fontSize: 12,
    color: colors.text,
  },
  viewingButton: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
    backgroundColor: colors.surface,
  },
  viewingButtonText: {
    color: colors.goldDark,
    fontSize: 15,
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  dateInput: {
    flex: 1,
  },
  unitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  label: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  unitsInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    width: 70,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: colors.goldDark,
    fontSize: 15,
    fontWeight: '600',
  },
  availabilityText: {
    fontSize: 14,
    color: colors.success,
    marginTop: 10,
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
    marginTop: 6,
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: colors.goldDark,
    fontWeight: '600',
  },
});
