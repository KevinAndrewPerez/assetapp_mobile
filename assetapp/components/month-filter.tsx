import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  monthKeyFor,
  monthLabel,
  monthOptionsForYear,
  recentMonthOptions,
  type YearMonthOption,
} from '@/lib/monthFilter';

/**
 * Month-and-year filter for the Requests lists.
 *
 * The last six months are one tap away (that is the month being worked on, nine
 * times out of ten), and "Choose month" opens the full calendar so any month of
 * any year — a request filed in 2024, a period a panel asks about — can be
 * filtered too. "All time" clears the filter and restores the unfiltered list.
 *
 * The filter itself is applied in the Supabase query by the screens (see
 * `monthBounds`), so the phone never downloads years of rows to hide them.
 */

/** No NU Trace record predates this, and a typo cannot scroll to year 90210. */
const EARLIEST_YEAR = 2000;

export function MonthFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const recent = useMemo(() => recentMonthOptions(6), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const thisYear = new Date().getFullYear();
  const selectedYear = value ? Number(value.slice(0, 4)) || thisYear : thisYear;
  const [pickerYear, setPickerYear] = useState(selectedYear);

  // Open on the year already filtered (so changing the month is one tap), not
  // through an effect after the modal appears.
  const openPicker = () => {
    setPickerYear(selectedYear);
    setPickerOpen(true);
  };

  // A month outside the recent chips still needs to be visible as active,
  // otherwise opening an old filtered list looks like "All time".
  const olderSelection = value && !recent.some((month) => month.key === value) ? value : null;

  const choose = (key: string) => {
    onChange(key);
    setPickerOpen(false);
  };

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bar}
        contentContainerStyle={styles.row}
      >
        <TouchableOpacity
          style={[styles.chip, value === null && styles.chipActive]}
          onPress={() => onChange(null)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: value === null }}
          accessibilityLabel="Show requests from all time"
        >
          <Text style={[styles.chipText, value === null && styles.chipTextActive]}>All time</Text>
        </TouchableOpacity>

        {olderSelection ? (
          <TouchableOpacity
            style={[styles.chip, styles.chipActive]}
            onPress={openPicker}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: true }}
            accessibilityLabel={`Filtered to ${monthLabel(olderSelection)}. Open the month picker`}
          >
            <MaterialCommunityIcons name="calendar-blank-outline" size={14} color="#FFFFFF" />
            <Text style={[styles.chipText, styles.chipTextActive]}>{monthLabel(olderSelection)}</Text>
          </TouchableOpacity>
        ) : null}

        {recent.map((month) => {
          const active = value === month.key;
          return (
            <TouchableOpacity
              key={month.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onChange(active ? null : month.key)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter to ${month.label}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{month.label}</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={styles.chip}
          onPress={openPicker}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Choose another month and year"
        >
          <MaterialCommunityIcons name="calendar-search" size={15} color="#475569" />
          <Text style={styles.chipText}>Choose month</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filter by month</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setPickerOpen(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Close the month picker"
              >
                <MaterialCommunityIcons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            <View style={styles.yearRow}>
              <TouchableOpacity
                style={[styles.yearButton, pickerYear <= EARLIEST_YEAR && styles.yearButtonDisabled]}
                onPress={() => setPickerYear((year) => Math.max(EARLIEST_YEAR, year - 1))}
                disabled={pickerYear <= EARLIEST_YEAR}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Previous year"
              >
                <MaterialCommunityIcons name="chevron-left" size={22} color="#0F172A" />
              </TouchableOpacity>
              <Text style={styles.yearText}>{pickerYear}</Text>
              <TouchableOpacity
                style={[styles.yearButton, pickerYear >= thisYear && styles.yearButtonDisabled]}
                onPress={() => setPickerYear((year) => Math.min(thisYear, year + 1))}
                disabled={pickerYear >= thisYear}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Next year"
              >
                <MaterialCommunityIcons name="chevron-right" size={22} color="#0F172A" />
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              {monthOptionsForYear(pickerYear).map((month: YearMonthOption) => {
                const isSelected = value === monthKeyFor(pickerYear, month.month);
                return (
                  <TouchableOpacity
                    key={month.key}
                    style={[
                      styles.gridCell,
                      isSelected && styles.gridCellActive,
                      month.isFuture && styles.gridCellDisabled,
                    ]}
                    onPress={() => choose(month.key)}
                    disabled={month.isFuture}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: month.isFuture }}
                    accessibilityLabel={`${month.label} ${pickerYear}`}
                  >
                    <Text
                      style={[
                        styles.gridCellText,
                        isSelected && styles.gridCellTextActive,
                        month.isFuture && styles.gridCellTextDisabled,
                      ]}
                    >
                      {month.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  onChange(null);
                  setPickerOpen(false);
                }}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="filter-remove-outline" size={16} color="#1E3A5F" />
                <Text style={styles.clearText}>Clear filter</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>{value ? monthLabel(value) : 'All time'}</Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  chip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#0C134F', borderColor: '#0C134F' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFFFFF' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(12,19,79,0.55)',
    padding: 22,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 12,
  },
  yearButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  yearButtonDisabled: { opacity: 0.35 },
  yearText: { fontSize: 17, fontWeight: '800', color: '#0C134F', letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  gridCell: {
    width: '31%',
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#EDF1F7',
  },
  gridCellActive: { backgroundColor: '#0C134F', borderColor: '#0C134F' },
  gridCellDisabled: { opacity: 0.4 },
  gridCellText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  gridCellTextActive: { color: '#FFFFFF' },
  gridCellTextDisabled: { color: '#94A3B8' },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 10,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#FDB833',
  },
  clearText: { fontSize: 12.5, fontWeight: '800', color: '#1E3A5F' },
  hint: { fontSize: 12, fontWeight: '700', color: '#64748B' },
});
