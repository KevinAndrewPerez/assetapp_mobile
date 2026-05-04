import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { fetchAssetsWithDepartments, AssetSummary, updateDepartmentHead } from '../../lib/assetService';
import { getStoredUser } from '../../lib/userService';
import { supabase } from '../../lib/supabase';
import QRCode from 'react-native-qrcode-svg';
import QRViewModal from '../../components/QRViewModal';

export default function AssetsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([]);
  const [expandedDeptId, setExpandedDeptId] = useState<string | number | null>(null);
  const [search, setSearch] = useState('');
  
  // Edit Dept Head Modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [newHeadName, setNewHeadName] = useState('');
  const [newHeadEmail, setNewHeadEmail] = useState('');
  const [updating, setUpdating] = useState(false);

  // QR Modal
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [selectedQrValue, setSelectedQrValue] = useState('');
  const [selectedQrTitle, setSelectedQrTitle] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [userData, { assets, departments: depts }] = await Promise.all([
        getStoredUser(),
        fetchAssetsWithDepartments()
      ]);
      setUser(userData);
      setAllAssets(assets);
      
      // Fetch heads for each department
      const deptsWithHeads = await Promise.all(depts.map(async (d) => {
        const { data: head } = await supabase
          .from('users')
          .select('full_name, email')
          .eq('department_id', d.id)
          .eq('role', 'Department Head')
          .limit(1)
          .single();
        return { ...d, headName: head?.full_name || 'Unassigned', headEmail: head?.email || 'N/A' };
      }));
      
      setDepartments(deptsWithHeads);
    } catch (error) {
      console.error('Load data error:', error);
      Alert.alert('Error', 'Failed to load assets data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openQrModal = (value: string, title: string) => {
    setSelectedQrValue(value);
    setSelectedQrTitle(title);
    setQrModalVisible(true);
  };

  const handleEditHead = (dept: any) => {
    setEditingDept(dept);
    // In a real app, you'd fetch the current head from the users table
    setNewHeadName('');
    setNewHeadEmail('');
    setEditModalVisible(true);
  };

  const saveDeptHead = async () => {
    if (!newHeadName || !newHeadEmail) {
      Alert.alert('Missing Info', 'Please fill in both name and email.');
      return;
    }
    setUpdating(true);
    try {
      await updateDepartmentHead(editingDept.id, newHeadName, newHeadEmail);
      Alert.alert('Success', 'Department head updated successfully.');
      setEditModalVisible(false);
      loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to update department head.');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1E3A5F" />
      </View>
    );
  }

  const isAdmin = user?.role === 'Admin';
  const userDeptId = user?.department_id;

  // Filter departments based on user role
  const visibleDepartments = isAdmin 
    ? departments 
    : departments.filter(d => d.id === userDeptId);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assets & Custodianship</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.badge}><Text style={styles.badgeText}>3</Text></View>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {visibleDepartments.map((dept) => {
          const deptAssets = allAssets.filter(a => 
            String(a.departmentId) === String(dept.id) ||
            a.department?.trim().toLowerCase() === dept.Name?.trim().toLowerCase()
          );
          const isExpanded = expandedDeptId === dept.id;
          
          const stats = {
            Acquired: deptAssets.filter(a => a.status === 'Acquired').length,
            Active: deptAssets.filter(a => a.status === 'Active').length,
            Repair: deptAssets.filter(a => a.status === 'For Repair').length,
            Pullout: deptAssets.filter(a => a.status === 'Pulled Out' || a.status === 'Pullout').length,
            Disposed: deptAssets.filter(a => a.status === 'Disposed' || a.status === 'Disposal').length,
          };
          const total = deptAssets.length;

          return (
            <View key={dept.id} style={styles.deptCard}>
              <TouchableOpacity 
                style={styles.deptHeader} 
                onPress={() => setExpandedDeptId(isExpanded ? null : dept.id)}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.deptName}>{dept.Name}</Text>
                  <View style={styles.deptSubInfo}>
                    <MaterialCommunityIcons name="account-outline" size={14} color="#FBBF24" />
                    <Text style={styles.deptHeadText}>{dept.headName}</Text>
                  </View>
                  <View style={styles.deptSubInfo}>
                    <MaterialCommunityIcons name="cube-outline" size={14} color="#64748B" />
                    <Text style={styles.assetCountText}>Total Assets: {total}</Text>
                  </View>
                </View>
                <MaterialCommunityIcons name={isExpanded ? "chevron-up" : "chevron-down"} size={24} color="#64748B" />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.deptDetails}>
                  {/* Dept Head Info Card */}
                  <View style={styles.headInfoCard}>
                    <View style={styles.headInfoHeader}>
                      <Text style={styles.headInfoLabel}>Department Head</Text>
                      {isAdmin && (
                        <TouchableOpacity onPress={() => handleEditHead(dept)}>
                          <MaterialCommunityIcons name="pencil-outline" size={18} color="#FBBF24" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.headName}>{dept.headName}</Text>
                    <Text style={styles.headEmail}>{dept.headEmail}</Text>
                  </View>

                  {/* Lifecycle Distribution */}
                  <Text style={styles.sectionTitle}>Asset Lifecycle Distribution</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressSegment, { flex: stats.Acquired, backgroundColor: '#3B82F6' }]} />
                    <View style={[styles.progressSegment, { flex: stats.Active, backgroundColor: '#10B981' }]} />
                    <View style={[styles.progressSegment, { flex: stats.Repair, backgroundColor: '#FBBF24' }]} />
                    <View style={[styles.progressSegment, { flex: stats.Pullout, backgroundColor: '#94A3B8' }]} />
                    <View style={[styles.progressSegment, { flex: stats.Disposed, backgroundColor: '#EF4444' }]} />
                  </View>

                  <View style={styles.statsGrid}>
                    <StatBox label="Acquired" count={stats.Acquired} total={total} color="#3B82F6" />
                    <StatBox label="Active" count={stats.Active} total={total} color="#10B981" />
                    <StatBox label="For Repair" count={stats.Repair} total={total} color="#FBBF24" />
                    <StatBox label="Pulled Out" count={stats.Pullout} total={total} color="#94A3B8" />
                    <StatBox label="Disposed" count={stats.Disposed} total={total} color="#EF4444" />
                  </View>

                  <TouchableOpacity 
                    style={styles.viewAllButton}
                    onPress={() => router.push({ 
                      pathname: '/assets-list', 
                      params: { 
                        department: dept.Name,
                        departmentId: dept.id 
                      } 
                    })}
                  >
                    <Text style={styles.viewAllText}>View All Assets</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Edit Head Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Department Head</Text>
            <TextInput 
              style={styles.modalInput} 
              placeholder="Full Name" 
              value={newHeadName} 
              onChangeText={setNewHeadName} 
            />
            <TextInput 
              style={styles.modalInput} 
              placeholder="Email Address" 
              value={newHeadEmail} 
              onChangeText={setNewHeadEmail}
              keyboardType="email-address"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={saveDeptHead} disabled={updating}>
                {updating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <QRViewModal 
        visible={qrModalVisible} 
        onClose={() => setQrModalVisible(false)} 
        value={selectedQrValue} 
        title={selectedQrTitle} 
      />
    </SafeAreaView>
  );
}

