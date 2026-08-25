import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  enrichUserWithEmployeeData,
  fetchAssetCategories,
  fetchUserAssets,
  fetchUserPendingRequestsCount,
  getStoredUser,
  StoredUser,
  UserAsset,
} from '@/lib/userService';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const RAIL_WIDTH = 180;
const CARD_MIN_HEIGHT = 98;
const CARD_GAP = 12;
const TAB_HEIGHT = 64;
const TAB_WIDTH = 28;
const STACK_TOTAL_HEIGHT = 3 * CARD_MIN_HEIGHT + 2 * CARD_GAP;

export default function MyAssets() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [assets, setAssets] = useState<UserAsset[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [isDeptHead, setIsDeptHead] = useState(false);
  const [onlyMyAssets, setOnlyMyAssets] = useState(false);
  const [draftOnlyMy, setDraftOnlyMy] = useState(false);
  const [draftCategories, setDraftCategories] = useState<string[]>([]);

  const [toastText, setToastText] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showResultsToast = useMemo(
    () => (count: number) => {
      const label = `${count} result${count === 1 ? '' : 's'}`;
      setToastText(label);
      Animated.sequence([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(1350),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 360,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToastText((cur) => (cur === label ? null : cur));
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastText(null), 1350 + 220 + 420);
    },
    [toastOpacity],
  );

  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState('');
  const [selectedImageTitle, setSelectedImageTitle] = useState('');

  const [imgScale, setImgScale] = useState(1);
  const [qrVisibleFor, setQrVisibleFor] = useState<Record<string, boolean>>({});
  const [railOpen, setRailOpen] = useState(false);
  const fadeAnims = useRef<Record<string, Animated.Value>>({});
  const railProgress = useRef(new Animated.Value(0)).current;

  const tabOpacity = railProgress.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [1, 0.35, 0.08],
    extrapolate: 'clamp',
  });

  const railTranslateX = railProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-RAIL_WIDTH, 0],
  });

  const setRailState = (open: boolean) => {
    const to = open ? 1 : 0;
    Animated.spring(railProgress, {
      toValue: to,
      useNativeDriver: true,
      tension: 75,
      friction: 9,
    }).start();
    setRailOpen(open);
  };

  const toggleRail = () => setRailState(!railOpen);

  const getFadeAnim = (id: string) => {
    if (!fadeAnims.current[id]) {
      fadeAnims.current[id] = new Animated.Value(1);
    }
    return fadeAnims.current[id];
  };

  const getShowQR = (id: string) => Boolean(qrVisibleFor[id]);

  const toggleShowQR = (id: string) => {
    const current = getShowQR(id);
    const fade = getFadeAnim(id);
    Animated.sequence([
      Animated.timing(fade, {
        toValue: 0.3,
        duration: 120,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
    setQrVisibleFor((prev) => ({ ...prev, [id]: !current }));
  };

  const openImageModal = (url: string, title: string) => {
    setSelectedImageUrl(url);
    setSelectedImageTitle(title);
    setImgScale(1);
    setImageModalVisible(true);
  };

  const closeImageModal = () => {
    setImageModalVisible(false);
    setSelectedImageUrl('');
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      try {
        const stored = await getStoredUser();
        if (!stored) return;
        const enriched = await enrichUserWithEmployeeData(stored);
        setUser(enriched);

        const role = String(enriched.role ?? 'Employee').trim();
        const head = role === 'Department Head';
        setIsDeptHead(head);

        const scope: 'own' | 'department' = head ? 'department' : 'own';
        setOnlyMyAssets(false);
        setSelectedCategories([]);
        setDraftOnlyMy(false);
        setDraftCategories([]);

        const [fetchedAssets, pending, cats] = await Promise.all([
          fetchUserAssets(enriched, scope),
          fetchUserPendingRequestsCount(enriched),
          fetchAssetCategories(),
        ]);

        setAssets(fetchedAssets);
        setPendingCount(pending);
        setCategories(cats);
        setExpandedId((prev) => prev ?? (fetchedAssets?.[0]?.id ? String(fetchedAssets[0].id) : null));
      } catch (error) {
        console.error('Failed to load user assets:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, []);

  const totalAssets = assets.length;
  const activeAssets = useMemo(
    () => assets.filter((a) => a.status === 'Active').length,
    [assets],
  );

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          asset.name.toLowerCase().includes(query) ||
          asset.category.toLowerCase().includes(query) ||
          asset.barcode.toLowerCase().includes(query);
        const matchesCategory =
          selectedCategories.length === 0 || selectedCategories.includes(asset.category);
        const matchesOwnOnly =
          !onlyMyAssets || !isDeptHead || String(asset.userId) === String(user?.id);
        return matchesSearch && matchesCategory && matchesOwnOnly;
      }),
    [assets, searchQuery, selectedCategories, onlyMyAssets, isDeptHead, user],
  );

  const hasActiveFilters =
    selectedCategories.length > 0 || (isDeptHead && onlyMyAssets);

  const headerTitle = isDeptHead ? 'Department Assets' : 'My Assets';

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <TouchableOpacity style={styles.notificationButton}>
            <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={[styles.container, { justifyContent: 'center' }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#f4b942" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.container}>

      <View style={styles.searchSection}>
        <View style={styles.searchContainer}>
          <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            placeholder="Search assets..."
            style={styles.searchInput}
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity
          style={[styles.filterButton, hasActiveFilters ? styles.filterButtonActive : null]}
          onPress={() => {
            setDraftOnlyMy(onlyMyAssets);
            setDraftCategories([...selectedCategories]);
            setFilterModalVisible(true);
          }}
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={20}
            color={hasActiveFilters ? '#FFFFFF' : '#1a3a5c'}
          />
          {hasActiveFilters ? (
            <View style={styles.filterActiveDot} />
          ) : null}
        </TouchableOpacity>
      </View>



      {/* Floating Left Stat Rail (slide-in) */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.statRailOuter,
          { transform: [{ translateX: railTranslateX }] },
        ]}
      >
        <View
          style={[styles.statRailInner, { width: RAIL_WIDTH }]}
          pointerEvents="auto"
        >
          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.statRailStack}
            onPress={() => {
              if (railOpen) toggleRail();
            }}
          >
            <StatCard
              label="Total Assets"
              value={String(totalAssets)}
              icon="database"
              gradientColors={['#344CB7', '#577BC1']}
            />
            <StatCard
              label="Active Assets"
              value={String(activeAssets)}
              icon="check-circle"
              gradientColors={['#000957', '#344CB7']}
            />
            <StatCard
              label="Pending"
              subLabel="Requests"
              value={String(pendingCount)}
              icon="clock-outline"
              gradientColors={['#FFEB00', '#F4C430']}
              darkText
            />
          </TouchableOpacity>
        </View>
        <Animated.View
          pointerEvents="auto"
          style={[styles.statRailTab, { opacity: tabOpacity }]}
        >
          <LinearGradient
            colors={['#FFEB00', '#F4C430']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={toggleRail}
            style={StyleSheet.absoluteFill}
          />
          <MaterialCommunityIcons
            name={railOpen ? 'chevron-left' : 'chevron-right'}
            size={20}
            color="#0C134F"
          />
        </Animated.View>
      </Animated.View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {filteredAssets.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No assigned assets found.</Text>
          </View>
        ) : (
          filteredAssets.map((asset) => (
            <View key={asset.id} style={styles.assetCard}>
              <TouchableOpacity
                style={styles.assetHeader}
                onPress={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                activeOpacity={0.8}
              >
                <View style={styles.assetInfo}>
                  <Text style={styles.assetName}>{asset.name}</Text>
                  <Text style={styles.assetCategory}>{asset.category}</Text>
                  <View style={styles.barcodeContainer}>
                    <MaterialCommunityIcons name="barcode-scan" size={14} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.barcodeText}>{asset.barcode}</Text>
                  </View>
                </View>
                <View style={styles.headerRight}>
                  <View style={[styles.statusTag, { backgroundColor: asset.statusBg }]}>
                    <Text style={[styles.statusTagText, { color: asset.statusColor }]}>{asset.status}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={expandedId === asset.id ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color="rgba(255,255,255,0.7)"
                  />
                </View>
              </TouchableOpacity>

              {expandedId === asset.id && (
                <View style={styles.assetDetails}>
                  <View style={styles.imageSection}>
                    <LinearGradient
                      colors={['#F1F5F9', '#E2E8F0']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.imageGradient}
                    >
                      <Animated.View
                        style={[
                          styles.imageStageWrap,
                          { opacity: getFadeAnim(asset.id) },
                        ]}
                      >
                        <View style={styles.mediaBox}>
                          <View
                            style={[
                              styles.mediaTypeBadge,
                              { backgroundColor: getShowQR(asset.id) ? '#000957' : '#FFEB00' },
                            ]}
                          >
                            <Text
                              style={[
                                styles.mediaTypeBadgeText,
                                { color: getShowQR(asset.id) ? '#FFFFFF' : '#0C134F' },
                              ]}
                            >
                              {getShowQR(asset.id) ? 'QR CODE' : 'PHOTO'}
                            </Text>
                          </View>

                          {getShowQR(asset.id) ? (
                            asset.qrCodeUrl ? (
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() => openImageModal(asset.qrCodeUrl!, `${asset.name} QR Code`)}
                                style={styles.imageTouchArea}
                              >
                                <Image
                                  source={{ uri: asset.qrCodeUrl }}
                                  style={styles.assetImage}
                                  resizeMode="contain"
                                  onLoadStart={() => console.log(`[QR] Loading ${asset.name}:`, asset.qrCodeUrl)}
                                  onError={(e) => console.warn(`[QR] Failed ${asset.name}:`, asset.qrCodeUrl, e.nativeEvent?.error ?? e)}
                                />
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.imagePlaceholder}>
                                <MaterialCommunityIcons name="qrcode-remove" size={64} color="#94A3B8" />
                                <Text style={styles.imagePlaceholderText}>No QR Code provided</Text>
                              </View>
                            )
                          ) : (
                            asset.imageUrl ? (
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() => openImageModal(asset.imageUrl!, asset.name)}
                                style={styles.imageTouchArea}
                              >
                                <Image
                                  source={{ uri: asset.imageUrl }}
                                  style={styles.assetImage}
                                  resizeMode="cover"
                                  onLoadStart={() => console.log(`[IMG] Loading ${asset.name}:`, asset.imageUrl)}
                                  onError={(e) => console.warn(`[IMG] Failed ${asset.name}:`, asset.imageUrl, e.nativeEvent?.error ?? e)}
                                />
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.imagePlaceholder}>
                                <MaterialCommunityIcons name="image-off-outline" size={64} color="#94A3B8" />
                                <Text style={styles.imagePlaceholderText}>No Image provided</Text>
                              </View>
                            )
                          )}
                        </View>
                      </Animated.View>

                      <View style={styles.hintRow}>
                        <Text style={styles.imageHint}>
                          Tap here to view the {getShowQR(asset.id) ? 'Photo' : 'QR Code'}
                        </Text>
                        <MaterialCommunityIcons
                          name="arrow-down"
                          size={16}
                          color="#334155"
                          style={styles.hintArrow}
                        />
                      </View>

                      <TouchableOpacity
                        style={styles.imageAssetIdRow}
                        onPress={() => toggleShowQR(asset.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.imageAssetIdText}>{asset.barcode}</Text>
                      </TouchableOpacity>
                    </LinearGradient>
                  </View>

                  <View style={styles.detailList}>
                    <DetailItem icon="pound" label="Serial Number" value={asset.serialNumber} />
                    <DetailItem icon="calendar-range" label="Acquisition Date" value={formatDate(asset.acquisitionDate)} />
                    <DetailItem icon="account-outline" label="Assigned to" value={asset.assignedTo || asset.custodian} />
                    <DetailItem icon="wrench" label="Next Maintenance" value={formatDate(asset.nextMaintenance)} />
                    <DetailItem icon="cash-multiple" label="Purchase Price" value={asset.purchasePrice} />
                    <DetailItem icon="map-marker-outline" label="Location" value={asset.location} />
                  </View>
                </View>
              )}
            </View>
          ))
        )}
        <View style={styles.spacer} />
      </ScrollView>

      {/* Category Filter Modal */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.filterModalBackdrop}>
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => setFilterModalVisible(false)}
          />
          <View style={styles.filterModalCard}>
            <View style={styles.filterModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MaterialCommunityIcons
                  name="filter-variant"
                  size={22}
                  color="#0C134F"
                />
                <Text style={styles.filterModalTitle}>Filter by Category</Text>
              </View>
              <TouchableOpacity
                onPress={() => setFilterModalVisible(false)}
                style={styles.filterModalClose}
              >
                <MaterialCommunityIcons name="close" size={22} color="#0C134F" />
              </TouchableOpacity>
            </View>

            <View style={styles.filterModalBodyHeader}>
              <Text style={styles.filterSubtitle}>
                {(() => {
                  const shown = assets.filter((a) => {
                    const mCat = draftCategories.length === 0 || draftCategories.includes(a.category);
                    const mOwn = !draftOnlyMy || !isDeptHead || String(a.userId) === String(user?.id);
                    return mCat && mOwn;
                  }).length;
                  return `Showing ${shown} of ${assets.length} assets`;
                })()}
              </Text>
              {(draftCategories.length > 0 || (isDeptHead && draftOnlyMy)) ? (
                <TouchableOpacity
                  onPress={() => {
                    setDraftCategories([]);
                    if (isDeptHead) setDraftOnlyMy(false);
                  }}
                  style={styles.clearFilterBtn}
                >
                  <MaterialCommunityIcons name="close-circle-outline" size={16} color="#EF4444" />
                  <Text style={styles.clearFilterText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView
              style={styles.filterChipsScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsWrap}
            >
              {isDeptHead ? (
                <TouchableOpacity
                  style={[
                    styles.categoryChip,
                    draftOnlyMy ? styles.categoryChipSelectedSoft : null,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setDraftOnlyMy((p) => !p);
                  }}
                >
                  <View style={styles.categoryChipLeft}>
                    {draftOnlyMy ? (
                      <View style={styles.chipCheckCircle}>
                        <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                      </View>
                    ) : (
                      <View style={styles.chipEmptyCircle} />
                    )}
                    <MaterialCommunityIcons
                      name="account-tie-outline"
                      size={16}
                      color="#0C134F"
                      style={{ marginLeft: 8 }}
                    />
                    <Text
                      style={[
                        styles.categoryChipText,
                        draftOnlyMy ? styles.categoryChipTextActiveSoft : null,
                      ]}
                      numberOfLines={1}
                    >
                      My Assets
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.categoryChipCount,
                      draftOnlyMy ? styles.categoryChipCountActiveSoft : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryChipCountText,
                        draftOnlyMy ? { color: '#FFFFFF' } : null,
                      ]}
                    >
                      {assets.filter((a) => String(a.userId) === String(user?.id)).length}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.categoryChip,
                  draftCategories.length === 0 ? styles.categoryChipSelectedSoft : null,
                ]}
                activeOpacity={0.85}
                onPress={() => {
                  setDraftCategories([]);
                }}
              >
                <View style={styles.categoryChipLeft}>
                  {draftCategories.length === 0 ? (
                    <View style={styles.chipCheckCircle}>
                      <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={styles.chipEmptyCircle} />
                  )}
                  <MaterialCommunityIcons
                    name="view-grid-outline"
                    size={16}
                    color="#0C134F"
                    style={{ marginLeft: 8 }}
                  />
                  <Text
                    style={[
                      styles.categoryChipText,
                      draftCategories.length === 0 ? styles.categoryChipTextActiveSoft : null,
                    ]}
                  >
                    All Categories
                  </Text>
                </View>
              </TouchableOpacity>

              {categories.map((cat) => {
                const count = assets.filter((a) => a.category === cat).length;
                const active = draftCategories.includes(cat);
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryChip,
                      active ? styles.categoryChipSelectedSoft : null,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => {
                      setDraftCategories((prev) =>
                        prev.includes(cat) ? prev.filter((x) => x !== cat) : [...prev, cat],
                      );
                    }}
                  >
                    <View style={styles.categoryChipLeft}>
                      {active ? (
                        <View style={styles.chipCheckCircle}>
                          <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                        </View>
                      ) : (
                        <View style={styles.chipEmptyCircle} />
                      )}
                      <MaterialCommunityIcons
                        name="folder-outline"
                        size={16}
                        color="#0C134F"
                        style={{ marginLeft: 8 }}
                      />
                      <Text
                        style={[
                          styles.categoryChipText,
                          active ? styles.categoryChipTextActiveSoft : null,
                        ]}
                        numberOfLines={1}
                      >
                        {cat}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.categoryChipCount,
                        active ? styles.categoryChipCountActiveSoft : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryChipCountText,
                          active ? { color: '#FFFFFF' } : null,
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.filterModalFooter}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setDraftCategories([]);
                  if (isDeptHead) setDraftOnlyMy(false);
                }}
              >
                <MaterialCommunityIcons name="refresh" size={16} color="#0C134F" />
                <Text style={styles.secondaryBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  const appliedCategories = [...draftCategories];
                  const appliedOnlyMy = !!draftOnlyMy && !!isDeptHead;
                  setSelectedCategories(appliedCategories);
                  if (isDeptHead) setOnlyMyAssets(appliedOnlyMy);
                  setFilterModalVisible(false);
                  const count = assets.filter((a) => {
                    const mCat = appliedCategories.length === 0 || appliedCategories.includes(a.category);
                    const mOwn = !appliedOnlyMy || String(a.userId) === String(user?.id);
                    return mCat && mOwn;
                  }).length;
                  showResultsToast(count);
                }}
              >
                <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Results Count Toast */}
      {toastText ? (
        <View
          pointerEvents="none"
          style={styles.resultsToast}
        >
          <Animated.View
            style={[styles.resultsToastCard, { opacity: toastOpacity }]}
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={16}
              color="#FFFFFF"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.resultsToastText}>{toastText}</Text>
          </Animated.View>
        </View>
      ) : null}

      {/* Image Zoom Modal */}
      <Modal
        visible={imageModalVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={closeImageModal}
        statusBarTranslucent
      >
        <View style={styles.imageModalContainer}>
          <View style={styles.imageModalHeader}>
            <TouchableOpacity onPress={closeImageModal} style={styles.imageModalCloseBtn}>
              <MaterialCommunityIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.imageModalTitle} numberOfLines={1}>
              {selectedImageTitle}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.imageModalScroll}
            contentContainerStyle={styles.imageModalScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            {selectedImageUrl ? (
              <Image
                source={{ uri: selectedImageUrl }}
                style={[styles.fullImage, { transform: [{ scale: imgScale }] }]}
                resizeMode="contain"
              />
            ) : null}
          </ScrollView>

          <View style={styles.imageModalFooter}>
            <TouchableOpacity
              onPress={() => setImgScale((s) => Math.max(0.5, s - 0.25))}
              style={styles.zoomBtn}
            >
              <MaterialCommunityIcons name="magnify-minus-outline" size={22} color="#0C134F" />
            </TouchableOpacity>
            <Text style={styles.zoomLevelText}>{Math.round(imgScale * 100)}%</Text>
            <TouchableOpacity
              onPress={() => setImgScale((s) => Math.min(4, s + 0.25))}
              style={styles.zoomBtn}
            >
              <MaterialCommunityIcons name="magnify-plus-outline" size={22} color="#0C134F" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      </View>
    </View>
  );
}

