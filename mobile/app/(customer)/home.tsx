import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchAccommodations } from '@/api/accommodations';
import type { PublicAccommodation } from '@/api/types';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';
import { ACCOMMODATION_TYPE_LABELS, formatNaira } from '@/utils/format';

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [results, setResults] = useState<PublicAccommodation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSearch = useCallback(async () => {
    setError(null);
    setIsSearching(true);
    setHasSearched(true);
    try {
      const params: Record<string, string> = {};
      if (state.trim()) params.state = state.trim();
      if (checkIn.trim() && checkOut.trim()) {
        params.checkIn = checkIn.trim();
        params.checkOut = checkOut.trim();
      }
      const listings = await searchAccommodations(params);
      setResults(listings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load listings right now.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [state, checkIn, checkOut]);

  function openListing(item: PublicAccommodation) {
    router.push({
      pathname: '/(customer)/listing/[id]',
      params: {
        id: String(item.id),
        checkIn: checkIn.trim() || undefined,
        checkOut: checkOut.trim() || undefined,
      },
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>TalcTech Rooms</Text>
          {user ? <Text style={styles.greeting}>Hi, {user.fullName.split(' ')[0]}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          {user?.tier === 'executive' ? (
            <Pressable onPress={() => router.push({ pathname: '/(customer)/viewings/my' })}>
              <Text style={styles.myViewingsLink}>My Viewings</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={signOut}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.filters}>
        <TextInput
          style={styles.input}
          placeholder="State (e.g. Lagos)"
          placeholderTextColor={colors.textMuted}
          value={state}
          onChangeText={setState}
        />
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.input, styles.dateInput]}
            placeholder="Check-in (YYYY-MM-DD)"
            placeholderTextColor={colors.textMuted}
            value={checkIn}
            onChangeText={setCheckIn}
          />
          <TextInput
            style={[styles.input, styles.dateInput]}
            placeholder="Check-out (YYYY-MM-DD)"
            placeholderTextColor={colors.textMuted}
            value={checkOut}
            onChangeText={setCheckOut}
          />
        </View>
        <Pressable style={styles.searchButton} onPress={runSearch} disabled={isSearching}>
          {isSearching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => openListing(item)}>
            {item.images[0] ? (
              <Image source={{ uri: item.images[0].url }} style={styles.cardImage} />
            ) : (
              <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                <Text style={styles.cardImagePlaceholderText}>No photo yet</Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardType}>{ACCOMMODATION_TYPE_LABELS[item.type] ?? item.type}</Text>
              <Text style={styles.cardLocation}>{item.location_text}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.cardPrice}>{formatNaira(item.nightly_rent_naira)}/night</Text>
                {item.unitsAvailableForDates !== undefined ? (
                  <Text style={styles.cardAvailability}>
                    {item.unitsAvailableForDates} unit{item.unitsAvailableForDates === 1 ? '' : 's'} left
                  </Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          hasSearched && !isSearching ? (
            <Text style={styles.emptyText}>No listings match your search yet.</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.goldDark,
  },
  greeting: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  myViewingsLink: {
    color: colors.goldDark,
    fontSize: 14,
    fontWeight: '600',
  },
  logout: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '500',
  },
  filters: {
    paddingHorizontal: 20,
    paddingBottom: 12,
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
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateInput: {
    flex: 1,
  },
  searchButton: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardImage: {
    width: '100%',
    height: 160,
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  cardImagePlaceholderText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  cardBody: {
    padding: 14,
  },
  cardType: {
    fontSize: 13,
    color: colors.goldDark,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardLocation: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardAvailability: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
    fontSize: 14,
  },
});
