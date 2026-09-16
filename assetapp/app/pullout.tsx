import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import NotificationBell from '@/components/notification-bell';
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../lib/supabase";
import { getStoredUser, searchUsers } from "../lib/userService";
import {
  PulloutRecord,
  PulloutResolveAction,
  fetchBlockedPulloutAssetIds,
  fetchPulledOutAssetCount,
  fetchPulloutRecords,
  resolvePullout,
  submitPulloutRequest,
} from "../lib/pulloutService";
import DateTimePicker from "@react-native-community/datetimepicker";

type AssetRow = {
  id?: string | number | null;
  Asset_code?: string | null;
  Asset_name?: string | null;
  Category?: string | null;
  department?: string | null;
  Lifecycle_Status?: string | null;
};

type UserOption = {
  id: string | number;
  fullName: string;
  email?: string | null;
  departmentName?: string;
};

const pulloutStatusLabel = (raw?: string | null): string => {
  const v = String(raw ?? "").toLowerCase();
  if (!v) return "Pending";
  if (v.includes("complete")) return "Completed";
  if (v.includes("approv")) return "Approved";
  if (v.includes("reject")) return "Rejected";
  if (v.includes("cancel")) return "Cancelled";
  if (v.includes("pend")) return "Pending";
  return String(raw ?? "");
};

const RESOLVE_ACTIONS: { key: PulloutResolveAction; label: string; hint: string }[] = [
  {
    key: "assign",
    label: "Assign to new user (release from storage)",
    hint: "The asset is handed to the chosen owner, moves to their location and returns to Active.",
  },
  {
    key: "repair",
    label: "Send to repair",
    hint: "The asset moves to For Repair. When the repair is finished it returns to Pullout, not Active — assign it to release it.",
  },
];

