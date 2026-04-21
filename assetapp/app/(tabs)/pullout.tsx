import React, { useMemo, useState } from "react";
import {
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

const pullouts = [
  {
    id: "pullout-1",
    title: "Old Desktop PC i3-4th Gen",
    category: "Computer Equipment",
    department: "Finance Department",
    requestedBy: "Prof. Juan Cruz",
    date: "2024-04-11",
    reason: "Upgrading to newer model",
  },
  {
    id: "pullout-2",
    title: "HP LaserJet Printer 1020",
    category: "Office Equipment",
    department: "Engineering",
    requestedBy: "Dr. Maria Santos",
    date: "2024-04-09",
    reason: "Replacement with multifunction printer",
  },
  {
    id: "pullout-3",
    title: "Old Projector SVGA",
    category: "AV Equipment",
    department: "Business Admin",
    requestedBy: "Prof. Pedro Garcia",
    date: "2024-04-07",
    reason: "Upgrading to HD projector",
  },
];

export default function PulloutScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filteredPullouts = useMemo(
    () =>
      pullouts.filter((item) =>
        [item.title, item.category, item.department, item.requestedBy]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [search]
  );

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
        <Text style={styles.headerTitle}>Record Pullout</Text>
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
          <Text style={styles.statsCardValue}>6</Text>
          <Text style={styles.statsCardSubtitle}>
            Complete log of all pulled out institutional assets
          </Text>
        </LinearGradient>

        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <MaterialCommunityIcons name="magnify" size={22} color="#6B7280" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search pulled out assets..."
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            style={styles.calendarButton}
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
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonText}>Log Pullout</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.turnoverButton]}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonText}>Turn Over</Text>
          </TouchableOpacity>
        </View>

        {filteredPullouts.map((item) => (
          <View key={item.id} style={styles.disposalCard}>
            <View style={styles.cardHeader}>
              <View style={styles.categoryTag}>
                <Text style={styles.categoryTagText}>{item.category}</Text>
              </View>
              <Text style={styles.cardDate}>{item.date}</Text>
            </View>
            <Text style={styles.disposalTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>{`Department: ${item.department}`}</Text>
            <Text style={styles.cardMeta}>{`Requested by: ${item.requestedBy}`}</Text>
            <Text style={styles.cardReasonTitle}>Reason</Text>
            <Text style={styles.cardReason}>{item.reason}</Text>
          </View>
        ))}

        {filteredPullouts.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No pulled out assets match your search.
            </Text>
          </View>
        )}
      </ScrollView>
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
});
