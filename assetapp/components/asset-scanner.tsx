import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

/**
 * Admin header action: scan an asset's QR sticker and open its asset record.
 *
 * The sticker encodes the asset code (e.g. `AST-IE-DL-X7Q2`) — the same value
 * the registry writes into `Asset_code` — but a scanned URL or a plain numeric
 * id is accepted too, so an older sticker or a web link still resolves. The
 * lookup runs against the live `assets` table, so whatever the sticker says is
 * only trusted if a real asset matches it.
 */

const ASSET_CODE_PATTERN = /AST-[A-Z0-9]+(?:-[A-Z0-9]+)*/;
const ASSET_SELECT = 'id, Asset_code, Asset_name, Lifecycle_Status';

/** Pull the asset key out of whatever the QR code carries. */
export const extractAssetKey = (raw: unknown): string => {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const match = text.toUpperCase().match(ASSET_CODE_PATTERN);
  if (match) return match[0];
  if (/^\d+$/.test(text)) return text;
  const tail = text.split(/[/?#]/).filter(Boolean).pop() ?? text;
  return tail.replace(/\.(png|jpe?g)$/i, '').trim();
};

export type ScannedAsset = { id: string; code: string; name: string };

const toScannedAsset = (row: any): ScannedAsset => ({
  id: String(row?.id ?? ''),
  code: String(row?.Asset_code ?? ''),
  name: String(row?.Asset_name ?? ''),
});

/** Resolve a scanned payload to one asset row (by id or by asset code). */
export async function findAssetByScan(raw: unknown): Promise<ScannedAsset | null> {
  const key = extractAssetKey(raw);
  if (!key) return null;

  const numeric = Number(key);
  const byNumericId = Number.isFinite(numeric) && String(numeric) === key;

  const exact = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .eq(byNumericId ? 'id' : 'Asset_code', byNumericId ? numeric : key)
    .maybeSingle();
  if (!exact.error && exact.data) return toScannedAsset(exact.data);

  // Stickers printed before the code was normalised can differ in casing.
  const loose = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .ilike('Asset_code', key)
    .maybeSingle();
  if (!loose.error && loose.data) return toScannedAsset(loose.data);

  return null;
}

export function AssetScanButton({
  color = '#FFFFFF',
  size = 24,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [visible, setVisible] = useState(false);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One scan fires once — the camera keeps emitting while the sticker is in view.
  const locked = useRef(false);

  const closeScanner = () => {
    setVisible(false);
    setLooking(false);
    setNotice(null);
    locked.current = false;
  };

  const openScanner = async () => {
    setNotice(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to scan asset QR codes.');
        return;
      }
    }
    locked.current = false;
    setVisible(true);
  };

  const unlockSoon = () => {
    setTimeout(() => {
      locked.current = false;
    }, 1400);
  };

  const handleScanned = async (raw: unknown) => {
    if (locked.current) return;
    locked.current = true;
    setLooking(true);
    setNotice(null);

    try {
      const asset = await findAssetByScan(raw);
      if (!asset || !asset.id) {
        setNotice('No asset matches this QR code. Make sure the sticker belongs to a registered asset.');
        setLooking(false);
        unlockSoon();
        return;
      }
      closeScanner();
      // Opens the same asset record the Assets list uses.
      router.push({ pathname: '/asset-details', params: { id: asset.id } });
    } catch (error) {
      console.error('Asset scan lookup failed:', error);
      setNotice('Could not look up the asset. Check your connection and scan again.');
      setLooking(false);
      unlockSoon();
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.button, style]}
        activeOpacity={0.75}
        onPress={openScanner}
        accessibilityRole="button"
        accessibilityLabel="Scan asset QR code"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialCommunityIcons name="qrcode-scan" size={size} color={color} />
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" onRequestClose={closeScanner}>
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View style={styles.scannerHeaderSpacer} />
            <Text style={styles.scannerTitle}>Scan Asset QR</Text>
            <TouchableOpacity
              style={styles.scannerClose}
              onPress={closeScanner}
              activeOpacity={0.8}
              accessibilityLabel="Close scanner"
            >
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.cameraWrap}>
            {/* Only mounted while the modal is open, so the header button never
                keeps the camera running in the background. */}
            {visible ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleScanned(data)}
              />
            ) : null}
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Point the camera at the QR sticker on the asset</Text>
            <Text style={styles.scanSubHint}>Its details open as soon as the code is read</Text>

            {looking ? (
              <View style={styles.lookupCard}>
                <ActivityIndicator color="#FBBF24" />
                <Text style={styles.lookupText}>Looking up asset…</Text>
              </View>
            ) : null}

            {notice ? (
              <View style={styles.noticeCard}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#FCA5A5" />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

export default AssetScanButton;

const styles = StyleSheet.create({
  // Same 42×42 tap target as the notification cluster it sits beside, so the
  // header row is evenly spaced.
  button: {
    position: 'relative',
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerContainer: { flex: 1, backgroundColor: '#0F172A' },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#0F172A',
  },
  scannerHeaderSpacer: { width: 42 },
  scannerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  scannerClose: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scanHint: { marginTop: 18, color: '#E2E8F0', fontSize: 14, fontWeight: '700' },
  scanSubHint: { marginTop: 5, color: 'rgba(226,232,240,0.65)', fontSize: 12 },
  lookupCard: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lookupText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '600' },
  noticeCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(127,29,29,0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noticeText: { flex: 1, color: '#FEE2E2', fontSize: 12.5, lineHeight: 17 },
});
