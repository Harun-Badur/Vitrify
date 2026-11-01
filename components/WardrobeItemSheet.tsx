import { memo, useEffect, useMemo, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Pencil, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';

const ROW_HEIGHT = 56;
const THUMB_SIZE = 48;
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.8;

interface WardrobeItemSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  imageUri?: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Dolap kıyafet kartı seçenekleri: Düzenle / Sil (silmede sayfa içi onay). */
function WardrobeItemSheet({ visible, title, subtitle, imageUri, onClose, onEdit, onDelete }: WardrobeItemSheetProps) {
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!visible) setConfirming(false);
  }, [visible]);
  const dragToClose = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) onClose();
        },
      }),
    [onClose],
  );
  const edit = (): void => {
    onClose();
    onEdit();
  };
  const remove = (): void => {
    onClose();
    onDelete();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat" />
      <View
        style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
        accessibilityViewIsModal
        {...dragToClose.panHandlers}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <View style={styles.thumb} />
          )}
          <View style={styles.headerCopy}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>
        {confirming ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmTitle} accessibilityRole="header">Bu kıyafet silinsin mi?</Text>
            <View style={styles.confirmRow}>
              <PressableScale onPress={() => setConfirming(false)} style={[styles.confirmButton, styles.cancelButton]}
                accessibilityRole="button" accessibilityLabel="Vazgeç">
                <Text style={styles.cancelText}>Vazgeç</Text>
              </PressableScale>
              <PressableScale onPress={remove} style={[styles.confirmButton, styles.deleteButton]}
                accessibilityRole="button" accessibilityLabel="Kıyafeti sil">
                <Text style={styles.deleteText}>Sil</Text>
              </PressableScale>
            </View>
          </View>
        ) : (
          <View style={styles.actions}>
            <PressableScale onPress={edit} style={styles.row} accessibilityRole="button" accessibilityLabel="Düzenle">
              <Pencil color={colors.text} size={20} />
              <Text style={styles.rowText}>Düzenle</Text>
            </PressableScale>
            <PressableScale onPress={() => setConfirming(true)} style={styles.row} accessibilityRole="button"
              accessibilityLabel="Sil">
              <Trash2 color={colors.destructive} size={20} />
              <Text style={[styles.rowText, styles.destructiveText]}>Sil</Text>
            </PressableScale>
          </View>
        )}
      </View>
    </Modal>
  );
}

export default memo(WardrobeItemSheet);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, opacity: 0.35 },
  sheet: {
    backgroundColor: colors.input,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.chip,
    backgroundColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: spacing.md, backgroundColor: colors.surface },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 12 },
  actions: { gap: spacing.xs },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.button,
  },
  rowText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  destructiveText: { color: colors.destructive },
  confirm: { gap: spacing.md },
  confirmTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  confirmRow: { flexDirection: 'row', gap: spacing.md },
  confirmButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: { borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  deleteButton: { backgroundColor: colors.destructive },
  deleteText: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
});
