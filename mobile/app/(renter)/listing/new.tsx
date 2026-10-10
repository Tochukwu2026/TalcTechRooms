import { useEffect, useMemo, useState } from 'react';
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
import { createAccommodation, listAmenities, listPriceCaps } from '@/api/accommodations';
import type { AccommodationType, Amenity, PriceCap } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { ACCOMMODATION_TYPE_LABELS } from '@/utils/format';

const ACCOMMODATION_TYPES = Object.keys(ACCOMMODATION_TYPE_LABELS) as AccommodationType[];

export default function NewListingScreen() {
  const insets = useSafeAreaInsets();

  const [priceCaps, setPriceCaps] = useState<PriceCap[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<AccommodationType>('room');
  const [state, setState] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [numberOfUnits, setNumberOfUnits] = useState('1');
  const [nightlyRentNaira, setNightlyRentNaira] = useState('');
  const [selectedAmenities, setSelectedAmenities] = useState<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoadingOptions(true);
      setLoadError(null);
      try {
        const [capsData, amenitiesData] = await Promise.all([listPriceCaps(), listAmenities()]);
        setPriceCaps(capsData);
        setAmenities(amenitiesData);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Could not load location/amenity options.');
      } finally {
        setIsLoadingOptions(false);
      }
    })();
  }, []);

  // Price caps rows are {state, area, capNaira} - a state with several Lagos-style areas has
  // one row per area; a state with no area concept has a single row where area is null (see
  // accommodationService.findPriceCapId). Derive the picklists from that, rather than hardcoding
  // supported locations here, so new states/areas the Admin adds show up automatically.
  const states = useMemo(() => {
    const unique = Array.from(new Set(priceCaps.map((c) => c.state)));
    return unique.sort();
  }, [priceCaps]);

  const areasForState = useMemo(() => {
    if (!state) return [];
    return priceCaps
      .filter((c) => c.state === state && c.area)
      .map((c) => c.area as string)
      .sort();
  }, [priceCaps, state]);

  function toggleAmenity(name: string) {
    setSelectedAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);

    if (!state) {
      setError('Please choose a state.');
      return;
    }
    if (areasForState.length > 0 && !area) {
      setError('Please choose an area.');
      return;
    }
    if (!locationText.trim() || !description.trim() || !contactInfo.trim()) {
      setError('Please fill in the location, description, and contact info.');
      return;
    }
    const units = Number(numberOfUnits);
    const rent = Number(nightlyRentNaira);
    if (!Number.isInteger(units) || units < 1) {
      setError('Number of units must be a whole number of at least 1.');
      return;
    }
    if (!Number.isFinite(rent) || rent <= 0) {
      setError('Nightly rent must be a positive number.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createAccommodation({
        type,
        state,
        area: area || undefined,
        locationText: locationText.trim(),
        description: description.trim(),
        contactInfo: contactInfo.trim(),
        numberOfUnits: units,
        nightlyRentNaira: rent,
        amenities: selectedAmenities.size > 0 ? Array.from(selectedAmenities) : undefined,
      });
      router.replace({ pathname: '/(renter)/listing/[id]', params: { id: String(created.id) } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the listing. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingOptions) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={[styles.backButton, { marginTop: insets.top }]} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New Listing</Text>

        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

        <Text style={styles.label}>Type</Text>
        <View style={styles.chipRow}>
          {ACCOMMODATION_TYPES.map((t) => (
            <Pressable key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)}>
              <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                {ACCOMMODATION_TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>State</Text>
        <View style={styles.chipRow}>
          {states.map((s) => (
            <Pressable
              key={s}
              style={[styles.chip, state === s && styles.chipActive]}
              onPress={() => {
                setState(s);
                setArea(null);
              }}
            >
              <Text style={[styles.chipText, state === s && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>

        {areasForState.length > 0 ? (
          <>
            <Text style={styles.label}>Area</Text>
            <View style={styles.chipRow}>
              {areasForState.map((a) => (
                <Pressable key={a} style={[styles.chip, area === a && styles.chipActive]} onPress={() => setArea(a)}>
                  <Text style={[styles.chipText, area === a && styles.chipTextActive]}>{a}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Full location (street, landmark)"
          placeholderTextColor={colors.textMuted}
          value={locationText}
          onChangeText={setLocationText}
        />
        <TextInput
          style={[styles.input, styles.multilineInput]}
          placeholder="Description"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <TextInput
          style={styles.input}
          placeholder="Contact info (phone/WhatsApp for guests after booking)"
          placeholderTextColor={colors.textMuted}
          value={contactInfo}
          onChangeText={setContactInfo}
        />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Number of units</Text>
            <TextInput
              style={styles.input}
              placeholder="1"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              value={numberOfUnits}
              onChangeText={setNumberOfUnits}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Nightly rent (₦)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 25000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={nightlyRentNaira}
              onChangeText={setNightlyRentNaira}
            />
          </View>
        </View>

        <Text style={styles.label}>Amenities</Text>
        <View style={styles.chipRow}>
          {amenities.map((a) => (
            <Pressable
              key={String(a.id)}
              style={[styles.chip, selectedAmenities.has(a.name) && styles.chipActive]}
              onPress={() => toggleAmenity(a.name)}
            >
              <Text style={[styles.chipText, selectedAmenities.has(a.name) && styles.chipTextActive]}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.button} onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Listing</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>
          You'll be able to add photos and viewing availability right after this.
        </Text>
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
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
    fontSize: 15,
    color: colors.text,
    marginBottom: 14,
    backgroundColor: colors.surface,
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowItem: {
    flex: 1,
  },
  error: {
    color: colors.danger,
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
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 14,
  },
});
