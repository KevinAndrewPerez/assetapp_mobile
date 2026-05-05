import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../lib/supabase";
import { getStoredUser } from "../lib/userService";
import DateTimePicker from "@react-native-community/datetimepicker";

type DisposalLogRow = {
  id: string | number;
  asset_id?: string | number | null;
  title?: string | null;
  description?: string | null;
  performed_by?: string | number | null;
  status?: string | null;
  created_at?: string | null;
  [key: string]: any;
};

type AssetRow = {
  Asset_code?: string | null;
  Asset_name?: string | null;
  Category?: string | null;
  department?: string | null;
  Lifecycle_Status?: string | null;
};

export default function DisposalScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<"from" | "to" | null>(null);

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<DisposalLogRow[]>([]);
  const [assetsByCode, setAssetsByCode] = useState<Record<string, AssetRow>>({});
  const [usersById, setUsersById] = useState<Record<string, { full_name?: string | null }>>({});

  const [scannerVisible, setScannerVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [pendingCode, setPendingCode] = useState("");
  const [pendingAsset, setPendingAsset] = useState<AssetRow | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const { data: logRows, error } = await supabase
        .from("disposals")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const disposalRows = (logRows ?? []).filter((row: DisposalLogRow) => {
        const status = String(row.status ?? "").toLowerCase();
        const title = String(row.title ?? "").toLowerCase();
        return status === "disposed" || title.includes("dispos");
      });

      setLogs(disposalRows);

      const assetCodes = Array.from(
        new Set(
          disposalRows
            .map((row) => String(row.asset_id ?? "").trim())
            .filter(Boolean)
        )
      );

      if (assetCodes.length > 0) {
        const { data: assetRows, error: assetErr } = await supabase
          .from("assets")
          .select("Asset_code, Asset_name, Category, department, Lifecycle_Status")
          .in("Asset_code", assetCodes);

        if (assetErr) throw assetErr;

        const byCode: Record<string, AssetRow> = {};
        (assetRows ?? []).forEach((a: AssetRow) => {
          const code = String(a.Asset_code ?? "").trim();
          if (code) byCode[code] = a;
        });
        setAssetsByCode(byCode);
      } else {
        setAssetsByCode({});
      }

      const performerIds = Array.from(
        new Set(
          disposalRows
            .map((row) => row.performed_by)
            .filter((v) => v !== null && v !== undefined)
            .map((v) => String(v))
            .filter(Boolean)
        )
      );

      if (performerIds.length > 0) {
        const { data: userRows, error: userErr } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", performerIds);

        if (!userErr) {
          const byId: Record<string, { full_name?: string | null }> = {};
          (userRows ?? []).forEach((u: any) => {
            byId[String(u.id)] = { full_name: u.full_name };
          });
          setUsersById(byId);
        }
      } else {
        setUsersById({});
      }
    } catch (e: any) {
      console.error("Failed to load disposal logs:", e);
      Alert.alert("Error", e?.message || "Failed to load disposal logs.");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredDisposals = useMemo(() => {
    const query = search.trim().toLowerCase();
    const fromD = fromDate;
    const toD = toDate;

    return logs.filter((row) => {
      const code = String(row.asset_id ?? "").trim();
      const asset = assetsByCode[code];
      const title = String(asset?.Asset_name ?? row.title ?? "").trim();
      const category = String(asset?.Category ?? "").trim();
      const department = String(asset?.department ?? "").trim();
      const requestedBy =
        usersById[String(row.performed_by ?? "")]?.full_name ??
        String(row.performed_by ?? "");
      const reasonText = String(row.description ?? "").trim();

      const haystack = [title, category, department, requestedBy, code, reasonText]
        .join(" ")
        .toLowerCase();

      if (query && !haystack.includes(query)) return false;

      if (fromD || toD) {
        const created = row.created_at ? new Date(String(row.created_at)) : null;
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
  }, [logs, search, fromDate, toDate, assetsByCode, usersById]);

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
        .select("Asset_code, Asset_name, Category, department, Lifecycle_Status")
        .eq("Asset_code", code)
        .maybeSingle();

      if (error) throw error;
      if (!asset) {
        Alert.alert("Not Found", `No asset found for code: ${code}`);
        setScanned(false);
        return;
      }

      const status = String(asset.Lifecycle_Status ?? "").trim();
      if (status !== "Active" && status !== "Acquired") {
        Alert.alert("Not Allowed", `Only Active or Acquired assets can be disposed. Current status: ${status || "Unknown"}`);
        setScanned(false);
        return;
      }

      setPendingCode(code);
      setPendingAsset(asset as AssetRow);
      setReason("");
      setScannerVisible(false);
      setReasonModalVisible(true);
    } catch (e: any) {
      console.error("Scan lookup failed:", e);
      Alert.alert("Error", e?.message || "Failed to validate scanned asset.");
      setScanned(false);
    }
  };

  const confirmDisposal = async () => {
    if (!pendingCode) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const user = await getStoredUser();
      const performedBy = user?.id ?? user?.full_name ?? "Admin";
      const note = reason.trim() || "Disposed via QR scan";
      const now = new Date().toISOString();

      const { error: logError } = await supabase.from("disposals").insert([
        {
          asset_id: pendingCode,
          title: "Disposed",
          description: note,
          performed_by: performedBy,
          status: "Disposed",
          created_at: now,
        },
      ]);
      if (logError) throw logError;

      const { error: assetError } = await supabase
        .from("assets")
        .update({ Lifecycle_Status: "Disposed", updated_at: now })
        .eq("Asset_code", pendingCode);
      if (assetError) throw assetError;

      setReasonModalVisible(false);
      setPendingAsset(null);
      setPendingCode("");
      await loadLogs();
    } catch (e: any) {
      console.error("Failed to log disposal:", e);
      Alert.alert("Error", e?.message || "Failed to record disposal.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteFilteredLogs = async () => {
    const ids = filteredDisposals
      .map((row) => row.id)
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v));

    if (ids.length === 0) {
      Alert.alert("Nothing to delete", "No disposal logs match the current filters.");
      return;
    }

    Alert.alert(
      "Delete Disposal Logs",
      `Delete ${ids.length} disposal log(s)? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase.from("disposals").delete().in("id", ids);
              if (error) throw error;
              await loadLogs();
            } catch (e: any) {
              console.error("Failed to delete disposal logs:", e);
              Alert.alert("Error", e?.message || "Failed to delete disposal logs.");
            }
          },
        },
      ]
    );
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record Disposal</Text>
        <TouchableOpacity
          style={styles.notificationButton}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="bell-outline"
            size={24}
            color="#FFFFFF"
          />
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#F87171", "#DC2626"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statsCard}
        >
          <View style={styles.statsCardHeader}>
            <MaterialCommunityIcons
              name="delete-circle"
              size={28}
              color="#FFFFFF"
            />
            <Text style={styles.statsCardTitle}>Total Disposed Assets</Text>
          </View>
          <Text style={styles.statsCardValue}>{logs.length}</Text>
          <Text style={styles.statsCardSubtitle}>
            Complete log of all disposed institutional assets
          </Text>
        </LinearGradient>

        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <MaterialCommunityIcons name="magnify" size={22} color="#6B7280" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search disposed assets..."
              placeholderTextColor="#9CA3AF"
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
            <Text style={styles.actionButtonText}>Log a Disposal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={deleteFilteredLogs}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonText}>Delete Disposal</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#DC2626" />
          </View>
        ) : (
          filteredDisposals.map((row) => {
            const code = String(row.asset_id ?? "").trim();
            const asset = assetsByCode[code];
            const title = String(asset?.Asset_name ?? row.title ?? "Unknown Asset");
            const category = String(asset?.Category ?? "Unknown");
            const department = String(asset?.department ?? "N/A");
            const requestedBy =
              usersById[String(row.performed_by ?? "")]?.full_name ??
              String(row.performed_by ?? "N/A");
            const reasonText = String(row.description ?? "N/A");

            return (
              <View key={String(row.id)} style={styles.disposalCard}>
            <View style={styles.cardHeader}>
              <View style={styles.categoryTag}>
                <Text style={styles.categoryTagText}>{category}</Text>
              </View>
              <Text style={styles.cardDate}>{formatDateTime(row.created_at)}</Text>
            </View>
            <Text style={styles.disposalTitle}>{title}</Text>
            <Text style={styles.cardMeta}>{`Department: ${department}`}</Text>
            <Text style={styles.cardMeta}>{`Requested by: ${requestedBy}`}</Text>
            <Text style={styles.cardReasonTitle}>Reason</Text>
            <Text style={styles.cardReason}>{reasonText}</Text>
              </View>
            );
          })
        )}

        {!loading && filteredDisposals.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No disposed assets match your search.
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
            <Text style={styles.modalTitle}>Confirm Disposal</Text>
            <Text style={styles.confirmLine}>{pendingAsset?.Asset_name || "Asset"}</Text>
            <Text style={styles.confirmCode}>{pendingCode}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor="#94A3B8"
              style={styles.modalInput}
              multiline
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => {
                  setReasonModalVisible(false);
                  setPendingAsset(null);
                  setPendingCode("");
                }}
                disabled={submitting}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={confirmDisposal}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Confirm</Text>
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
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#F9FAFB",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    flex: 1,
    textAlign: "center",
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
    borderRadius: 24,
    padding: 20,
    marginBottom: 18,
  },
  statsCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  statsCardTitle: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "600",
  },
  statsCardValue: {
    color: "#F8FAFC",
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
    justifyContent: "center",
    alignItems: "center",
  },
  logButton: {
    backgroundColor: "#F59E0B",
  },
  deleteButton: {
    backgroundColor: "#0F172A",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  disposalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
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
    color: "#1F2937",
    fontWeight: "700",
    fontSize: 12,
  },
  cardDate: {
    color: "#6B7280",
    fontSize: 12,
  },
  disposalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 10,
  },
  cardMeta: {
    color: "#4B5563",
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
    color: "#4B5563",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    marginTop: 24,
    padding: 24,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  emptyStateText: {
    color: "#6B7280",
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
    backgroundColor: "#F8FAFC",
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
    backgroundColor: "#F8FAFC",
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
    backgroundColor: "#DC2626",
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
    borderRadius: 24,
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
