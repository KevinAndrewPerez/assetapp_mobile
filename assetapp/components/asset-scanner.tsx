import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { resolveActingUserLabel } from '@/lib/actorService';
import {
  QR_BLOCKING,
  recordSuspiciousScan,
  verifyScannedQr,
  type QrScanResult,
  type QrTone,
  type ScannedAsset,
} from '@/lib/qrVerification';

/**
 * Admin header action: scan an asset's QR sticker and open its asset record.
 *
 * A sticker carries a *signed* payload (`NUT1-<code>-<key>-<signature>`) or, on
 * paper printed before signing existed, a plain asset code. `verifyScannedQr`
 * reads either shape and checks the signature on the device against the
 * deployment's public keys, then the asset is looked up by the code it carries -
 * the encoded information is trusted as an identifier only, never as a source
 * of details.
 *
 * A sticker that fails verification must not open an asset record: showing
 * genuine details behind a forged code is exactly what verification exists to
 * prevent. Those scans are kept in the shared audit trail as well.
 */

const ASSET_CODE_PATTERN = /AST-[A-Z0-9]+(?:-[A-Z0-9]+)*/;

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

export type { ScannedAsset } from '@/lib/qrVerification';

/**
 * Resolve a scanned payload to one asset row.
 *
 * Kept as the simple entry point for callers that only want the asset; it
 * deliberately returns nothing for a sticker the verifier refuses, so it can
 * never be used to bypass the authenticity check.
 */
export async function findAssetByScan(raw: unknown): Promise<ScannedAsset | null> {
  const result = await verifyScannedQr(raw);
  if (QR_BLOCKING.includes(result.status)) return null;
  return result.asset;
}

const TONE_STYLES: Record<QrTone, { background: string; ink: string; icon: string; border: string }> = {
  danger: { background: 'rgba(127,29,29,0.94)', ink: '#FEE2E2', icon: '#FCA5A5', border: 'rgba(252,165,165,0.4)' },
  warning: { background: 'rgba(120,53,15,0.94)', ink: '#FEF3C7', icon: '#FCD34D', border: 'rgba(252,211,77,0.4)' },
  neutral: { background: 'rgba(30,41,59,0.94)', ink: '#E2E8F0', icon: '#94A3B8', border: 'rgba(148,163,184,0.4)' },
  ok: { background: 'rgba(6,78,59,0.94)', ink: '#D1FAE5', icon: '#6EE7B7', border: 'rgba(110,231,183,0.4)' },
};

const TONE_ICONS: Record<QrTone, keyof typeof MaterialCommunityIcons.glyphMap> = {
  danger: 'shield-alert-outline',
  warning: 'alert-outline',
  neutral: 'information-outline',
  ok: 'shield-check-outline',
};

export type ScanLauncher = {
  visible: boolean;
  open: () => Promise<void>;
  close: () => void;
};

/**
 * Camera permission plus the open/close state every scan entry point needs.
 *
 * The admin header button and Repair Management's "New Repair" both begin the
 * same way — ask for the camera once, explain a refusal, and only then show the
 * scanner — so that decision lives here instead of being copied per screen.
 */
export function useScannerLauncher(): ScanLauncher {
  const [permission, requestPermission] = useCameraPermissions();
  const [visible, setVisible] = useState(false);

  const open = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        // `canAskAgain === false` means the OS will no longer show the prompt:
        // the only way forward is the system settings page.
        if (result.canAskAgain === false) {
          Alert.alert(
            'Camera permission blocked',
            'Camera access is turned off for NU Trace. Open Settings and allow Camera to scan asset QR codes.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => void Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert(
            'Camera permission needed',
            'Camera access is required to scan asset QR codes. You can allow it the next time you tap Scan.',
          );
        }
        return;
      }
    }
    setVisible(true);
  }, [permission, requestPermission]);

  const close = useCallback(() => setVisible(false), []);

  return { visible, open, close };
}