export default function PulloutScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<"from" | "to" | null>(null);

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PulloutRecord[]>([]);
  const [totalPulledOut, setTotalPulledOut] = useState(0);

  // Assets staged for the next request — one asset = single pullout, several = bulk.
  const [batch, setBatch] = useState<AssetRow[]>([]);

  const [scannerVisible, setScannerVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Resolve Pullout — same transaction editor as the web's /admin/pullout modal:
  // pick the assets, choose assign-or-repair, fill the matching fields, save.
  const [resolveTarget, setResolveTarget] = useState<PulloutRecord | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [assetFilter, setAssetFilter] = useState("");
  const [resolveAction, setResolveAction] = useState<PulloutResolveAction | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [userSearching, setUserSearching] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [repairNotes, setRepairNotes] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const [rows, pulledCount] = await Promise.all([
        fetchPulloutRecords(),
        fetchPulledOutAssetCount(),
      ]);
      setRecords(rows);
      setTotalPulledOut(pulledCount);
    } catch (e: any) {
      console.error("Failed to load pullout records:", e);
      Alert.alert("Error", e?.message || "Failed to load pullout records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  // Load once on mount via the effect-friendly pattern the lint rule prefers:
  // the async work sets state only from its async continuation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadRecords();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const removeFromBatch = (assetId: string | number | null | undefined) => {
    setBatch((prev) => prev.filter((a) => String(a.id) !== String(assetId)));
  };

  /** Send the staged assets (one or many) to the Asset Management Office. */
  const submitBatch = async () => {
    if (batch.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const user = await getStoredUser();
      if (!user?.id) throw new Error("User session not found. Please sign in again.");

      const result = await submitPulloutRequest({
        user,
        assetIds: batch.map((a) => a.id as string | number),
        reason: reason.trim() || "Pullout request",
      });

      setReasonModalVisible(false);
      setReason("");
      setBatch([]);
      Alert.alert(
        "Request Submitted",
        `Pullout request for ${result.assetCount} asset${result.assetCount > 1 ? "s" : ""} was sent to the Asset Management Office for approval.`,
      );
      await loadRecords();
    } catch (e: any) {
      console.error("Failed to submit pullout request:", e);
      Alert.alert("Error", e?.message || "Failed to submit the pullout request.");
    } finally {
      setSubmitting(false);
    }
  };

  const closeResolve = () => {
    setResolveTarget(null);
    setSelectedAssetIds(new Set());
    setAssetFilter("");
    setResolveAction(null);
    setUserQuery("");
    setUserOptions([]);
    setSelectedUser(null);
    setNewLocation("");
    setRepairNotes("");
    setResolveNotes("");
  };

  const openResolve = (record: PulloutRecord) => {
    setResolveTarget(record);
    setSelectedAssetIds(new Set(record.items.map((item) => String(item.assetId))));
    setAssetFilter("");
    setResolveAction(null);
    setUserQuery("");
    setUserOptions([]);
    setSelectedUser(null);
    setNewLocation("");
    setRepairNotes("");
    setResolveNotes("");
  };

  const toggleResolveAsset = (assetId: string | number) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      const key = String(assetId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUserSearch = async (text: string) => {
    setUserQuery(text);
    setSelectedUser(null);
    if (text.trim().length < 2) {
      setUserOptions([]);
      return;
    }
    setUserSearching(true);
    try {
      const results = await searchUsers(text.trim());
      setUserOptions(results as UserOption[]);
    } catch (e) {
      console.warn("User search failed:", e);
      setUserOptions([]);
    } finally {
      setUserSearching(false);
    }
  };

  /** Save the Resolve Pullout form — same writes as the web's save button. */
  const submitResolve = async () => {
    if (!resolveTarget || resolving) return;
    if (selectedAssetIds.size === 0) {
      Alert.alert("No Assets Selected", "Tick at least one asset, or leave the assets you want to keep in pullout unticked and resolve the rest later.");
      return;
    }
    if (!resolveAction) {
      Alert.alert("Action Required", "Choose whether to assign the assets or send them to repair.");
      return;
    }
    if (resolveAction === "assign" && !selectedUser) {
      Alert.alert("New Owner Required", "Search for and select the user who will receive the asset.");
      return;
    }
    if (resolveAction === "assign" && !newLocation.trim()) {
      Alert.alert("Location Required", "Enter the asset's new location (e.g. Room 301, Faculty Office, Lab 2).");
      return;
    }

    setResolving(true);
    try {
      const user = await getStoredUser();
      const result = await resolvePullout({
        pulloutId: resolveTarget.pulloutId,
        action: resolveAction,
        assetIds: Array.from(selectedAssetIds),
        assignToUserId: selectedUser?.id ?? null,
        newLocation: newLocation.trim(),
        repairNotes: repairNotes.trim(),
        notes: resolveNotes.trim(),
        actorId: user?.id ?? null,
      });

      const completedMsg = result.completed
        ? ""
        : ` ${result.remainingCount} asset${result.remainingCount > 1 ? "s" : ""} remain in this pullout.`;
      Alert.alert(
        "Pullout Resolved",
        `${result.message}${completedMsg}${result.completed ? " The pullout is now completed." : ""}`,
      );
      closeResolve();
      await loadRecords();
    } catch (e: any) {
      console.error("Failed to resolve pullout:", e);
      Alert.alert("Action Failed", e?.message || "Could not resolve the pullout.");
    } finally {
      setResolving(false);
    }
  };

  const filteredPullouts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const fromD = fromDate;
    const toD = toDate;

    // Pending pullouts are decisions (they live on the Requests screen) and
    // Completed pullouts are done — their assets were already assigned or sent
    // to repair. This page only tracks pullouts still needing action.
    return records
      .filter((row) => {
        const status = pulloutStatusLabel(row.status);
        return status !== "Pending" && status !== "Completed";
      })
      .filter((row) => {
      const haystack = [
        row.requestedBy,
        row.description,
        row.notes,
        row.destination ?? "",
        row.status,
        ...row.items.map((item) => `${item.name} ${item.code} ${item.custodian}`),
      ]
        .join(" ")
        .toLowerCase();

      if (query && !haystack.includes(query)) return false;

      if (fromD || toD) {
        const raw = row.pulloutDate || row.createdAt;
        const created = raw ? new Date(String(raw)) : null;
        if (!created || Number.isNaN(created.getTime())) return false;
        if (fromD) {
          const start = new Date(fromD);
          start.setHours(0, 0, 0, 0);
          if (created < start) return false;
        }
        if (toD) {
          const end = new Date(toD);
          end.setHours(23, 59, 59, 999);
          if (created > end) return false;
        }
      }

      return true;
    });
  }, [records, search, fromDate, toDate]);

  const formatDay = (d: Date | null) => {
    if (!d) return "Any";
    try {
      return d.toLocaleDateString();
    } catch {
      return "Any";
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert("Camera Permission", "Camera permission is required to scan QR codes.");
        return;
      }
    }
    setScanned(false);
    setScannerVisible(true);
  };

  const handleScanned = async (data: string) => {
    if (scanned) return;
    setScanned(true);

    const code = String(data ?? "").trim();
    if (!code) {
      Alert.alert("Invalid QR", "The scanned QR code is empty.");
      setScanned(false);
      return;
    }

    try {
      const { data: asset, error } = await supabase
        .from("assets")
        .select("id, Asset_code, Asset_name, Category, Lifecycle_Status")
        .eq("Asset_code", code)
        .maybeSingle();

      if (error) throw error;
      if (!asset) {
        Alert.alert("Not Found", `No asset found for code: ${code}`);
        setScanned(false);
        return;
      }

      const status = String(asset.Lifecycle_Status ?? "").trim();
      if (status === "Pullout") {
        Alert.alert("Already Pulled Out", `${asset.Asset_name ?? "This asset"} is already in Pullout status.`);
        setScanned(false);
        return;
      }

      // An asset can only sit in one pending/approved pullout at a time.
      const blocked = await fetchBlockedPulloutAssetIds();
      if (blocked.has(String(asset.id))) {
        Alert.alert(
          "Already In A Pullout",
          `${asset.Asset_name ?? "This asset"} is already part of a pending or approved pullout request.`,
        );
        setScanned(false);
        return;
      }

      if (batch.some((staged) => String(staged.id) === String(asset.id))) {
        Alert.alert("Already Added", `${asset.Asset_name ?? "This asset"} is already staged in this pullout request.`);
        setScanned(false);
        return;
      }

      // Stage it. The first asset closes the scanner so the staged list becomes
      // visible; scan again to group more assets into one bulk pullout.
      const wasEmpty = batch.length === 0;
      setBatch((prev) => [...prev, asset as AssetRow]);
      if (wasEmpty) setScannerVisible(false);
      setScanned(false);
    } catch (e: any) {
      console.error("Scan lookup failed:", e);
      Alert.alert("Error", e?.message || "Failed to validate scanned asset.");
      setScanned(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "N/A";
    try {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      const date = d.toLocaleDateString();
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${date}\n${time}`;
    } catch {
      return String(value);
    }
  };

  return (
    <SafeAreaView edges={['left','right','bottom']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record Pullout</Text>
        <TouchableOpacity
          style={styles.notificationButton}
          activeOpacity={0.8}
        >
          <NotificationBell />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0EA5E9", "#0284C7"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statsCard}
        >
          <View style={styles.statsCardHeader}>
            <MaterialCommunityIcons
              name="arrow-up-box"
              size={28}
              color="#FFFFFF"
            />
            <Text style={styles.statsCardTitle}>Total Pulled Out Assets</Text>
          </View>
          <Text style={styles.statsCardValue}>{totalPulledOut}</Text>
          <Text style={styles.statsCardSubtitle}>
            Assets currently in Pullout status. Their records stay in the inventory for reporting and auditing.
          </Text>
        </LinearGradient>

        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <MaterialCommunityIcons name="magnify" size={22} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search pulled out assets..."
              placeholderTextColor="#94A3B8"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            style={styles.calendarButton}
            onPress={() => setDateModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="calendar-month"
              size={22}
              color="#0F172A"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.logButton]}
            onPress={openScanner}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={16} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>
              {batch.length > 0 ? "Scan Another" : "Scan Asset"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.turnoverButton,
              batch.length === 0 && styles.actionButtonDisabled,
            ]}
            onPress={() => {
              setReason("");
              setReasonModalVisible(true);
            }}
            disabled={batch.length === 0}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="check-circle-outline" size={16} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>
              {batch.length > 1 ? `Submit Request (${batch.length})` : "Submit Request"}
            </Text>
          </TouchableOpacity>
        </View>

        {batch.length > 0 ? (
          <View style={styles.batchCard}>
            <View style={styles.batchHeader}>
              <MaterialCommunityIcons name="playlist-check" size={18} color="#0284C7" />
              <Text style={styles.batchTitle}>
                {batch.length === 1 ? "1 asset staged" : `${batch.length} assets staged (bulk pullout)`}
              </Text>
            </View>
            <Text style={styles.batchHint}>
              {batch.length === 1
                ? "Submit to send this asset for approval, or scan more to make it a bulk pullout."
                : "These assets are grouped into ONE pullout transaction, but each keeps its own record and history."}
            </Text>
            {batch.map((staged) => (
              <View key={String(staged.id)} style={styles.batchRow}>
                <MaterialCommunityIcons name="cube-outline" size={16} color="#0284C7" />
                <View style={styles.itemBody}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {staged.Asset_name ?? "Unknown Asset"}
                  </Text>
                  <Text style={styles.itemCode} numberOfLines={1}>
                    {staged.Asset_code ?? ""}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeFromBatch(staged.id)} activeOpacity={0.8}>
                  <MaterialCommunityIcons name="close-circle" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.batchClear} onPress={() => setBatch([])} activeOpacity={0.8}>
              <Text style={styles.batchClearText}>Clear all</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#0284C7" />
          </View>
        ) : (
          filteredPullouts.map((record) => {
            const statusLabel = pulloutStatusLabel(record.status);
            const dateShown = formatDateTime(record.pulloutDate || record.createdAt);
            const isApproved = statusLabel === "Approved";
            const statusStyle =
              statusLabel === "Approved" || statusLabel === "Completed"
                ? styles.statusDone
                : statusLabel === "Rejected" || statusLabel === "Cancelled"
                  ? styles.statusCancelled
                  : styles.statusOpen;

            return (
              <View key={String(record.pulloutId)} style={styles.disposalCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.categoryTag}>
                    <Text style={styles.categoryTagText}>
                      {record.items.length > 1 ? `BULK \u00b7 ${record.items.length} ASSETS` : "SINGLE ASSET"}
                    </Text>
                  </View>
                  <Text style={styles.cardDate}>{dateShown}</Text>
                </View>

                <View style={styles.statusLine}>
                  <Text style={[styles.statusTextChip, statusStyle]}>{statusLabel}</Text>
                  {record.requestId != null ? (
                    <Text style={styles.requestRef}>{`REQ-${String(record.requestId)}`}</Text>
                  ) : null}
                </View>

                <Text style={styles.cardMeta}>{`Requested by: ${record.requestedBy}`}</Text>
                {record.approvedBy ? (
                  <Text style={styles.cardMeta}>{`Approved by: ${record.approvedBy}`}</Text>
                ) : null}
                {record.destination ? (
                  <Text style={styles.cardMeta}>{`Destination: ${record.destination}`}</Text>
                ) : null}

                <Text style={styles.cardReasonTitle}>Reason</Text>
                <Text style={styles.cardReason}>
                  {record.description || record.notes || "No reason provided"}
                </Text>

                <Text style={styles.cardActionLabel}>
                  {record.items.length > 1 ? `Assets (${record.items.length})` : "Asset"}
                </Text>
                <View style={styles.itemList}>
                  {record.items.length === 0 ? (
                    <Text style={styles.itemEmpty}>
                      {statusLabel === "Completed"
                        ? "All assets have been resolved and released from this pullout."
                        : "No asset is linked to this pullout."}
                    </Text>
                  ) : (
                    record.items.map((item) => (
                      <View key={`${record.pulloutId}-${item.assetId}`} style={styles.itemRow}>
                        <View style={styles.itemIcon}>
                          <MaterialCommunityIcons name="cube-outline" size={16} color="#0284C7" />
                        </View>
                        <View style={styles.itemBody}>
                          <Text style={styles.itemName} numberOfLines={2}>
                            {item.name}
                          </Text>
                          <Text style={styles.itemCode} numberOfLines={1}>
                            {item.code || "\u2014"}
                          </Text>
                        </View>
                        <View style={styles.itemRight}>
                          <Text style={styles.itemStatus} numberOfLines={1}>
                            {item.lifecycleStatus || "\u2014"}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                {isApproved && record.items.length > 0 ? (
                  <TouchableOpacity
                    style={styles.resolveButton}
                    activeOpacity={0.85}
                    onPress={() => openResolve(record)}
                  >
                    <MaterialCommunityIcons name="clipboard-check-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.resolveButtonText}>Resolve Pullout</Text>
                  </TouchableOpacity>
                ) : null}

                {isApproved ? (
                  <Text style={styles.itemHint}>
                    Resolving assigns the asset to a new user (releasing it from storage to Active) or sends it to repair. Repair returns the asset to Pullout afterwards — only assigning releases it.
                  </Text>
                ) : null}
              </View>
            );
          })
        )}

        {!loading && filteredPullouts.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No pullouts need action right now. Pending requests live on the Requests screen, and completed pullouts are archived once every asset is resolved.
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={dateModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filter by Date</Text>
            <Text style={styles.modalHint}>Pick a start/end date (optional).</Text>

            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>From</Text>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setPickerMode("from")}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="calendar-month" size={18} color="#0F172A" />
                <Text style={styles.dateValue}>{formatDay(fromDate)}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>To</Text>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setPickerMode("to")}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="calendar-month" size={18} color="#0F172A" />
                <Text style={styles.dateValue}>{formatDay(toDate)}</Text>
              </TouchableOpacity>
            </View>

            {pickerMode && (
              <DateTimePicker
                value={(pickerMode === "from" ? fromDate : toDate) ?? new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(_, selectedDate) => {
                  if (Platform.OS !== "ios") {
                    setPickerMode(null);
                  }
                  if (!selectedDate) return;
                  if (pickerMode === "from") setFromDate(selectedDate);
                  if (pickerMode === "to") setToDate(selectedDate);
                }}
              />
            )}

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => {
                  setFromDate(null);
                  setToDate(null);
                  setPickerMode(null);
                  setDateModalVisible(false);
                }}
              >
                <Text style={styles.modalBtnGhostText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={() => {
                  setPickerMode(null);
                  setDateModalVisible(false);
                }}
              >
                <Text style={styles.modalBtnPrimaryText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.scannerClose}
              onPress={() => setScannerVisible(false)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Asset QR</Text>
            <View style={{ width: 42 }} />
          </View>

          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => handleScanned(String(data ?? ""))}
            />
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Align the QR code inside the frame</Text>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={reasonModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {batch.length > 1 ? `Submit Bulk Pullout (${batch.length})` : "Submit Pullout Request"}
            </Text>
            <Text style={styles.modalHint}>
              This request goes to the Asset Management Office for approval. The assets move to
              Pullout only once it is approved.
            </Text>

            <View style={styles.batchPreview}>
              {batch.map((staged) => (
                <Text key={String(staged.id)} style={styles.batchPreviewLine} numberOfLines={1}>
                  • {staged.Asset_name ?? "Unknown Asset"}
                  {staged.Asset_code ? ` (${staged.Asset_code})` : ""}
                </Text>
              ))}
            </View>

            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason for pullout (optional)"
              placeholderTextColor="#94A3B8"
              style={styles.modalInput}
              multiline
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setReasonModalVisible(false)}
                disabled={submitting}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={submitBatch}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={resolveTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeResolve}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <View style={styles.actionModalHeader}>
                <View style={styles.actionModalTitleWrap}>
                  <Text style={styles.modalTitle}>Resolve Pullout</Text>
                  <Text style={styles.confirmCode}>{`Pullout #${resolveTarget?.pulloutId ?? ""}`}</Text>
                </View>
                <TouchableOpacity onPress={closeResolve} activeOpacity={0.8} disabled={resolving}>
                  <MaterialCommunityIcons name="close" size={22} color="#0F172A" />
                </TouchableOpacity>
              </View>

              {/* Assets in this pullout */}
              <View style={styles.resolveSectionHeader}>
                <Text style={styles.resolveSectionTitle}>Assets in this pullout *</Text>
                <TouchableOpacity onPress={() => setSelectedAssetIds(new Set((resolveTarget?.items ?? []).map((i) => String(i.assetId))))}>
                  <Text style={styles.resolveSelectAll}>Select All</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={assetFilter}
                onChangeText={setAssetFilter}
                placeholder="Filter assets by name or code..."
                placeholderTextColor="#94A3B8"
                style={styles.resolveInput}
              />
              <View style={styles.resolveAssetList}>
                {(resolveTarget?.items ?? [])
                  .filter((item) => {
                    const q = assetFilter.trim().toLowerCase();
                    if (!q) return true;
                    return `${item.name} ${item.code}`.toLowerCase().includes(q);
                  })
                  .map((item) => {
                    const checked = selectedAssetIds.has(String(item.assetId));
                    return (
                      <TouchableOpacity
                        key={String(item.assetId)}
                        style={styles.resolveAssetRow}
                        activeOpacity={0.7}
                        onPress={() => toggleResolveAsset(item.assetId)}
                      >
                        <MaterialCommunityIcons
                          name={checked ? "checkbox-marked" : "checkbox-blank-outline"}
                          size={20}
                          color={checked ? "#D9A426" : "#94A3B8"}
                        />
                        <View style={styles.resolveAssetText}>
                          <Text style={styles.resolveAssetName} numberOfLines={1}>
                            {item.name} <Text style={styles.resolveAssetCode}>{item.code}</Text>
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                {(resolveTarget?.items ?? []).length === 0 ? (
                  <Text style={styles.itemEmpty}>No asset is linked to this pullout.</Text>
                ) : null}
              </View>
              <Text style={styles.resolveFootnote}>Uncheck any asset you want to leave in pullout.</Text>

              {/* Action */}
              <Text style={styles.resolveSectionTitle}>Action *</Text>
              {RESOLVE_ACTIONS.map((option) => {
                const active = resolveAction === option.key;
                return (
                  <View key={option.key}>
                    <TouchableOpacity
                      style={[styles.resolveActionOption, active && styles.resolveActionOptionActive]}
                      activeOpacity={0.7}
                      onPress={() => setResolveAction(option.key)}
                    >
                      <MaterialCommunityIcons
                        name={option.key === "assign" ? "account-arrow-right-outline" : "wrench-outline"}
                        size={18}
                        color={active ? "#B98A1B" : "#64748B"}
                      />
                      <Text style={[styles.resolveActionLabel, active && styles.resolveActionLabelActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                    {active ? <Text style={styles.resolveActionHint}>{option.hint}</Text> : null}
                  </View>
                );
              })}

              {/* Assign fields */}
              {resolveAction === "assign" ? (
                <>
                  <Text style={styles.resolveSectionTitle}>New Owner *</Text>
                  <TextInput
                    value={selectedUser ? `${selectedUser.fullName}${selectedUser.departmentName ? ` — ${selectedUser.departmentName}` : ""}` : userQuery}
                    onChangeText={handleUserSearch}
                    placeholder="Type name or email to search..."
                    placeholderTextColor="#94A3B8"
                    style={styles.resolveInput}
                  />
                  {userSearching ? <ActivityIndicator size="small" color="#D9A426" style={{ marginVertical: 8 }} /> : null}
                  {userOptions.length > 0 ? (
                    <View style={styles.resolveUserList}>
                      {userOptions.map((option) => (
                        <TouchableOpacity
                          key={String(option.id)}
                          style={styles.resolveUserRow}
                          activeOpacity={0.7}
                          onPress={() => {
                            setSelectedUser(option);
                            setUserOptions([]);
                          }}
                        >
                          <Text style={styles.resolveUserName}>{option.fullName || option.email}</Text>
                          <Text style={styles.resolveUserMeta}>
                            {option.email ?? ""}{option.departmentName ? ` \u00b7 ${option.departmentName}` : ""}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.resolveFootnote}>
                    Selected: {selectedUser ? selectedUser.fullName : "None"}
                  </Text>

                  <Text style={styles.resolveSectionTitle}>New Location *</Text>
                  <TextInput
                    value={newLocation}
                    onChangeText={setNewLocation}
                    placeholder="e.g., Room 301, Faculty Office, Lab 2"
                    placeholderTextColor="#94A3B8"
                    style={styles.resolveInput}
                  />
                </>
              ) : null}

              {/* Repair fields */}
              {resolveAction === "repair" ? (
                <>
                  <Text style={styles.resolveSectionTitle}>Issue description</Text>
                  <TextInput
                    value={repairNotes}
                    onChangeText={setRepairNotes}
                    placeholder="What needs repair?"
                    placeholderTextColor="#94A3B8"
                    style={[styles.resolveInput, styles.resolveTextArea]}
                    multiline
                  />
                </>
              ) : null}

              {/* Notes */}
              <Text style={styles.resolveSectionTitle}>Notes (optional)</Text>
              <TextInput
                value={resolveNotes}
                onChangeText={setResolveNotes}
                placeholder="Optional notes..."
                placeholderTextColor="#94A3B8"
                style={[styles.resolveInput, styles.resolveTextArea]}
                multiline
              />
            </ScrollView>

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={closeResolve}
                disabled={resolving}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSave]}
                onPress={submitResolve}
                disabled={resolving}
              >
                {resolving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F7FB",
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0C134F',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 14,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  notificationButton: {
    position: "relative",
  },
  notificationBadge: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FBBF24",
    justifyContent: "center",
    alignItems: "center",
  },
  notificationBadgeText: {
    color: "#0F172A",
    fontWeight: "800",
    fontSize: 12,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  statsCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  statsCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  statsCardTitle: {
    color: "#F4F7FB",
    fontSize: 15,
    fontWeight: "600",
  },
  statsCardValue: {
    color: "#F4F7FB",
    fontSize: 40,
    fontWeight: "800",
    marginBottom: 8,
  },
  statsCardSubtitle: {
    color: "#FDE68A",
    fontSize: 13,
    lineHeight: 20,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 52,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: "#0F172A",
  },
  calendarButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  batchCard: {
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  batchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  batchTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#075985",
  },
  batchHint: {
    fontSize: 12,
    color: "#0369A1",
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 8,
  },
  batchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  batchClear: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  batchClearText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
  },
  batchPreview: {
    backgroundColor: "#F4F7FB",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  batchPreviewLine: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "600",
    marginBottom: 2,
  },
  actionModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  actionModalTitleWrap: {
    flex: 1,
  },
  resolveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#D9A426",
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 14,
  },
  resolveButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
  resolveSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  resolveSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginTop: 14,
    marginBottom: 6,
  },
  resolveSelectAll: {
    fontSize: 12,
    fontWeight: "700",
    color: "#D9A426",
  },
  resolveInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0F172A",
  },
  resolveTextArea: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  resolveAssetList: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    marginTop: 8,
    maxHeight: 150,
  },
  resolveAssetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F1F5F9",
  },
  resolveAssetText: {
    flex: 1,
  },
  resolveAssetName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  resolveAssetCode: {
    fontWeight: "500",
    color: "#64748B",
    fontSize: 11,
  },
  resolveFootnote: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 6,
  },
  resolveActionOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
    backgroundColor: "#FFFFFF",
  },
  resolveActionOptionActive: {
    borderColor: "#D9A426",
    backgroundColor: "#FDF6E3",
  },
  resolveActionLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  resolveActionLabelActive: {
    color: "#B98A1B",
    fontWeight: "800",
  },
  resolveActionHint: {
    fontSize: 11,
    color: "#64748B",
    lineHeight: 15,
    marginLeft: 28,
    marginBottom: 8,
    marginTop: -2,
  },
  resolveUserList: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    maxHeight: 160,
    marginTop: 6,
  },
  resolveUserRow: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F1F5F9",
  },
  resolveUserName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  resolveUserMeta: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  modalBtnSave: {
    backgroundColor: "#D9A426",
  },
  requestRef: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    marginLeft: 8,
    alignSelf: "center",
  },
  statusCancelled: {
    backgroundColor: "#FEE2E2",
    color: "#B91C1C",
  },
  itemList: {
    gap: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F4F7FB",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#E0F2FE",
    justifyContent: "center",
    alignItems: "center",
  },
  itemBody: {
    flex: 1,
  },
  itemName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 18,
  },
  itemCode: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  itemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 110,
  },
  itemStatus: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0369A1",
    flexShrink: 1,
    textAlign: "right",
  },
  itemEmpty: {
    fontSize: 13,
    color: "#94A3B8",
  },
  itemHint: {
    fontSize: 11,
    color: "#64748B",
    lineHeight: 16,
    marginTop: 10,
  },
  logButton: {
    backgroundColor: "#F59E0B",
  },
  turnoverButton: {
    backgroundColor: "#0F172A",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  disposalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EDF1F7",
    padding: 16,
    marginBottom: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  categoryTag: {
    backgroundColor: "#E2E8F0",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  categoryTagText: {
    color: "#0F172A",
    fontWeight: "700",
    fontSize: 12,
  },
  cardDate: {
    color: "#64748B",
    fontSize: 12,
  },
  disposalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 4,
  },
  assetCodeLine: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  statusLine: {
    flexDirection: "row",
    marginBottom: 10,
  },
  statusTextChip: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  statusDone: {
    backgroundColor: "#ECFDF5",
    color: "#047857",
  },
  statusOpen: {
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
  },
  cardMeta: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  cardReasonTitle: {
    marginTop: 12,
    color: "#0F172A",
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 4,
  },
  cardReason: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  cardActionLabel: {
    marginTop: 14,
    color: "#64748B",
    fontWeight: "700",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  emptyState: {
    marginTop: 24,
    padding: 24,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  emptyStateText: {
    color: "#64748B",
    fontSize: 15,
    textAlign: "center",
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 6,
  },
  modalHint: {
    color: "#64748B",
    fontSize: 12,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: "#F4F7FB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#0F172A",
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dateLabel: {
    color: "#0F172A",
    fontWeight: "700",
    fontSize: 13,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#F4F7FB",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    minWidth: 160,
    justifyContent: "center",
  },
  dateValue: {
    color: "#0F172A",
    fontWeight: "700",
    fontSize: 13,
  },
  modalRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: {
    backgroundColor: "#F1F5F9",
  },
  modalBtnGhostText: {
    color: "#0F172A",
    fontWeight: "700",
  },
  modalBtnPrimary: {
    backgroundColor: "#0284C7",
  },
  modalBtnPrimaryText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  scannerHeader: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0F172A",
  },
  scannerClose: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },
  cameraWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FBBF24",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  scanHint: {
    marginTop: 18,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
  },
  confirmLine: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 6,
  },
  confirmCode: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748B",
    marginBottom: 14,
    marginTop: 2,
  },
});
