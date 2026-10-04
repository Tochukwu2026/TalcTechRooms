import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '@/theme/colors';

// A tappable date field backed by the platform's native date picker, replacing the earlier
// plain "type YYYY-MM-DD yourself" text boxes (error-prone - any typo or wrong format just
// silently failed the availability/viewing lookup with no hint why). Value stays a plain
// 'YYYY-MM-DD' string everywhere else in the app (what every endpoint expects), so this
// component is the only place that touches a real Date object.

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  // New Date('YYYY-MM-DD') parses as UTC midnight, which can roll back a day in a negative UTC
  // offset timezone when later formatted locally - constructing from parts avoids that.
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

interface DateFieldProps {
  label: string;
  value: string; // 'YYYY-MM-DD', or '' for unset
  onChange: (value: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  style?: object;
}

export default function DateField({ label, value, onChange, minimumDate, maximumDate, style }: DateFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

  function handleChange(event: DateTimePickerEvent, selected?: Date) {
    // Android's picker is a one-shot modal dialog (closes itself on pick/cancel); iOS's inline
    // spinner stays open until dismissed explicitly, so only Android auto-closes here.
    if (Platform.OS === 'android') {
      setIsOpen(false);
    }
    if (event.type === 'dismissed') return;
    if (selected) {
      onChange(toIsoDate(selected));
    }
  }

  return (
    <>
      <Pressable style={[styles.field, style]} onPress={() => setIsOpen(true)}>
        <Text style={styles.label}>{label}</Text>
        <Text style={value ? styles.value : styles.placeholder}>{value || 'Select date'}</Text>
      </Pressable>
      {isOpen ? (
        <DateTimePicker
          value={value ? parseIsoDate(value) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      ) : null}
      {/* iOS's inline picker has no built-in "Done" button - this closes it. */}
      {isOpen && Platform.OS === 'ios' ? (
        <Pressable style={styles.doneButton} onPress={() => setIsOpen(false)}>
          <Text style={styles.doneButtonText}>Done</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2,
  },
  value: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  placeholder: {
    fontSize: 15,
    color: colors.textMuted,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneButtonText: {
    color: colors.goldDark,
    fontWeight: '600',
    fontSize: 14,
  },
});
