import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cancelViewing, listMyViewings } from '@/api/viewings';
import type { Viewing } from '@/api/types';
import { ApiError } from '@/api/client';
import { colors } from '@/theme/colors';

const STATUS_LABELS: Record<Viewing['status'], string> = {
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

export default function MyViewingsScreen() {
  const insets = useSafeAreaInsets();

  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setViewings(await listMyViewings());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your viewings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reload every time this screen is focused, so a just-made booking (or a cancellation made
  // here and then this screen re-visited) is always fresh - not just on first mount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleCancel(viewing: Viewing) {
    setCancellingId(viewing.id);
    setError(null);
    try {
      await cancelViewing(viewing.id);
      setViewings((prev) =>
        prev.map((v) => (v.id === viewing.id ? { ...v, status: 'cancelled' } : v))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this viewing.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButtonText}>{'‹ Back'}</Text>
        </Pressable>
        <Text style={styles.title}>My Viewings</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.gold} style={styles.loading} />
      ) : (
        <FlatList
          data={viewings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardType}>{item.viewingType === 'video' ? 'Video Viewing' : 'Live Viewing'}</Text>
                <Text style={[styles.statusBadge, statusStyle(item.status)]}>{STATUS_LABELS[item.status]}</Text>
              </View>
              <Text style={styles.cardDate}>{item.scheduledDate}</Text>
              {item.status === 'scheduled' ? (
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => handleCancel(item)}
                  disabled={cancellingId === item.id}
                >
                  {cancellingId === item.id ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>You haven&apos;t booked any viewings yet.</Text>}
        />
      )}
    </View>
  );
}

function statusStyle(status: Viewing['status']) {
  if (status === 'scheduled') return styles.statusScheduled;
  if (status === 'completed') return styles.statusCompleted;
  return styles.statusCancelled;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButtonText: {
    color: colors.goldDark,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  loading: {
    marginTop: 40,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    backgroundColor: colors.surface,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardType: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  statusScheduled: {
    color: colors.goldDark,
    backgroundColor: '#F3E9C9',
  },
  statusCompleted: {
    color: colors.success,
    backgroundColor: '#DCF0E3',
  },
  statusCancelled: {
    color: colors.textMuted,
    backgroundColor: colors.border,
  },
  cardDate: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
  },
  cancelButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
    fontSize: 14,
  },
});
