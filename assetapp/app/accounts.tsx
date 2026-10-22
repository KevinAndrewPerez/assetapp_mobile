/**
 * Accounts — the Asset Management Office's list of who can sign in to NU Trace.
 *
 * The web's /admin/employees/accounts page is the model: search and filter the
 * accounts, then grant or take away a role, move someone between departments,
 * or lock / unlock sign-in. The same guards travel with it (the last active
 * Administrator cannot be demoted or switched off) because they protect the
 * system, not the page.
 *
 * Employee records themselves are a separate masterlist and are not editable
 * here: registering accounts, and the CSV bulk import that goes with it, stay
 * on the web.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Chip, EmptyState, ListSkeleton, ScreenHeader, SearchBar } from '@/components/ui';
import { colors } from '@/lib/theme';
import { fetchDepartments, type DepartmentOption } from '@/lib/userService';
import {
  ACCOUNT_ROLES,
  accountDisplayName,
  changeAccountDepartment,
  changeAccountRole,
  changeAccountStatus,
  DEFAULT_ACCOUNT_FILTERS,
  fetchAccountCounts,
  fetchAccountPage,
  type AccountActor,
  type AccountFilters,
  type AccountRow,
} from '@/lib/accountService';

const STATUS_FILTERS = ['', 'Active', 'Inactive'] as const;

const roleTone = (role: string): { bg: string; fg: string } => {
  if (role === 'Admin') return { bg: '#EDE9FE', fg: '#5B21B6' };
  if (role === 'Department Head') return { bg: '#E0F2FE', fg: '#075985' };
  if (role === 'Employee') return { bg: '#F1F5F9', fg: '#334155' };
  return { bg: '#FEF3C7', fg: '#92400E' };
};

export default function AccountsScreen() {
  const router = useRouter();
  const [actor, setActor] = useState<AccountActor & { role: string }>({ id: null, label: 'Admin', role: '' });
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<AccountFilters>(DEFAULT_ACCOUNT_FILTERS);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState<{ total: number; inactive: number }>({ total: 0, inactive: 0 });
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [busy, setBusy] = useState(false);

  /* ── who is asking ─────────────────────────────────────────────────── */

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('user');
        const user = raw ? JSON.parse(raw) : null;
        if (user) {
          setActor({
            id: user.id ?? null,
            label: String(user.full_name ?? user.email ?? 'Admin'),
            role: String(user.role ?? ''),
          });
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const isAdmin = actor.role === 'Admin';

  /* ── data ──────────────────────────────────────────────────────────── */

  const loadFirstPage = useCallback(async () => {
    try {
      setLoading(true);
      const [firstPage, summary] = await Promise.all([fetchAccountPage(filters, 0), fetchAccountCounts()]);
      setRows(firstPage.rows);
      setHasMore(firstPage.hasMore);
      setPage(0);
      setCounts(summary);
    } catch (error) {
      console.error('Failed to load accounts:', error);
      Alert.alert('Error', 'Could not load the account list. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchAccountPage(filters, page + 1);
      setRows((current) => [...current, ...next.rows]);
      setHasMore(next.hasMore);
      setPage((current) => current + 1);
    } catch (error) {
      console.error('Failed to load more accounts:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, hasMore, loadingMore, page]);

  useFocusEffect(
    useCallback(() => {
      if (!ready || !isAdmin) return;
      loadFirstPage();
    }, [ready, isAdmin, loadFirstPage]),
  );

  useEffect(() => {
    if (!ready || !isAdmin) return;
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, [ready, isAdmin]);

  // Searching is server-side; debounce so a fast typist does not fire a query
  // per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.q === search ? current : { ...current, q: search }));
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  };

  const patchFilters = (patch: Partial<AccountFilters>) => setFilters((current) => ({ ...current, ...patch }));

  /* ── mutations ─────────────────────────────────────────────────────── */

  const runMutation = async (
    title: string,
    confirm: string | null,
    action: () => Promise<{ ok: boolean; message: string }>,
  ) => {
    const execute = async () => {
      setBusy(true);
      try {
        const result = await action();
        Alert.alert(result.ok ? title : 'Not allowed', result.message);
        if (result.ok) {
          setSelected(null);
          await loadFirstPage();
        }
      } catch (error) {
        console.error('Account update failed:', error);
        Alert.alert('Error', (error as any)?.message || 'The change could not be saved.');
      } finally {
        setBusy(false);
      }
    };

    if (!confirm) {
      await execute();
      return;
    }

    Alert.alert(title, confirm, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => void execute() },
    ]);
  };

  const chooseRole = (role: string) => {
    if (!selected) return;
    const account = selected;
    runMutation('Change role', `Make ${accountDisplayName(account)} a ${role}?`, () =>
      changeAccountRole(account.id, role, actor),
    );
  };

  const chooseDepartment = (department: DepartmentOption) => {
    if (!selected) return;
    const account = selected;
    runMutation('Move department', `Move ${accountDisplayName(account)} to ${department.Name}?`, () =>
      changeAccountDepartment(account.id, Number(department.id), actor),
    );
  };

  const toggleStatus = () => {
    if (!selected) return;
    const account = selected;
    const next = account.status === 'Active' ? 'Inactive' : 'Active';
    runMutation(
      next === 'Inactive' ? 'Deactivate account' : 'Reactivate account',
      next === 'Inactive'
        ? `${accountDisplayName(account)} will no longer be able to sign in. Their records and requests stay untouched.`
        : `${accountDisplayName(account)} will be able to sign in again.`,
      () => changeAccountStatus(account.id, next, actor),
    );
  };

  const filterCount = useMemo(
    () => [filters.q, filters.role, filters.status, filters.department].filter((value) => value !== '' && value !== null).length,
    [filters],
  );

  /* ── render ────────────────────────────────────────────────────────── */

  if (!ready) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Accounts" onBack={() => router.back()} />
        <View style={styles.body}>
          <ListSkeleton rows={4} />
        </View>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Accounts" onBack={() => router.back()} />
        <View style={styles.body}>
          <EmptyState
            icon="shield-lock-outline"
            title="Not allowed"
            message="Only the Asset Management Office (Administrator) can manage accounts."
            action={<Button label="Go back" icon="arrow-left" onPress={() => router.back()} />}
          />
        </View>
      </View>
    );
  }

  const header = (
    <View style={styles.filters}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, employee number, email…" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        <Chip label="All roles" active={filters.role === ''} onPress={() => patchFilters({ role: '' })} />
        {ACCOUNT_ROLES.map((role) => (
          <Chip
            key={role}
            label={role}
            active={filters.role === role}
            onPress={() => patchFilters({ role: filters.role === role ? '' : role })}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        <Chip label="Any status" active={filters.status === ''} onPress={() => patchFilters({ status: '' })} />
        {STATUS_FILTERS.filter(Boolean).map((status) => (
          <Chip
            key={status}
            label={status}
            active={filters.status === status}
            onPress={() => patchFilters({ status: filters.status === status ? '' : status })}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        <Chip
          label="All departments"
          active={filters.department === null}
          onPress={() => patchFilters({ department: null })}
        />
        {departments.map((department) => (
          <Chip
            key={String(department.id)}
            label={department.Name}
            active={filters.department === Number(department.id)}
            onPress={() =>
              patchFilters({
                department: filters.department === Number(department.id) ? null : Number(department.id),
              })
            }
          />
        ))}
      </ScrollView>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {counts.total} account{counts.total === 1 ? '' : 's'} · {counts.inactive} inactive
          {filterCount > 0 ? ' · filtered' : ''}
        </Text>
        {filterCount > 0 ? (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              setFilters(DEFAULT_ACCOUNT_FILTERS);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.clearText}>Clear filters</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Accounts"
        subtitle="Who can sign in to NU Trace"
        onBack={() => router.back()}
        right={counts.total > 0 ? <View style={styles.headerSpacer} /> : undefined}
      />

      <FlatList
        style={styles.body}
        data={loading ? [] : rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? <ListSkeleton rows={5} /> : (
            <EmptyState
              icon="account-search-outline"
              title="No accounts found"
              message="Try a different search or clear the filters. Accounts are created on the web when an employee registers."
            />
          )
        }
        renderItem={({ item }) => (
          <AccountCard account={item} onPress={() => setSelected(item)} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footerLoading} color={colors.navy800} />
          ) : hasMore ? (
            <Button label="Load more" variant="soft" onPress={loadMore} style={styles.loadMore} />
          ) : rows.length > 0 ? (
            <Text style={styles.endText}>End of account list</Text>
          ) : null
        }
      />

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            {selected ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle} numberOfLines={1}>
                      {accountDisplayName(selected)}
                    </Text>
                    <Text style={styles.sheetSubtitle} numberOfLines={1}>
                      {selected.email}
                      {selected.employeeNumber ? ` · ${selected.employeeNumber}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.sheetClose} onPress={() => setSelected(null)} activeOpacity={0.8}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.inkSoft} />
                  </TouchableOpacity>
                </View>

                <View style={styles.sheetMetaRow}>
                  <Text style={[styles.sheetBadge, { backgroundColor: roleTone(selected.role).bg, color: roleTone(selected.role).fg }]}>
                    {selected.role || 'No role'}
                  </Text>
                  <Text style={[styles.sheetBadge, selected.status === 'Active' ? styles.badgeActive : styles.badgeInactive]}>
                    {selected.status}
                  </Text>
                  {selected.employeeStatus !== 'Active' ? (
                    <Text style={[styles.sheetBadge, styles.badgeWarning]}>Employee record inactive</Text>
                  ) : null}
                </View>

                <Text style={styles.sheetSection}>Role</Text>
                <Text style={styles.sheetHint}>
                  Authority is granted here, never inferred from a promotion or a department move.
                </Text>
                <View style={styles.sheetChips}>
                  {ACCOUNT_ROLES.map((role) => (
                    <Chip
                      key={role}
                      label={role}
                      active={selected.role === role}
                      onPress={() => chooseRole(role)}
                    />
                  ))}
                </View>

                <Text style={styles.sheetSection}>Department</Text>
                <Text style={styles.sheetHint}>
                  Moving someone keeps their identity, history and requests — and their authority.
                </Text>
                <View style={styles.sheetChips}>
                  {departments.map((department) => (
                    <Chip
                      key={String(department.id)}
                      label={department.Name}
                      active={Number(selected.departmentId) === Number(department.id)}
                      onPress={() => chooseDepartment(department)}
                    />
                  ))}
                </View>

                <Text style={styles.sheetSection}>Account access</Text>
                <Text style={styles.sheetHint}>
                  Deactivating is a lock, not a deletion: rows, requests and history stay, and the account can be
                  switched back on at any time.
                </Text>
                <Button
                  label={selected.status === 'Active' ? 'Deactivate account' : 'Reactivate account'}
                  icon={selected.status === 'Active' ? 'lock-outline' : 'lock-open-outline'}
                  variant={selected.status === 'Active' ? 'danger' : 'gold'}
                  loading={busy}
                  onPress={toggleStatus}
                  style={styles.sheetAction}
                />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function AccountCard({ account, onPress }: { account: AccountRow; onPress: () => void }) {
  const tone = roleTone(account.role);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.cardAvatar}>
        <MaterialCommunityIcons name="account-outline" size={22} color={colors.navy800} />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {accountDisplayName(account)}
        </Text>
        <Text style={styles.cardEmail} numberOfLines={1}>
          {account.email || 'No email'}
          {account.employeeNumber ? ` · ${account.employeeNumber}` : ''}
        </Text>
        <View style={styles.cardMetaRow}>
          <Text style={[styles.cardBadge, { backgroundColor: tone.bg, color: tone.fg }]}>
            {account.role || 'No role'}
          </Text>
          <Text
            style={[
              styles.cardBadge,
              account.status === 'Active' ? styles.badgeActive : styles.badgeInactive,
            ]}
          >
            {account.status}
          </Text>
          {account.departmentName ? (
            <Text style={styles.cardDepartment} numberOfLines={1}>
              {account.departmentName}
            </Text>
          ) : null}
        </View>
      </View>

      <MaterialCommunityIcons name="chevron-right" size={22} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  headerSpacer: { width: 38 },
  filters: { gap: 10, paddingTop: 14, paddingBottom: 6 },
  // See transfer.tsx: a bare horizontal ScrollView stretches its chips to the
  // leftover viewport height.
  chipScroll: { flexGrow: 0 },
  chipRow: { alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 2,
  },
  summaryText: { fontSize: 12, color: colors.inkMuted, fontWeight: '600' },
  clearText: { fontSize: 12, color: colors.navy800, fontWeight: '800' },
  listContent: { paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 13,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  cardAvatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 3 },
  cardName: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  cardEmail: { fontSize: 12, color: colors.inkMuted },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  cardBadge: {
    fontSize: 10.5,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeActive: { backgroundColor: '#ECFDF5', color: '#047857' },
  badgeInactive: { backgroundColor: '#FEF2F2', color: '#B91C1C' },
  badgeWarning: { backgroundColor: '#FEF3C7', color: '#92400E' },
  cardDepartment: { fontSize: 11.5, color: colors.inkFaint, fontWeight: '600', flexShrink: 1 },
  footerLoading: { marginVertical: 18 },
  loadMore: { marginHorizontal: 16, marginTop: 14 },
  endText: { textAlign: 'center', color: colors.inkFaint, fontSize: 12, marginTop: 16 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(10,24,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '86%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  sheetSubtitle: { fontSize: 12.5, color: colors.inkMuted, marginTop: 2 },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  sheetBadge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  sheetSection: { fontSize: 13, fontWeight: '800', color: colors.ink, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.4 },
  sheetHint: { fontSize: 12.5, color: colors.inkMuted, marginTop: 4, lineHeight: 17.5 },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  sheetAction: { marginTop: 12 },
});
