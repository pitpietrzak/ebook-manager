import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { registerWebAlertListener, WebAlertRequest } from '../utils/alert';

// Renders showAlert() calls as an in-app dialog on web. Mounted only on web.
export default function WebAlertHost() {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<WebAlertRequest[]>([]);

  useEffect(() => {
    registerWebAlertListener((request) => setQueue((q) => [...q, request]));
    return () => registerWebAlertListener(null);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const cancelButton = current.buttons.find((b) => b.style === 'cancel');

  const close = (onPress?: () => void) => {
    setQueue((q) => q.slice(1));
    onPress?.();
  };

  // Cancel goes last so the primary action sits on top in stacked layout.
  const ordered = [
    ...current.buttons.filter((b) => b.style !== 'cancel'),
    ...(cancelButton ? [cancelButton] : []),
  ];
  const stacked = ordered.length > 2;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => close(cancelButton?.onPress)}>
      <Pressable style={styles.backdrop} onPress={() => cancelButton && close(cancelButton.onPress)}>
        <Pressable style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>
          {current.message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>{current.message}</Text>
          ) : null}
          <View style={stacked ? styles.buttonsStacked : styles.buttonsRow}>
            {(stacked ? ordered : [...ordered].reverse()).map((button, i) => {
              const isCancel = button.style === 'cancel';
              const isDestructive = button.style === 'destructive';
              return (
                <TouchableOpacity
                  key={`${button.text}-${i}`}
                  style={[
                    styles.button,
                    stacked && styles.buttonStacked,
                    !isCancel && { backgroundColor: isDestructive ? '#D32F2F' : colors.primary },
                    isCancel && { borderColor: colors.border, borderWidth: 1 },
                  ]}
                  onPress={() => close(button.onPress)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      { color: isCancel ? colors.text : '#fff' },
                    ]}
                  >
                    {button.text || 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  message: { fontSize: 15, lineHeight: 21, marginBottom: 4 },
  buttonsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  buttonsStacked: { gap: 10, marginTop: 18 },
  button: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center' },
  buttonStacked: { width: '100%' },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