function StatCard({
  label,
  subLabel,
  value,
  icon,
  gradientColors,
  darkText,
}: {
  label: string;
  subLabel?: string;
  value: string;
  icon: string;
  gradientColors: [string, string];
  darkText?: boolean;
}) {
  const labelColor = darkText ? 'rgba(12, 19, 79, 0.85)' : 'rgba(255, 255, 255, 0.9)';
  const valueColor = darkText ? '#0C134F' : '#FFFFFF';
  const iconBg = darkText ? 'rgba(12, 19, 79, 0.15)' : 'rgba(255, 255, 255, 0.2)';
  const iconColor = darkText ? '#0C134F' : '#FFFFFF';

  return (
    <View style={styles.statCardWrap}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statCardGradient}
      >
        <View style={styles.statCardTop}>
          <View style={styles.statCardLabelCol}>
            <Text style={[styles.statCardLabel, { color: labelColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
            {!!subLabel && (
              <Text style={[styles.statCardSubLabel, { color: labelColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{subLabel}</Text>
            )}
          </View>
          <View style={[styles.statCardIconWrap, { backgroundColor: iconBg }]}>
            <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
          </View>
        </View>
        <Text style={[styles.statCardValue, { color: valueColor }]}>{value}</Text>
      </LinearGradient>
    </View>
  );
}

function DetailItem({ icon, label, value }: { icon: string, label: string, value?: string }) {
  return (
    <View style={styles.detailItemBox}>
      <View style={styles.detailItemHeader}>
        <MaterialCommunityIcons name={icon as any} size={16} color="#94A3B8" />
        <Text style={styles.detailItemLabel}>{label}</Text>
      </View>
      <Text style={styles.detailItemValue}>{value || 'N/A'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#0C134F',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 0,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#0C134F',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  notificationButton: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FDB833',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  searchSection: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 12,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1e293b',
  },
  filterButton: {
    width: 44,
    height: 44,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 96,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statRailOuter: {
    position: 'absolute',
    top: 92,
    left: 0,
    width: RAIL_WIDTH + TAB_WIDTH,
    height: STACK_TOTAL_HEIGHT + 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 120,
  },
  statRailInner: {
    paddingVertical: 20,
    paddingLeft: 10,
    paddingRight: 6,
    backgroundColor: 'rgba(255, 255, 255, 0)',
  },
  statRailStack: {
    gap: CARD_GAP,
  },
  statRailTab: {
    position: 'absolute',
    left: RAIL_WIDTH,
    top: STACK_TOTAL_HEIGHT / 2 - TAB_HEIGHT / 2 + 20,
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  statCardWrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statCardGradient: {
    padding: 14,
    paddingRight: 12,
    borderRadius: 14,
    minHeight: 98,
  },
  statCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  statCardLabelCol: {
    flex: 1,
    paddingRight: 6,
    justifyContent: 'center',
    minHeight: 32,
  },
  statCardLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  statCardSubLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  statCardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  statCardValue: {
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  assetCard: {
    backgroundColor: '#0C134F',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(85, 105, 158, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  assetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetInfo: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assetName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  assetCategory: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    marginBottom: 6,
  },
  barcodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  barcodeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  assetDetails: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 16,
  },
  imageSection: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  imageGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  mediaTypeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
  },
  mediaTypeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  imageStageWrap: {
    width: '100%',
    alignItems: 'center',
  },
  mediaBox: {
    width: '100%',
    position: 'relative',
  },
  imageTouchArea: {
    width: '100%',
    alignItems: 'center',
  },
  assetImage: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    marginTop: 8,
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  imageHint: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  hintArrow: {
    marginLeft: 6,
  },
  imageAssetIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
  },
  imageAssetIdText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0C134F',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  detailList: {
    gap: 10,
  },
  detailItemBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 14,
    padding: 14,
  },
  detailItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  detailItemLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailItemValue: {
    fontSize: 15,
    color: '#0C134F',
    fontWeight: '700',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 15,
  },
  spacer: {
    height: 20,
  },
  // Image modal styles
  imageModalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: '#0C134F',
  },
  imageModalCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  imageModalScroll: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_WIDTH * 1.2,
  },
  imageModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#0C134F',
    paddingBottom: 32,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLevelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    minWidth: 50,
    textAlign: 'center',
  },
  // Filter button
  filterButtonActive: {
    backgroundColor: '#0C134F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  filterActiveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFEB00',
  },
  // Active filter row below search
  activeFilterRow: {
    marginTop: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeFilterChipsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C134F',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    gap: 6,
  },
  activeFilterChipScope: {
    backgroundColor: '#B45309',
  },
  activeFilterChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: SCREEN_WIDTH * 0.55,
  },
  activeFilterChipClose: {
    marginLeft: 2,
    paddingHorizontal: 2,
  },
  activeFilterCount: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  // Filter results toast
  resultsToast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 110 : 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsToastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 19, 79, 0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  resultsToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  // Filter modal
  filterModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 40, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  filterModalCard: {
    width: '100%',
    maxHeight: '82%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  filterModalHeader: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  filterModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0C134F',
  },
  filterModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  filterModalBodyHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  clearFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
  },
  clearFilterText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '700',
  },
  filterChipsScroll: {
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  filterChipsWrap: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 18,
    gap: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
  categoryChipSelected: {
    backgroundColor: '#0C134F',
    borderColor: '#0C134F',
  },
  categoryChipLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0C134F',
    flexShrink: 1,
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  categoryChipCount: {
    minWidth: 28,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  categoryChipCountActive: {
    backgroundColor: '#FFEB00',
  },
  categoryChipCountText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  categoryChipSelectedSoft: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  categoryChipTextActiveSoft: {
    color: '#0C134F',
    fontWeight: '700',
  },
  categoryChipCountActiveSoft: {
    backgroundColor: '#0C134F',
  },
  chipEmptyCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.4,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  chipCheckCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.4,
    borderColor: '#0C134F',
    backgroundColor: '#0C134F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterModalFooter: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0C134F',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#0C134F',
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
