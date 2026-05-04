import React, { useRef } from 'react';
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
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

interface QRViewModalProps {
  visible: boolean;
  onClose: () => void;
  value: string;
  title?: string;
}

const { width } = Dimensions.get('window');

export default function QRViewModal({ visible, onClose, value, title }: QRViewModalProps) {
  const qrRef = useRef<any>(null);

  const handleSaveToGallery = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need permission to save images to your gallery.');
        return;
      }

      if (qrRef.current && typeof qrRef.current.toDataURL === 'function') {
        qrRef.current.toDataURL(async (dataURL: string) => {
          if (!dataURL || typeof dataURL !== 'string') {
            Alert.alert('Error', 'Failed to generate QR code image.');
            return;
          }

          const base64Data = dataURL.includes('base64,') 
            ? dataURL.split('base64,')[1] 
            : dataURL;

          const directory = FileSystem.Paths.cache?.uri || FileSystem.Paths.document?.uri;
          
          if (!directory) {
            Alert.alert('Error', 'Storage directory not available. Please ensure app permissions are granted.');
            return;
          }

          try {
            const filename = directory + 'QR_' + value.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
            await FileSystem.writeAsStringAsync(filename, base64Data, {
              encoding: 'base64',
            });

            const asset = await MediaLibrary.createAssetAsync(filename);
            await MediaLibrary.createAlbumAsync('NUTrace QR Codes', asset, false);
            
            Alert.alert('Success', 'QR Code saved to gallery!');
          } catch (err) {
            console.error('FileSystem/MediaLibrary error:', err);
            Alert.alert('Error', 'Failed to save to gallery.');
          }
        });
      }
    } catch (error) {
      console.error('Error saving QR code:', error);
      Alert.alert('Error', 'Failed to save QR code to gallery.');
    }
  };

  const handleShare = async () => {
    try {
      if (qrRef.current && typeof qrRef.current.toDataURL === 'function') {
        qrRef.current.toDataURL(async (dataURL: string) => {
          if (!dataURL || typeof dataURL !== 'string') {
            Alert.alert('Error', 'Failed to generate QR code image.');
            return;
          }

          const base64Data = dataURL.includes('base64,') 
            ? dataURL.split('base64,')[1] 
            : dataURL;

          const directory = FileSystem.Paths.cache?.uri || FileSystem.Paths.document?.uri;
          
          if (!directory) {
            Alert.alert('Error', 'Cache directory not available. Please ensure app permissions are granted.');
            return;
          }

          try {
            const filename = directory + 'QR_' + value.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
            await FileSystem.writeAsStringAsync(filename, base64Data, {
              encoding: 'base64',
            });

            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(filename);
            } else {
              Alert.alert('Error', 'Sharing is not available on this device.');
            }
          } catch (err) {
            console.error('FileSystem/Sharing error:', err);
            Alert.alert('Error', 'Failed to share QR code.');
          }
        });
      }
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
              value={value}
              size={width * 0.7}
              getRef={(ref) => (qrRef.current = ref)}
              backgroundColor="white"
              color="black"
            />
          </View>

          <Text style={styles.qrValueText}>{value}</Text>

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
    borderRadius: 24,
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
    marginBottom: 32,
    textAlign: 'center',
  },
  actionButtons: {
    width: '100%',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    width: '100%',
  },
  saveButton: {
    backgroundColor: '#3B82F6',
  },
  shareButton: {
    backgroundColor: '#F1F5F9',
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