/**
 * The scanner itself.
 *
 * Shared by the header scan button (which opens the asset record) and Repair
 * Management's scan-first "New Repair" (which hands the verified asset back to
 * its own screen). Verification, the retry notice and the "one scan fires
 * once" lock are therefore identical for both — there is no second scanner to
 * drift, and a refused sticker still cannot open or change anything.
 */
export function AssetScannerModal({
  visible,
  onClose,
  onVerified,
  title = 'Scan Asset QR',
}: {
  visible: boolean;
  onClose: () => void;
  /** When set, a verified sticker is handed to the caller instead of navigating. */
  onVerified?: (asset: ScannedAsset) => void;
  title?: string;
}) {
  const router = useRouter();
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState<QrScanResult | null>(null);
  // Camera hardware/mount failures (no camera, camera busy) have their own line,
  // because retrying the scan cannot fix them.
  const [cameraError, setCameraError] = useState<string | null>(null);
  // One scan fires once — the camera keeps emitting while the sticker is in view.
  const locked = useRef(false);

  const closeScanner = () => {
    setLooking(false);
    setNotice(null);
    setCameraError(null);
    locked.current = false;
    onClose();
  };

  /** Clear the last verdict and let the camera read the sticker again. */
  const rescan = () => {
    setNotice(null);
    setLooking(false);
    locked.current = false;
  };

  const openAsset = (asset: ScannedAsset) => {
    closeScanner();
    // A caller that wants the asset itself (New Repair) receives it here;
    // every other entry point opens the asset record the Assets list uses.
    if (onVerified) {
      onVerified(asset);
      return;
    }
    router.push({ pathname: '/asset-details', params: { id: asset.id } });
  };

  const handleScanned = async (raw: unknown) => {
    if (locked.current) return;
    locked.current = true;
    setLooking(true);
    setNotice(null);

    try {
      const result = await verifyScannedQr(raw);

      if (result.status === 'valid' && result.asset) {
        openAsset(result.asset);
        return;
      }

      // A refused sticker never opens an asset, and is worth remembering. The
      // audit write is best-effort: if it fails, the refusal must still be shown
      // (losing the log is not a reason to let the sticker through).
      if (QR_BLOCKING.includes(result.status)) {
        try {
          const actor = await resolveActingUserLabel();
          await recordSuspiciousScan(result, actor.id);
        } catch (auditError) {
          console.warn('Rejected QR scan could not be logged:', auditError);
        }
      }

      setNotice(result);
      setLooking(false);
    } catch (error) {
      console.error('Asset scan lookup failed:', error);
      // The sticker is not at fault when the lookup itself failed, so this is a
      // retryable notice, never a "fake code" verdict.
      setNotice({
        status: 'unavailable',
        label: 'Could not read the sticker',
        tone: 'neutral',
        detail: 'Check your connection and scan again.',
        signed: false,
        keyId: null,
        code: null,
        asset: null,
        permitted: false,
      });
      setLooking(false);
    }
  };

  const noticeTone = notice ? TONE_STYLES[notice.tone] : TONE_STYLES.neutral;
  // A refused sticker must never offer a way into the asset record — that is
  // exactly what the authenticity check exists to prevent. Only a warning that
  // did not block verification (an unsigned legacy sticker) may open it.
  const noticeAsset =
    notice && notice.asset && !QR_BLOCKING.includes(notice.status) ? notice.asset : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeScanner}>
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View style={styles.scannerHeaderSpacer} />
            <Text style={styles.scannerTitle}>{title}</Text>
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
                // Reading pauses while a lookup runs or a verdict is on screen,
                // so the same sticker cannot trigger a second lookup.
                onBarcodeScanned={
                  looking || notice || cameraError ? undefined : ({ data }) => void handleScanned(data)
                }
                onMountError={(event) => {
                  const message = String((event as { message?: string })?.message ?? '');
                  console.warn('Scanner camera failed to start:', message);
                  setCameraError(
                    /permission/i.test(message)
                      ? 'The camera is not available. Check the Camera permission in your phone settings.'
                      : 'The camera could not start. Close this screen and try again.',
                  );
                }}
              />
            ) : null}
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Point the camera at the QR sticker on the asset</Text>
            <Text style={styles.scanSubHint}>
              {onVerified
                ? 'You will confirm what happens next before anything changes'
                : 'Its details open as soon as the code is read'}
            </Text>

            {looking ? (
              <View style={styles.lookupCard}>
                <ActivityIndicator color="#FBBF24" />
                <Text style={styles.lookupText}>Checking sticker…</Text>
              </View>
            ) : null}

            {cameraError && !looking ? (
              <View style={[styles.noticeCard, { backgroundColor: TONE_STYLES.neutral.background, borderColor: TONE_STYLES.neutral.border }]}>
                <View style={styles.noticeHeader}>
                  <MaterialCommunityIcons name="camera-off-outline" size={18} color={TONE_STYLES.neutral.icon} />
                  <Text style={[styles.noticeTitle, { color: TONE_STYLES.neutral.ink }]}>Camera unavailable</Text>
                </View>
                <Text style={[styles.noticeText, { color: TONE_STYLES.neutral.ink }]}>{cameraError}</Text>
                <View style={styles.noticeActions}>
                  <TouchableOpacity
                    style={styles.noticeAction}
                    activeOpacity={0.8}
                    onPress={() => setCameraError(null)}
                  >
                    <Text style={styles.noticeActionText}>Try again</Text>
                    <MaterialCommunityIcons name="refresh" size={16} color="#0A1830" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.noticeAction, styles.noticeActionGhost]}
                    activeOpacity={0.8}
                    onPress={closeScanner}
                  >
                    <Text style={[styles.noticeActionText, styles.noticeActionGhostText]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {notice && !looking && !cameraError ? (
              <View style={[styles.noticeCard, { backgroundColor: noticeTone.background, borderColor: noticeTone.border }]}>
                <View style={styles.noticeHeader}>
                  <MaterialCommunityIcons name={TONE_ICONS[notice.tone]} size={18} color={noticeTone.icon} />
                  <Text style={[styles.noticeTitle, { color: noticeTone.ink }]}>{notice.label}</Text>
                </View>
                <Text style={[styles.noticeText, { color: noticeTone.ink }]}>{notice.detail}</Text>

                <View style={styles.noticeActions}>
                  <TouchableOpacity style={styles.noticeAction} activeOpacity={0.8} onPress={rescan}>
                    <Text style={styles.noticeActionText}>Scan again</Text>
                    <MaterialCommunityIcons name="qrcode-scan" size={16} color="#0A1830" />
                  </TouchableOpacity>
                  {noticeAsset ? (
                    <TouchableOpacity
                      style={[styles.noticeAction, styles.noticeActionGhost]}
                      activeOpacity={0.8}
                      onPress={() => openAsset(noticeAsset)}
                    >
                      <Text style={[styles.noticeActionText, styles.noticeActionGhostText]}>
                        {onVerified ? 'Use this asset' : 'View asset anyway'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
  );
}

/** The admin header action: scan a sticker, then open that asset's record. */
export function AssetScanButton({
  color = '#FFFFFF',
  size = 24,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scanner = useScannerLauncher();

  return (
    <>
      <TouchableOpacity
        style={[styles.button, style]}
        activeOpacity={0.75}
        onPress={() => void scanner.open()}
        accessibilityRole="button"
        accessibilityLabel="Scan asset QR code"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialCommunityIcons name="qrcode-scan" size={size} color={color} />
      </TouchableOpacity>

      <AssetScannerModal visible={scanner.visible} onClose={scanner.close} />
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
    bottom: 30,
    left: 20,
    right: 20,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 7,
  },
  noticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeTitle: { fontSize: 13.5, fontWeight: '800' },
  noticeText: { fontSize: 12.5, lineHeight: 17.5 },
  noticeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  noticeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FDB833',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    // A comfortable target even on a small phone.
    minHeight: 36,
  },
  noticeActionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  noticeActionText: { color: '#0A1830', fontSize: 12.5, fontWeight: '800' },
  noticeActionGhostText: { color: '#FFFFFF' },
});
