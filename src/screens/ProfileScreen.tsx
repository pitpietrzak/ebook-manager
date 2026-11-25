import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { showAlert } from '../utils/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../utils/supabase';
import { clearGoogleAuth } from '../utils/googleAuth';
import { User, LogOut, Moon, Sun, Edit3, Bell, Shield, LayoutGrid, List, Mail, Download, CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native';
import InputModal from '../components/InputModal';
import { useVersion } from '../contexts/VersionContext';
import { connectGoogleAccount } from '../utils/googleAuth';

type PendingLinkReport = {
  id: string;
  link_type: 'goodreads' | 'lubimyczytac';
  current_url: string | null;
  proposed_url: string;
  books?: {
    title?: string | null;
    author?: string | null;
  } | null;
};

type UnverifiedBook = {
  id: string;
  title: string;
  author?: string | null;
  created_at: string;
  goodreads_url?: string | null;
  lubimyczytac_url?: string | null;
};

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { profile, updateDisplayName, setNotificationsEnabled, updateKindleEmail } = useProfile();
  const { currentVersion, checkForUpdates } = useVersion();
  const styles = getStyles(colors, isDark);

  const [modalVisible, setModalVisible] = useState(false);
  const [pendingReports, setPendingReports] = useState<PendingLinkReport[]>([]);
  const [unverifiedBooks, setUnverifiedBooks] = useState<UnverifiedBook[]>([]);
  const [verificationQueueCollapsed, setVerificationQueueCollapsed] = useState(false);
  const [loadingUnverified, setLoadingUnverified] = useState(false);
  const [processingBookId, setProcessingBookId] = useState<string | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [processingReportId, setProcessingReportId] = useState<string | null>(null);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    message: string;
    defaultValue: string;
    type: 'name' | 'kindle';
  } | null>(null);
  const [readCount, setReadCount] = useState<number | null>(null);
  const [reconnectingGoogle, setReconnectingGoogle] = useState(false);

  useEffect(() => {
    if (profile?.is_admin) {
      fetchUnverifiedBooks();
      fetchPendingReports();
    }
  }, [profile?.is_admin]);

  useEffect(() => {
    if (!profile?.id) return;

    const fetchReadCount = async () => {
      try {
        const { count } = await supabase
          .from('book_reads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id);
        setReadCount(count ?? 0);
      } catch (e) {
        console.warn('Read count fetch failed:', e);
      }
    };

    fetchReadCount();
  }, [profile?.id]);

  const fetchUnverifiedBooks = async () => {
    try {
      setLoadingUnverified(true);
      const { data, error } = await supabase
        .from('books')
        .select('id, title, author, created_at, goodreads_url, lubimyczytac_url')
        .eq('verified', false)
        .order('created_at', { ascending: true })
        .limit(30);

      if (error) throw error;
      setUnverifiedBooks((data || []) as UnverifiedBook[]);
    } catch (e) {
      console.error('Error fetching unverified books:', e);
      showAlert('Error', 'Could not load unverified books.');
    } finally {
      setLoadingUnverified(false);
    }
  };

  const fetchPendingReports = async () => {
    try {
      setLoadingReports(true);
      const { data, error } = await supabase
        .from('book_link_reports')
        .select('id, link_type, current_url, proposed_url, books(title, author)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(25);

      if (error) throw error;
      setPendingReports((data || []) as PendingLinkReport[]);
    } catch (e) {
      console.error('Error fetching link reports:', e);
      showAlert('Error', 'Could not load pending reports.');
    } finally {
      setLoadingReports(false);
    }
  };

  const handleVerifyBook = async (bookId: string) => {
    try {
      setProcessingBookId(bookId);
      const { error } = await supabase.rpc('verify_book', {
        p_book_id: bookId,
      });
      if (error) throw error;
      setUnverifiedBooks((prev) => prev.filter((b) => b.id !== bookId));
    } catch (e: any) {
      showAlert('Verification failed', e?.message || 'Could not verify this book.');
    } finally {
      setProcessingBookId(null);
    }
  };

  const handleAcceptReport = async (reportId: string) => {
    try {
      setProcessingReportId(reportId);
      const { error } = await supabase.rpc('accept_link_report', {
        p_report_id: reportId,
        p_admin_note: null,
      });
      if (error) throw error;
      setPendingReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (e: any) {
      showAlert('Accept failed', e?.message || 'Could not accept this report.');
    } finally {
      setProcessingReportId(null);
    }
  };

  const handleRejectReport = async (reportId: string) => {
    try {
      setProcessingReportId(reportId);
      const { error } = await supabase.rpc('reject_link_report', {
        p_report_id: reportId,
        p_admin_note: null,
      });
      if (error) throw error;
      setPendingReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (e: any) {
      showAlert('Reject failed', e?.message || 'Could not reject this report.');
    } finally {
      setProcessingReportId(null);
    }
  };

  const openUrlIfPossible = async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      showAlert('Invalid URL', 'Could not open this URL.');
      return;
    }
    await Linking.openURL(url);
  };

  const handleLogout = async () => {
    await clearGoogleAuth();
    const { error } = await supabase.auth.signOut();
    if (error) showAlert('Error', error.message);
  };

  const handleReconnectGoogle = async () => {
    try {
      setReconnectingGoogle(true);
      const completed = await connectGoogleAccount({ forceConsent: true });
      if (completed) {
        showAlert('Connected', 'Google Drive access has been refreshed.');
      }
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setReconnectingGoogle(false);
    }
  };

  const handleEditName = () => {
    setModalConfig({
      title: 'Display Name',
      message: 'Enter your new display name',
      defaultValue: profile?.display_name || '',
      type: 'name'
    });
    setModalVisible(true);
  };

  const handleEditKindle = () => {
    setModalConfig({
      title: 'Kindle Email',
      message: `Enter your @kindle.com address. \n\nIMPORTANT: Add "${profile?.email}" to your Amazon approved sender list.`,
      defaultValue: profile?.kindle_email || '',
      type: 'kindle'
    });
    setModalVisible(true);
  };

  const handleModalSave = async (value: string) => {
    if (!modalConfig) return;
    
    try {
      if (modalConfig.type === 'name') {
        await updateDisplayName(value);
      } else {
        await updateKindleEmail(value);
      }
      setModalVisible(false);
    } catch (e: any) {
      showAlert('Error', 'Failed to save changes.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <User size={40} color={colors.primary} />
          </View>
          <Text style={styles.name}>{profile?.display_name || 'Generic Sloth'}</Text>
          <Text style={styles.email} numberOfLines={1} ellipsizeMode="tail">{profile?.email}</Text>
          {readCount !== null && (
            <View style={styles.readStatPill}>
              <CheckCircle2 size={14} color={colors.primary} />
              <Text style={styles.readStatText}>
                {readCount} {readCount === 1 ? 'book' : 'books'} read
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          
          <TouchableOpacity style={styles.row} onPress={handleEditName}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '11' }]}>
                <Edit3 size={20} color={colors.primary} />
              </View>
              <Text style={styles.rowLabel}>Display Name</Text>
            </View>
            <Text style={[styles.rowValue, { flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} ellipsizeMode="tail">
              {profile?.display_name}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={toggleTheme}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.accent + '11' }]}>
                {isDark ? <Sun size={20} color={colors.accent} /> : <Moon size={20} color={colors.accent} />}
              </View>
              <Text style={styles.rowLabel}>{isDark ? 'Light Mode' : 'Dark Mode'}</Text>
            </View>
            <View style={[styles.toggle, isDark && styles.toggleActive]}>
              <View style={[styles.toggleDot, isDark && styles.toggleDotActive]} />
            </View>
          </TouchableOpacity>


        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          
          <TouchableOpacity 
            style={styles.row} 
            onPress={() => setNotificationsEnabled(!profile?.notifications_enabled)}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FFD70011' }]}>
                <Bell size={20} color="#FFD700" />
              </View>
              <Text style={styles.rowLabel}>Notifications</Text>
            </View>
            <View style={[styles.toggle, profile?.notifications_enabled && styles.toggleActive]}>
              <View style={[styles.toggleDot, profile?.notifications_enabled && styles.toggleDotActive]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleEditKindle}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FF990011' }]}>
                <Mail size={20} color="#FF9900" />
              </View>
              <Text style={styles.rowLabel}>Kindle Email</Text>
            </View>
            <Text style={[styles.rowValue, { flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} ellipsizeMode="tail">
              {profile?.kindle_email || 'Not set'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleReconnectGoogle} disabled={reconnectingGoogle}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#4285F411' }]}>
                <RefreshCw size={20} color="#4285F4" />
              </View>
              <Text style={styles.rowLabel}>Reconnect Google Drive</Text>
            </View>
            {reconnectingGoogle && <ActivityIndicator size="small" color={colors.primary} />}
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '11' }]}>
                <Download size={20} color={colors.primary} />
              </View>
              <Text style={styles.rowLabel}>App Version</Text>
            </View>
            <Text style={styles.rowValue}>{currentVersion}</Text>
          </View>

          <TouchableOpacity style={styles.row} onPress={() => checkForUpdates(false)}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.accent + '11' }]}>
                <Download size={20} color={colors.accent} />
              </View>
              <Text style={styles.rowLabel}>Check for Updates</Text>
            </View>
          </TouchableOpacity>
        </View>

        
        {profile?.is_admin && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.adminHeaderRow}
              onPress={() => setVerificationQueueCollapsed(!verificationQueueCollapsed)}
            >
              <Text style={styles.sectionTitle}>Admin Verification Queue</Text>
              <View style={styles.headerRightContent}>
                <TouchableOpacity onPress={(e) => {
                  e.stopPropagation();
                  fetchUnverifiedBooks();
                }} style={{ marginRight: 8 }}>
                  <Text style={styles.refreshReportsText}>Refresh</Text>
                </TouchableOpacity>
                {verificationQueueCollapsed ? <ChevronDown size={20} color={colors.primary} /> : <ChevronUp size={20} color={colors.primary} />}
              </View>
            </TouchableOpacity>

            {!verificationQueueCollapsed && (
              <>
                {loadingUnverified ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
                ) : unverifiedBooks.length === 0 ? (
                  <Text style={styles.emptyReportsText}>All books are verified.</Text>
                ) : (
                  unverifiedBooks.map((book) => (
                    <View key={book.id} style={styles.reportCard}>
                      <View style={styles.reportTopRow}>
                        <Shield size={16} color={colors.primary} />
                        <Text style={styles.reportTypeText}>Pending verification</Text>
                      </View>

                      <Text style={styles.reportBookTitle}>
                        {book.title}
                        {book.author ? ` • ${book.author}` : ''}
                      </Text>

                      <Text style={styles.reportLinkText}>Goodreads: {book.goodreads_url ? 'present' : 'missing'}</Text>
                      <Text style={styles.reportLinkText}>LubimyCzytać: {book.lubimyczytac_url ? 'present' : 'missing'}</Text>

                      <View style={styles.reportActionsRow}>
                        <TouchableOpacity
                          style={styles.acceptReportBtn}
                          onPress={() => handleVerifyBook(book.id)}
                          disabled={processingBookId === book.id}
                        >
                          <View style={styles.verifyBtnInner}>
                            <CheckCircle2 size={14} color="#fff" />
                            <Text style={styles.acceptReportBtnText}>
                              {processingBookId === book.id ? 'Verifying...' : 'Mark as verified'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        )}

        {profile?.is_admin && (
          <View style={styles.section}>
            <View style={styles.adminHeaderRow}>
              <Text style={styles.sectionTitle}>Admin Link Reports</Text>
              <TouchableOpacity onPress={fetchPendingReports}>
                <Text style={styles.refreshReportsText}>Refresh</Text>
              </TouchableOpacity>
            </View>

            {loadingReports ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
            ) : pendingReports.length === 0 ? (
              <Text style={styles.emptyReportsText}>No pending reports.</Text>
            ) : (
              pendingReports.map((report) => (
                <View key={report.id} style={styles.reportCard}>
                  <View style={styles.reportTopRow}>
                    <Shield size={16} color={colors.primary} />
                    <Text style={styles.reportTypeText}>
                      {report.link_type === 'goodreads' ? 'Goodreads' : 'LubimyCzytać'}
                    </Text>
                  </View>

                  <Text style={styles.reportBookTitle}>
                    {report.books?.title || 'Unknown title'}
                    {report.books?.author ? ` • ${report.books.author}` : ''}
                  </Text>

                  {report.current_url ? (
                    <TouchableOpacity onPress={() => openUrlIfPossible(report.current_url!)}>
                      <Text style={styles.reportLinkText}>Current: {report.current_url}</Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity onPress={() => openUrlIfPossible(report.proposed_url)}>
                    <Text style={styles.reportLinkText}>Proposed: {report.proposed_url}</Text>
                  </TouchableOpacity>

                  <View style={styles.reportActionsRow}>
                    <TouchableOpacity
                      style={styles.rejectReportBtn}
                      onPress={() => handleRejectReport(report.id)}
                      disabled={processingReportId === report.id}
                    >
                      <Text style={styles.rejectReportBtnText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.acceptReportBtn}
                      onPress={() => handleAcceptReport(report.id)}
                      disabled={processingReportId === report.id}
                    >
                      <Text style={styles.acceptReportBtnText}>
                        {processingReportId === report.id ? 'Processing...' : 'Accept & Replace'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <LogOut size={20} color="#F44336" style={{ marginRight: 10 }} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>Biblioteczka Leniwców v{currentVersion}</Text>
      </ScrollView>

      {modalConfig && (
        <InputModal
          visible={modalVisible}
          title={modalConfig.title}
          message={modalConfig.message}
          defaultValue={modalConfig.defaultValue}
          onSave={handleModalSave}
          onCancel={() => setModalVisible(false)}
          keyboardType={modalConfig.type === 'kindle' ? 'email-address' : 'default'}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarContainer: {
    width: 80, height: 80,
    borderRadius: 40,
    backgroundColor: colors.card,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2, borderColor: colors.primary + '33',
  },
  name: {
    fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4,
  },
  email: {
    fontSize: 14, color: colors.textSecondary,
  },
  readStatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 16, backgroundColor: colors.primary + '15',
  },
  readStatText: {
    fontSize: 13, fontWeight: '700', color: colors.primary,
  },
  section: {
    marginBottom: 24,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 16, marginLeft: 4,
  },
  adminHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerRightContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshReportsText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyReportsText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  reportCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
  },
  reportTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  reportTypeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  reportBookTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  reportLinkText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  reportActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  verifyBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  acceptReportBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acceptReportBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  rejectReportBtn: {
    flex: 1,
    backgroundColor: isDark ? 'rgba(244,67,54,0.2)' : 'rgba(244,67,54,0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rejectReportBtnText: {
    color: '#F44336',
    fontWeight: '700',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLeft: {
    flexDirection: 'row', alignItems: 'center',
  },
  rowRight: {
    flexDirection: 'row', alignItems: 'center',
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16, color: colors.text, fontWeight: '500',
  },
  rowValue: {
    fontSize: 14, color: colors.textSecondary,
  },
  toggle: {
    width: 44, height: 24, borderRadius: 12,
    backgroundColor: isDark ? '#3A2552' : '#E0E0E0',
    padding: 2,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleDotActive: {
    transform: [{ translateX: 20 }],
  },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 20,
    backgroundColor: isDark ? '#F4433611' : '#F4433608',
    marginTop: 8,
  },
  logoutText: {
    fontSize: 16, fontWeight: '700', color: '#F44336',
  },
  footerText: {
    textAlign: 'center', color: colors.textSecondary, fontSize: 12, marginTop: 40,
  }
});
