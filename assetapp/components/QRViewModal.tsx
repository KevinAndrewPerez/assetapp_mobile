import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';

interface QRViewModalProps {
  visible: boolean;
  onClose: () => void;
  value: string;
  title?: string;
}

const { width } = Dimensions.get('window');

const SIGNED_PREFIX = /^NUT[0-9]{1,2}[-:]/i;

/** Escape a value used as an ILIKE pattern: an asset code is not a pattern. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export default function QRViewModal({ visible, onClose, value, title }: QRViewModalProps) {
  const qrRef = useRef<any>(null);
  // `key` ties a resolved payload to the value it was looked up for, so a
  // different asset can never display the previous asset's sticker.
  const [resolved, setResolved] = useState<{ key: string; payload: string } | null>(null);

  // The web stores the exact text its sticker encodes in `assets.qr_payload`.
  // Showing the plain code on the phone would produce a QR that scans as an
  // *unsigned* sticker even though the office's printed sticker is signed, so
  // prefer the stored payload whenever the asset has one.
  useEffect(() => {
    let active = true;

    const text = String(value ?? '').trim();
    if (!visible || !text || SIGNED_PREFIX.test(text)) return undefined;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('assets')
          .select('qr_payload')
          .ilike('Asset_code', escapeLike(text.toUpperCase()))
          .limit(1)
          .maybeSingle();

        const payload = String(data?.qr_payload ?? '').trim();
        if (active && !error && payload) setResolved({ key: text, payload });
      } catch {
        // A lookup failure leaves the plain code on screen; the code still
        // opens the asset, and the scanner labels it unsigned rather than fake.
      }
    })();

    return () => {
      active = false;
    };
  }, [visible, value]);

  const text = String(value ?? '').trim();
  const storedPayload = resolved?.key === text ? resolved.payload : null;
  const shownValue = SIGNED_PREFIX.test(text) ? text : storedPayload ?? value;
  const isSigned = SIGNED_PREFIX.test(shownValue);

  const getFileUri = () => {
    const safeName = value.replace(/[^a-zA-Z0-9]/g, '_');
    return `${FileSystem.cacheDirectory}QR_${safeName}.png`;
  };

  const handleSaveToGallery = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need permission to save images to your gallery.');
        return;
      }

      if (!qrRef.current || typeof qrRef.current.toDataURL !== 'function') {
        Alert.alert('Error', 'QR Code is not ready yet.');
        return;
      }

      qrRef.current.toDataURL(async (dataURL: string) => {
        try {
          if (!dataURL || typeof dataURL !== 'string') {
            Alert.alert('Error', 'Failed to generate QR code image.');
            return;
          }

          const base64Data = dataURL.includes('base64,')
            ? dataURL.split('base64,')[1]
            : dataURL;

          const fileUri = getFileUri();

          await FileSystem.writeAsStringAsync(fileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });

          const asset = await MediaLibrary.createAssetAsync(fileUri);
          await MediaLibrary.createAlbumAsync('NUTrace QR Codes', asset, false);

          Alert.alert('Success', 'QR Code saved to gallery!');
        } catch (err) {
          console.error('FileSystem/MediaLibrary error:', err);
          Alert.alert('Error', 'Failed to save to gallery.');
        }
      });
    } catch (error) {
      console.error('Error saving QR code:', error);
      Alert.alert('Error', 'Failed to save QR code to gallery.');
    }
  };

  const handleShare = async () => {
    try {
      if (!qrRef.current || typeof qrRef.current.toDataURL !== 'function') {
        Alert.alert('Error', 'QR Code is not ready yet.');
        return;
      }

      qrRef.current.toDataURL(async (dataURL: string) => {
        try {
          if (!dataURL || typeof dataURL !== 'string') {
            Alert.alert('Error', 'Failed to generate QR code image.');
            return;
          }

          const base64Data = dataURL.includes('base64,')
            ? dataURL.split('base64,')[1]
            : dataURL;

          const fileUri = getFileUri();

          await FileSystem.writeAsStringAsync(fileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });

          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri);
          } else {
            Alert.alert('Error', 'Sharing is not available on this device.');
          }
        } catch (err) {
          console.error('FileSystem/Sharing error:', err);
          Alert.alert('Error', 'Failed to share QR code.');
        }
      });
    } catch (error) {
      console.error('Error sharing QR code:', error);
      Alert.alert('Error', 'Failed to share QR code.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title || 'QR Code'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color="#1E293B" />
            </TouchableOpacity>
          </View>

          <View style={styles.qrWrapper}>
            <QRCode
              value={shownValue}
              size={width * 0.7}
              getRef={(ref) => (qrRef.current = ref)}
              backgroundColor="white"
              color="black"
            />
          </View>

          <Text style={styles.qrValueText}>{isSigned ? 'Signed NU Trace sticker' : value}</Text>
          <Text style={styles.qrStatusText}>
            {isSigned
              ? 'The app verifies this signature when the code is scanned.'
              : 'Unsigned code — the Asset Management Office prints the signed sticker from the web.'}
          </Text>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.saveButton]}
              onPress={handleSaveToGallery}
            >
              <MaterialCommunityIcons name="download" size={20} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Save to Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.shareButton]}
              onPress={handleShare}
            >
              <MaterialCommunityIcons name="share-variant" size={20} color="#0F172A" />
              <Text style={[styles.actionButtonText, { color: '#0F172A' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    alignItems: 'center',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  closeButton: {
    padding: 4,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 20,
  },
  qrValueText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    textAlign: 'center',
  },
  qrStatusText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: '#64748B',
    marginBottom: 28,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  actionButtons: {
    width: '100%',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    gap: 8,
    width: '100%',
    height: 48,
  },
  saveButton: {
    backgroundColor: '#3B82F6',
  },
  shareButton: {
    backgroundColor: '#F1F5F9',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});