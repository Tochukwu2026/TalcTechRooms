import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listOwnAccommodations } from '@/api/accommodations';
import { getRenterMe } from '@/api/renters';
import type { OwnAccommodation, RenterMe } from '@/api/types';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { colors } from '@/theme/colors';
import { ACCOMMODATION_TYPE_LABELS, formatNaira } from '@/utils/format';

export default function RenterDashboardScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const [renter, setRenter] = useState<RenterMe | null>(null);
  const [listings, setListings] = useState<OwnAccommodation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [renterData, listingsData] = await Promise.all([getRenterMe(), listOwnAccommodations()]);
      setRenter(renterData);
      setListings(listingsData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your dashboard right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refetch every time this screen gains focus - e.g. coming back from creating a listing or
  // from the bank-details screen, so the list/approval banner are always current.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          {user ? <Text style={styles.greeting}>Hi, {user.fullName.split(' ')[0]}</Text> : null}
        </View>
        <Pressable onPress={signOut}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {renter ? <ApprovalBanner renter={renter} /> : null}

      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionButton, renter?.approval_status !== 'approved' && styles.actionButtonDisabled]}
          onPress={() => router.push('/(renter)/listing/new')}
          disabled={renter?.approval_status !== 'approved'}
        >
          <Text style={styles.actionButtonText}>+ New Listing</Text>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/(renter)/bank-details')}>
          <Text style={styles.actionButtonSecondaryText}>Bank Details</Text>
        </Pressable>
      </View>

      <FlatList
        data={listings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: '/(renter)/listing/[id]', params: { id: String(item.id) } })}
          >
            {item.images[0] ? (
              <Image source={{ uri: item.images[0].url }} style={styles.cardImage} />
            ) : (
              <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                <Text style={styles.cardImagePlaceholderText}>No photos yet</Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardType}>{ACCOMMODATION_TYPE_LABELS[item.type] ?? item.type}</Text>
                <View style={[styles.statusPill, item.is_active ? styles.statusPillActive : styles.statusPillInactive]}>
                  <Text style={styles.statusPillText}>{item.is_active ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>
              <Text style={styles.cardLocation}>{item.location_text}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.cardPrice}>{formatNaira(item.nightly_rent_naira)}/night</Text>
                <Text style={styles.cardUnits}>
                  {item.units_available}/{item.number_of_units} units free
                </Text>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {renter?.approval_status === 'approved'
              ? "You haven't listed an Accommodation yet. Tap \"+ New Listing\" to get started."
              : 'Your listings will appear here once your Renter account is approved.'}
          </Text>
        }
      />
    </View>
  );
}

function ApprovalBanner({ renter }: { renter: RenterMe }) {
  if (renter.approval_status === 'approved') {
    return null;
  }
  if (renter.approval_status === 'rejected') {
    return (
      <View style={[styles.banner, styles.bannerRejected]}>
        <Text style={styles.bannerTitle}>Renter account not approved</Text>
        <Text style={styles.bannerText}>
          {renter.rejection_reason || 'Contact TalcTech support for details.'}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.banner, styles.bannerPending]}>
      <Text style={styles.bannerTitle}>Approval pending</Text>
      <Text style={styles.bannerText}>
        An Admin needs to approve your Renter account before you can post an Accommodation. This
        usually doesn't take long - check back soon.
      </Text>
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
  logo: {
    width: 120,
    height: 90,
  },
  greeting: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  logout: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '500',
  },
  error: {
    color: colors.danger,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  banner: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 12,
    padding: 14,
  },
  bannerPending: {
    backgroundColor: '#FBF2DC',
  },
  bannerRejected: {
    backgroundColor: '#FBE4E1',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  bannerText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionButtonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  actionButtonSecondaryText: {
    color: colors.goldDark,
    fontSize: 14,
    fontWeight: '600',
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
    height: 140,
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
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  cardType: {
    fontSize: 13,
    color: colors.goldDark,
    fontWeight: '600',
  },
  statusPill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillActive: {
    backgroundColor: '#E4F3E9',
  },
  statusPillInactive: {
    backgroundColor: colors.border,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
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
  cardUnits: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 24,
    marginHorizontal: 20,
    fontSize: 14,
    lineHeight: 20,
  },
});
