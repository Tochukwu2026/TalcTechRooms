import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  confirmAccommodationImage,
  getOwnAccommodation,
  listAmenities,
  removeAccommodationImage,
  removeViewingAvailability,
  replaceAmenities,
  requestImageUploadUrl,
  setAccommodationActive,
  setViewingAvailability,
  updateAccommodation,
} from '@/api/accommodations';
import { isMockStorageUrl, uploadImageToSignedUrl } from '@/api/upload';
import type { Amenity, OwnAccommodation } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';
import { ACCOMMODATION_TYPE_LABELS, formatNaira } from '@/utils/format';

// The next 30 days, as ISO date strings - matches the 30-day window
// setViewingAvailability/the backend enforces for marking Live Viewing availability.
function next30Days(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default function ManageListingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [listing, setListing] = useState<OwnAccommodation | null>(null);
  const [allAmenities, setAllAmenities] = useState<Amenity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editable field drafts, seeded from the loaded listing.
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [numberOfUnits, setNumberOfUnits] = useState('');
  const [nightlyRentNaira, setNightlyRentNaira] = useState('');
  const [selectedAmenities, setSelectedAmenities] = useState<Set<string>>(new Set());

  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isSavingAmenities, setIsSavingAmenities] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listingData, amenitiesData] = await Promise.all([
        getOwnAccommodation(params.id),
        listAmenities(),
      ]);
      setListing(listingData);
      setAllAmenities(amenitiesData);
      setLocationText(listingData.location_text);
      setDescription(listingData.description);
      setContactInfo(listingData.contact_info);
      setNumberOfUnits(String(listingData.number_of_units));
      setNightlyRentNaira(String(listingData.nightly_rent_naira));
      setSelectedAmenities(new Set(listingData.amenities.map((a) => a.name)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this listing.');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function saveDetails() {
    if (!listing) return;
    setError(null);
    setNotice(null);
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
    setIsSavingDetails(true);
    try {
      const updated = await updateAccommodation(listing.id, {
        locationText: locationText.trim(),
        description: description.trim(),
        contactInfo: contactInfo.trim(),
        numberOfUnits: units,
        nightlyRentNaira: rent,
      });
      setListing(updated);
      setNotice('Listing details saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setIsSavingDetails(false);
    }
  }

  async function toggleActive() {
    if (!listing) return;
    setError(null);
    setIsTogglingActive(true);
    try {
      const updated = await setAccommodationActive(listing.id, !listing.is_active);
      setListing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update listing status.');
    } finally {
      setIsTogglingActive(false);
    }
  }

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

  async function saveAmenities() {
    if (!listing) return;
    setError(null);
    setNotice(null);
    setIsSavingAmenities(true);
    try {
      const updated = await replaceAmenities(listing.id, Array.from(selectedAmenities));
      setListing(updated);
      setNotice('Amenities saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save amenities.');
    } finally {
      setIsSavingAmenities(false);
    }
  }

  async function pickAndUploadImage() {
    if (!listing) return;
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access is needed to add pictures.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    const contentType = (asset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | undefined) || 'image/jpeg';

    setIsUploadingImage(true);
    try {
      const { uploadUrl, objectPath } = await requestImageUploadUrl(listing.id, contentType);

      // See src/api/upload.ts: in mock storage mode (the backend's current default - see
      // backend/DEPLOY.md's STORAGE_MODE), the signed URL can't actually be PUT to, so skip
      // straight to confirming. Once STORAGE_MODE=gcs is set, this performs a real upload.
      if (!isMockStorageUrl(uploadUrl)) {
        await uploadImageToSignedUrl(uploadUrl, contentType, asset.uri);
      }

      const updated = await confirmAccommodationImage(listing.id, objectPath);
      setListing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that photo. Please try again.');
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function deleteImage(imageId: string | number) {
    if (!listing) return;
    setError(null);
    try {
      const updated = await removeAccommodationImage(listing.id, imageId);
      setListing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that photo.');
    }
  }

  async function toggleViewingDate(dateStr: string, isMarked: boolean, isBooked: boolean) {
    if (!listing || isBooked) return;
    setError(null);
    setBusyDate(dateStr);
    try {
      const updated = isMarked
        ? await removeViewingAvailability(listing.id, dateStr)
        : await setViewingAvailability(listing.id, [dateStr]);
      setListing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that date.');
    } finally {
      setBusyDate(null);
    }
  }

  if (isLoading || !listing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const viewingMarkedDates = new Set(listing.viewingAvailability.map((v) => v.available_date));
  const viewingBookedDates = new Set(
    listing.viewingAvailability.filter((v) => v.is_booked).map((v) => v.available_date)
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={[styles.backButton, { marginTop: insets.top }]} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>{'‹ Back to Dashboard'}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={styles.title}>{ACCOMMODATION_TYPE_LABELS[listing.type] ?? listing.type}</Text>
          <Pressable
            style={[styles.statusPill, listing.is_active ? styles.statusPillActive : styles.statusPillInactive]}
            onPress={toggleActive}
            disabled={isTogglingActive}
          >
            {isTogglingActive ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.statusPillText}>{listing.is_active ? 'Active · Tap to pause' : 'Inactive · Tap to activate'}</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          {listing.state}{listing.area ? ` · ${listing.area}` : ''} · Price cap {formatNaira(listing.price_cap_naira)}/night
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {/* --- Photos --- */}
        <Text style={styles.sectionTitle}>Photos</Text>
        <ScrollView horizontal style={styles.imagesRow} showsHorizontalScrollIndicator={false}>
          {listing.images.map((img) => (
            <View key={String(img.id)} style={styles.imageWrap}>
              <Image source={{ uri: img.url }} style={styles.image} />
              <Pressable style={styles.imageRemove} onPress={() => deleteImage(img.id)}>
                <Text style={styles.imageRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.addImageButton} onPress={pickAndUploadImage} disabled={isUploadingImage}>
            {isUploadingImage ? (
              <ActivityIndicator color={colors.goldDark} />
            ) : (
              <Text style={styles.addImageButtonText}>+ Add{'\n'}Photo</Text>
            )}
          </Pressable>
        </ScrollView>

        {/* --- Basic details --- */}
        <Text style={styles.sectionTitle}>Details</Text>
        <TextInput
          style={styles.input}
          placeholder="Full location"
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
          placeholder="Contact info"
          placeholderTextColor={colors.textMuted}
          value={contactInfo}
          onChangeText={setContactInfo}
        />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Number of units</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={numberOfUnits}
              onChangeText={setNumberOfUnits}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Nightly rent (₦)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={nightlyRentNaira}
              onChangeText={setNightlyRentNaira}
            />
          </View>
        </View>
        <Pressable style={styles.button} onPress={saveDetails} disabled={isSavingDetails}>
          {isSavingDetails ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Details</Text>}
        </Pressable>

        {/* --- Amenities --- */}
        <Text style={styles.sectionTitle}>Amenities</Text>
        <View style={styles.chipRow}>
          {allAmenities.map((a) => (
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
        <Pressable style={styles.buttonSecondary} onPress={saveAmenities} disabled={isSavingAmenities}>
          {isSavingAmenities ? (
            <ActivityIndicator color={colors.goldDark} />
          ) : (
            <Text style={styles.buttonSecondaryText}>Save Amenities</Text>
          )}
        </Pressable>

        {/* --- Live Viewing availability --- */}
        <Text style={styles.sectionTitle}>Live Viewing Availability</Text>
        <Text style={styles.hint}>Tap a date to mark it available for an in-person viewing (next 30 days).</Text>
        <View style={styles.chipRow}>
          {next30Days().map((dateStr) => {
            const isMarked = viewingMarkedDates.has(dateStr);
            const isBooked = viewingBookedDates.has(dateStr);
            return (
              <Pressable
                key={dateStr}
                style={[
                  styles.dateChip,
                  isMarked && styles.dateChipActive,
                  isBooked && styles.dateChipBooked,
                ]}
                onPress={() => toggleViewingDate(dateStr, isMarked, isBooked)}
                disabled={isBooked || busyDate === dateStr}
              >
                {busyDate === dateStr ? (
                  <ActivityIndicator size="small" color={isMarked ? '#fff' : colors.text} />
                ) : (
                  <Text style={[styles.dateChipText, isMarked && styles.dateChipTextActive]}>
                    {dateStr.slice(5)}
                    {isBooked ? ' ✓' : ''}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
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
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 16,
  },
  statusPill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusPillActive: {
    backgroundColor: '#E4F3E9',
  },
  statusPillInactive: {
    backgroundColor: colors.border,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    fontSize: 14,
  },
  notice: {
    color: colors.goldDark,
    marginBottom: 12,
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 20,
    marginBottom: 10,
  },
  imagesRow: {
    marginBottom: 6,
  },
  imageWrap: {
    marginRight: 10,
  },
  image: {
    width: 110,
    height: 110,
    borderRadius: 10,
  },
  imageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRemoveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  addImageButton: {
    width: 110,
    height: 110,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.gold,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImageButtonText: {
    color: colors.goldDark,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowItem: {
    flex: 1,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonSecondaryText: {
    color: colors.goldDark,
    fontSize: 15,
    fontWeight: '600',
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
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 10,
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
  dateChipBooked: {
    backgroundColor: colors.border,
    borderColor: colors.border,
  },
  dateChipText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  dateChipTextActive: {
    color: '#fff',
  },
});