function StatBox({ label, count, total, color }: { label: string, count: number, total: number, color: string }) {
  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  return (
    <View style={styles.statBox}>
      <View style={styles.statBoxHeader}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statDot, { backgroundColor: color }]} />
      </View>
      <Text style={styles.statValue}>{count} <Text style={styles.statPercent}>({percentage}%)</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#1E3A5F', padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  notificationButton: { position: 'relative' },
  badge: { position: 'absolute', top: -5, right: -5, backgroundColor: '#FBBF24', borderRadius: 10, width: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#1E3A5F' },
  scrollContent: { padding: 16 },
  deptCard: { backgroundColor: '#FFF', borderRadius: 20, marginBottom: 16, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  deptHeader: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deptName: { fontSize: 18, fontWeight: '700', color: '#1E3A5F', marginBottom: 4 },
  deptSubInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  deptHeadText: { fontSize: 13, color: '#FBBF24', fontWeight: '500' },
  assetCountText: { fontSize: 13, color: '#64748B' },
  deptDetails: { padding: 20, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  headInfoCard: { backgroundColor: '#F8FAFC', padding: 16, borderRadius: 16, marginBottom: 20 },
  headInfoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headInfoLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '600' },
  headName: { fontSize: 16, fontWeight: '700', color: '#1E3A5F' },
  headEmail: { fontSize: 14, color: '#3B82F6' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1E3A5F', marginBottom: 12 },
  progressBar: { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', marginBottom: 16 },
  progressSegment: { height: '100%' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: { width: '48%', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', padding: 12, borderRadius: 12 },
  statBoxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#1E3A5F' },
  statPercent: { fontSize: 12, color: '#94A3B8', fontWeight: '400' },
  viewAllButton: { backgroundColor: '#1E3A5F', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  viewAllText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 20, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1E3A5F', marginBottom: 20 },
  modalInput: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 15 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  cancelButton: { flex: 1, padding: 14, alignItems: 'center' },
  cancelButtonText: { color: '#64748B', fontWeight: '600' },
  saveButton: { flex: 2, backgroundColor: '#FBBF24', padding: 14, borderRadius: 12, alignItems: 'center' },
  saveButtonText: { color: '#1E3A5F', fontWeight: '700' },
});
