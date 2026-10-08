import React, { useState, useEffect, useMemo } from 'react';
import * as repo from './services/repo';
import * as auth from './services/auth';
import { useRepo } from './hooks/useRepo';
import { User, IncidentReport, Advisory } from './types';
import { DashboardSidebar } from './components/DashboardSidebar';
import { DashboardHeader } from './components/DashboardHeader';
import { DrillDownModal } from './components/DrillDownModal';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { EmergencyAlertNotificationModal } from './components/EmergencyAlertNotificationModal';
import { AdvisoryCenter } from './components/AdvisoryCenter';
import { EvacuationDirectory } from './components/EvacuationDirectory';
import { HotlineDirectory } from './components/HotlineDirectory';
import { AdminTriage } from './components/AdminTriage';
import { OperationsDashboard } from './components/OperationsDashboard';
import { BarangayOfficialPortal } from './components/BarangayOfficialPortal';
import { ReportModal } from './components/ReportModal';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { UnifiedAuthPortal } from './components/UnifiedAuthPortal';
import { OfflineSyncCenter } from './components/OfflineSyncCenter';
import { LdrrmcUsersManagementView } from './components/LdrrmcUsersManagementView';
import { LdrrmcAuditLogView } from './components/LdrrmcAuditLogView';
import { ResidentReliefView, ResidentGuidesView, ResidentFaqsView } from './components/ResidentContentTabs';
import { LdrrmcReliefView } from './components/LdrrmcReliefView';
import { LdrrmcRoadWorkView } from './components/LdrrmcRoadWorkView';
import { LdrrmcGuidesView } from './components/LdrrmcGuidesView';
import { LdrrmcFaqsView } from './components/LdrrmcFaqsView';
import { LdrrmcSosLogView } from './components/LdrrmcSosLogView';
import { LdrrmcHotlinesView } from './components/LdrrmcHotlinesView';
import { LdrrmcAnalyticsView } from './components/LdrrmcAnalyticsView';
import { LdrrmcOthersReviewView } from './components/LdrrmcOthersReviewView';
import { ResidentNotificationsView } from './components/ResidentNotificationsView';
import { LdrrmcNotificationsView } from './components/LdrrmcNotificationsView';
import { ResidentHomeDraftView } from './components/ResidentHomeDraftView';

// The emergency alerts already acknowledged on this device, so a refresh does
// not re-fire the same one.
const ACKED_KEY = 'uniguard.urgent.acked';
function ackedAlertIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ACKED_KEY) || '[]');
  } catch {
    return [];
  }
}
function markAlertAcked(id: string) {
  const ids = ackedAlertIds();
  if (ids.includes(id)) return;
  try {
    localStorage.setItem(ACKED_KEY, JSON.stringify(ids.concat(id).slice(-60)));
  } catch {}
}

export default function App() {
  // Session and data come from the Supabase-backed store
  const data = useRepo();
  const currentUser = data.user;
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [recovery, setRecovery] = useState<boolean>(false);
  const isAuthenticated = !!currentUser && !recovery;
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [topView, setTopView] = useState<'Overview' | 'Trends' | 'Analytics'>('Overview');
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  const isOnline = data.online && data.source !== 'offline';
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [isAlertNotificationOpen, setIsAlertNotificationOpen] = useState<boolean>(false);
  const [notificationAdvisory, setNotificationAdvisory] = useState<Advisory | null>(null);

  // Drill Down Modal State
  const [drillDownState, setDrillDownState] = useState<{
    isOpen: boolean;
    filterType: string;
    filterValue: string;
  }>({
    isOpen: false,
    filterType: 'all',
    filterValue: 'all',
  });

  const [selectedIncidentForMap, setSelectedIncidentForMap] = useState<IncidentReport | null>(null);
  const [selectedAdvisoryId, setSelectedAdvisoryId] = useState<string | null>(null);

  // Core Data State
  const { barangays, reports, advisories, hotlines } = data;
  const evacuationCenters = data.centers;
  const outbox = data.queue;

  const refreshData = () => {
    repo.loadAll();
  };

  // Restore a persisted session once, and start the connectivity / offline queue wiring
  useEffect(() => {
    repo.start();
    auth
      .restore(() => setRecovery(true))
      .catch(() => null)
      .finally(() => setAuthReady(true));
  }, []);

  // Load everything for the signed in account, then send anything queued offline
  const userId = currentUser?.id;
  useEffect(() => {
    if (!userId) return;
    repo.loadAll().then(() => repo.flushQueue());
  }, [userId]);

  // Emergency Alert Notification Popup: fires only for an emergency-severity
  // advisory that has not been acknowledged on this device yet
  useEffect(() => {
    if (!isAuthenticated) {
      setIsAlertNotificationOpen(false);
      return;
    }
    const emergency = advisories.find((a) => a.severity === 'critical' && !ackedAlertIds().includes(a.id));
    if (emergency && emergency.id !== notificationAdvisory?.id) {
      setNotificationAdvisory(emergency);
      const timer = setTimeout(() => {
        setIsAlertNotificationOpen(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, advisories]);

  const handleLoginSuccess = (_user: User) => {
    setActiveTab('overview');
    setTopView('Overview');
  };

  const handleSignOut = () => {
    auth.signOut();
  };

  const handleAcknowledgeAlert = () => {
    if (notificationAdvisory) {
      markAlertAcked(notificationAdvisory.id);
      repo.acknowledgeAlert(notificationAdvisory.id);
    }
    setIsAlertNotificationOpen(false);
  };

  // Open drill-down modal helper
  const handleOpenDrillDown = (filterType: string, filterValue: string) => {
    setDrillDownState({
      isOpen: true,
      filterType,
      filterValue,
    });
  };

  // Filtered reports by selected barangay if applicable
  const displayedReports = useMemo(() => {
    if (selectedBarangay === 'all') return reports;
    return reports.filter((r) => r.barangay_id === selectedBarangay);
  }, [reports, selectedBarangay]);

  // Filtered evacuation centers by selected barangay if applicable
  const displayedShelters = useMemo(() => {
    if (selectedBarangay === 'all') return evacuationCenters;
    return evacuationCenters.filter((c) => c.barangay_id === selectedBarangay);
  }, [evacuationCenters, selectedBarangay]);

  // GATEWAY LOGIN PORTAL (Phase 1 Gateway Screen - "dont change anything from the portal")
  if (!authReady) {
    return <div className="h-screen h-[100dvh] w-full bg-gradient-to-br from-[#FAF0F2] via-[#F5E6E9] to-[#EEDCE2]" />;
  }
  if (!currentUser || recovery) {
    return (
      <UnifiedAuthPortal
        onLoginSuccess={handleLoginSuccess}
        recovery={recovery}
        onRecoveryDone={() => setRecovery(false)}
      />
    );
  }

  // Others Review, Users and the Audit Log are LGU-only on the server
  const isLgu = currentUser.role === 'lgu_admin';

  return (
    <div className={`h-screen h-[100dvh] w-full overflow-hidden p-0 sm:p-2 md:p-3 lg:p-4 flex flex-col items-center justify-center font-sans antialiased ${
      currentUser.role === 'citizen'
        ? 'bg-[#f0f2f7] text-slate-800 selection:bg-[#991B1B] selection:text-white'
        : currentUser.role === 'barangay'
        ? 'bg-gradient-to-br from-[#052659] via-[#031c42] to-[#011025] text-[#011025] selection:bg-[#052659] selection:text-white'
        : 'bg-gradient-to-br from-[#9aa8b7] via-[#8e9da9] to-[#82909c] text-neutral-800 selection:bg-[#18181b] selection:text-white'
    }`}>
      {/* Primary Surface Frame: Fixed-screen viewport shell housing sidebar and workspace */}
      <div className={`rounded-none sm:rounded-2xl lg:rounded-[32px] flex flex-col ${
        currentUser.role === 'citizen' ? 'lg:flex-row' : ''
      } w-full max-w-[1680px] h-full overflow-hidden border-0 sm:border relative transition-all ${
        currentUser.role === 'citizen'
          ? 'bg-[#FFF5F5] shadow-[0_12px_40px_rgba(0,0,0,0.06)] border-neutral-100'
          : currentUser.role === 'barangay'
          ? 'bg-gradient-to-br from-[#f8fbff] via-[#f1f6fc] to-[#e4eef9] shadow-[0_20px_60px_-15px_rgba(1,16,37,0.12)] border-[#C2E8FF]/80'
          : 'bg-gradient-to-br from-[#f8fafc] via-[#f1f6fb] to-[#e6eff8] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08)] border-white/80'
      }`}>
        {/* Desktop Navigation - Vertical Sidebar for Resident, Horizontal Top Bar for LDRRMO & Barangay */}
        {currentUser.role === 'citizen' ? (
          <div className="hidden lg:flex shrink-0 h-full overflow-hidden">
            <DashboardSidebar
              activeTab={activeTab}
              setActiveTab={(tab) => {
                setActiveTab(tab);
                if (tab === 'overview') setTopView('Overview');
              }}
              currentUser={currentUser}
              isOnline={isOnline}
              pendingOutboxCount={outbox.length}
              onSignOut={handleSignOut}
              onOpenReportModal={() => setIsReportModalOpen(true)}
            />
          </div>
        ) : (
          <div className="w-full shrink-0 z-30">
            <DashboardSidebar
              activeTab={activeTab}
              setActiveTab={(tab) => {
                setActiveTab(tab);
                if (tab === 'overview') setTopView('Overview');
              }}
              currentUser={currentUser}
              isOnline={isOnline}
              pendingOutboxCount={outbox.length}
              onSignOut={handleSignOut}
              onOpenReportModal={() => setIsReportModalOpen(true)}
            />
          </div>
        )}

        {/* Mobile Slide-Out Drawer Navigation Sidebar */}
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            {/* Sidebar drawer content */}
            <div className="relative w-72 max-w-[85vw] h-full flex flex-col z-10 animate-in slide-in-from-left duration-250">
              <DashboardSidebar
                activeTab={activeTab}
                setActiveTab={(tab) => {
                  setActiveTab(tab);
                  setIsMobileSidebarOpen(false);
                  if (tab === 'overview') setTopView('Overview');
                }}
                currentUser={currentUser}
                  isOnline={isOnline}
                  pendingOutboxCount={outbox.length}
                onSignOut={handleSignOut}
                onOpenReportModal={() => {
                  setIsMobileSidebarOpen(false);
                  setIsReportModalOpen(true);
                }}
                />
            </div>
          </div>
        )}

        {/* Main Content Workspace - Fixed Non-Scrolling Flex Container */}
        <div className={`flex-1 min-w-0 flex flex-col h-full overflow-hidden w-full transition-all duration-300 ${
          currentUser.role === 'citizen' ? 'bg-white' : 'bg-transparent'
        }`}>
          {/* Fixed Non-Scrolling Top Header & Banners */}
          <div className={`shrink-0 z-20 w-full flex flex-col ${
            currentUser.role === 'citizen' ? 'bg-white' : 'bg-transparent'
          }`}>
            {currentUser.role === 'citizen' && (
              <DashboardHeader
                activeTab={activeTab}
                topView={topView}
                setTopView={(view) => {
                  setTopView(view);
                  setActiveTab('overview');
                }}
                selectedBarangay={selectedBarangay}
                setSelectedBarangay={setSelectedBarangay}
                barangays={barangays}
                onOpenReportModal={() => setIsReportModalOpen(true)}
                onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
                isOnline={isOnline}
                totalActiveHazards={displayedReports.filter((r) => r.status !== 'resolved').length}
                currentUser={currentUser}
                onSignOut={handleSignOut}
                  setActiveTab={setActiveTab}
              />
            )}

            {/* Offline Sync Buffer Banner */}
            <OfflineSyncBanner
              isOnline={isOnline}
              pendingCount={outbox.length}
              onSyncCompleted={refreshData}
              onOpenOfflineCenter={() => setActiveTab('offline_sync')}
            />
          </div>

          {/* Isolated Scrollable Dashboard Content Area */}
          <div className={`flex-1 min-h-0 overflow-y-auto w-full flex flex-col ${
            currentUser.role === 'citizen'
              ? 'bg-[#FFF5F5]/40'
              : currentUser.role === 'barangay'
              ? 'bg-gradient-to-br from-[#f8fbff] via-[#f1f6fc] to-[#e4eef9]'
              : 'bg-gradient-to-br from-[#f8fafc] via-[#f1f6fb] to-[#e6eff8]'
          }`}>
            {/* Workspace Body Content */}
            <main className="flex-1 px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 space-y-5 sm:space-y-8 w-full max-w-full">
            {/* View 1: Main Dashboard (when activeTab is 'overview' or 'home') */}
            {(activeTab === 'overview' || activeTab === 'home') && (
              <>
                {currentUser.role === 'citizen' ? (
                  <ResidentHomeDraftView
                    currentUser={currentUser}
                    reports={displayedReports}
                    barangays={barangays}
                    evacuationCenters={displayedShelters}
                    advisories={advisories}
                    selectedBarangay={selectedBarangay}
                    onOpenReportModal={() => setIsReportModalOpen(true)}
                    onSelectIncidentForMap={(rep) => setSelectedIncidentForMap(rep)}
                    selectedIncidentForMap={selectedIncidentForMap}
                    setActiveTab={setActiveTab}
                    isOnline={isOnline}
                  />
                ) : currentUser.role === 'barangay' ? (
                  <BarangayOfficialPortal
                    reports={reports}
                    barangays={barangays}
                    evacuationCenters={evacuationCenters}
                    advisories={advisories}
                    currentUser={currentUser}
                    onSelectReport={(rep) => setSelectedIncidentForMap(rep)}
                    onOpenReportModal={() => setIsReportModalOpen(true)}
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onNavigateView={(view) => setTopView(view)}
                    onDataChanged={refreshData}
                  />
                ) : (
                  <>
                    {topView === 'Overview' && (
                      <OperationsDashboard
                        reports={displayedReports}
                        barangays={barangays}
                        evacuationCenters={displayedShelters}
                        advisories={advisories}
                        currentUser={currentUser}
                        onSelectReport={(rep) => setSelectedIncidentForMap(rep)}
                        onOpenReportModal={() => setIsReportModalOpen(true)}
                        onNavigateTab={(tab) => setActiveTab(tab)}
                        onNavigateView={(view) => setTopView(view)}
                        onDataChanged={refreshData}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {/* View 2: Dedicated Hazard Intelligence & Triage */}
            {activeTab === 'incidents' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <AdminTriage
                  reports={currentUser.role === 'barangay' ? reports.filter(r => r.barangay_id === currentUser.barangay_id) : reports}
                  barangays={barangays}
                  currentUser={currentUser}
                  onReportsUpdated={refreshData}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                  onSelectReport={(rep) => {
                    setSelectedIncidentForMap(rep);
                    setActiveTab('overview');
                  }}
                />
              </div>
            )}

            {/* View 3: Early Warning Advisories */}
            {activeTab === 'advisories' && (
              <div className="animate-in fade-in duration-200">
                <AdvisoryCenter
                  advisories={currentUser.role === 'barangay' ? advisories.filter(a => !a.target_barangay_id || a.target_barangay_id === currentUser.barangay_id) : advisories}
                  currentUser={currentUser}
                  barangays={barangays}
                  onAdvisoryPublished={refreshData}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                  selectedAdvisoryId={selectedAdvisoryId}
                  onClearSelectedAdvisory={() => setSelectedAdvisoryId(null)}
                />
              </div>
            )}

            {/* View 4: Evacuation Centers */}
            {activeTab === 'shelters' && (
              <div className="animate-in fade-in duration-200">
                <EvacuationDirectory
                  evacuationCenters={evacuationCenters}
                  currentUser={currentUser}
                  barangays={barangays}
                  isOnline={isOnline}
                  onSelectOnMap={
                    currentUser.role === 'citizen'
                      ? undefined
                      : () => {
                          setActiveTab('overview');
                        }
                  }
                />
              </div>
            )}

            {/* View 5: Emergency Hotlines */}
            {activeTab === 'hotlines' && (
              <div className="animate-in fade-in duration-200">
                {currentUser.role === 'citizen' ? (
                  <HotlineDirectory
                    hotlines={hotlines}
                    barangays={barangays}
                    isOnline={isOnline}
                  />
                ) : (
                  <LdrrmcHotlinesView
                    hotlines={hotlines}
                    currentUser={currentUser}
                    onHotlinesUpdated={refreshData}
                  />
                )}
              </div>
            )}

            {/* View: Notifications */}
            {activeTab === 'notifications' && (
              currentUser.role === 'citizen' ? (
                <ResidentNotificationsView
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              ) : (
                <LdrrmcNotificationsView
                  onNavigateTab={(tab) => setActiveTab(tab)}
                  currentUser={currentUser}
                />
              )
            )}

            {/* View: Relief Goods & Distribution */}
            {activeTab === 'relief' && (
              currentUser.role === 'citizen' ? (
                <ResidentReliefView barangays={barangays} currentUser={currentUser} />
              ) : (
                <LdrrmcReliefView barangays={barangays} currentUser={currentUser} />
              )
            )}

            {/* View: Emergency Preparedness Guides */}
            {activeTab === 'guides' && (
              currentUser.role === 'citizen' ? (
                <ResidentGuidesView />
              ) : (
                <LdrrmcGuidesView currentUser={currentUser} />
              )
            )}

            {/* View: Community FAQs */}
            {activeTab === 'faqs' && (
              currentUser.role === 'citizen' ? (
                <ResidentFaqsView />
              ) : (
                <LdrrmcFaqsView currentUser={currentUser} />
              )
            )}

            {/* View 6: Offline Sync Center */}
            {activeTab === 'offline_sync' && (
              <div className="animate-in fade-in duration-200">
                <OfflineSyncCenter
                  isOnline={isOnline}
                      pendingOutboxCount={outbox.length}
                  hotlines={hotlines}
                  evacuationCenters={evacuationCenters}
                  advisories={advisories}
                  currentUser={currentUser}
                  onSyncCompleted={refreshData}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              </div>
            )}

            {/* View 7: Users & Personnel Directory */}
            {activeTab === 'users' && isLgu && (
              <LdrrmcUsersManagementView currentUser={currentUser} barangays={barangays} />
            )}

            {/* View 8: Audit Log Trail */}
            {activeTab === 'audit_log' && isLgu && (
              <LdrrmcAuditLogView currentUser={currentUser} />
            )}

            {/* View 9: Analytics Full View */}
            {activeTab === 'analytics' && (
              <div className="animate-in fade-in duration-200">
                <LdrrmcAnalyticsView
                  reports={currentUser.role === 'barangay' ? reports.filter(r => r.barangay_id === currentUser.barangay_id) : displayedReports}
                  barangays={barangays}
                  evacuationCenters={currentUser.role === 'barangay' ? evacuationCenters.filter(c => c.barangay_id === currentUser.barangay_id) : displayedShelters}
                  advisories={currentUser.role === 'barangay' ? advisories.filter(a => !a.target_barangay_id || a.target_barangay_id === currentUser.barangay_id) : advisories}
                  currentUser={currentUser}
                  onOpenDrillDown={handleOpenDrillDown}
                />
              </div>
            )}

            {/* View 10: Road Work & Infrastructure Obstructions */}
            {activeTab === 'road_work' && (
              <LdrrmcRoadWorkView
                barangays={barangays}
                currentUser={currentUser}
                onNavigateTab={setActiveTab}
                onSelectOnMap={(post) => {
                  setSelectedIncidentForMap(null);
                  setActiveTab('overview');
                }}
              />
            )}

            {/* View 11: SOS Log & Emergency Rescue Dispatch */}
            {activeTab === 'sos_log' && (
              <LdrrmcSosLogView
                currentUser={currentUser}
                onNavigateTab={setActiveTab}
                onSelectOnMap={(coords) => {
                  setSelectedIncidentForMap(null);
                  setActiveTab('overview');
                }}
              />
            )}

            {/* View 12: "Others" Hazard Review */}
            {activeTab === 'others_review' && isLgu && (
              <LdrrmcOthersReviewView
                reports={reports}
                barangays={barangays}
                currentUser={currentUser}
                onUpdateReportStatus={(id, status) => repo.advanceStatus(id, status)}
                onSelectOnMap={(coords) => {
                  setSelectedIncidentForMap(null);
                  setActiveTab('overview');
                }}
                onNavigateTab={setActiveTab}
              />
            )}
          </main>

          {/* Refined Civic Workspace Footer (Staff only) */}
          {currentUser.role !== 'citizen' && (
            <footer className={`mt-auto shrink-0 py-4 px-6 sm:px-8 text-xs flex flex-col sm:flex-row items-center justify-between gap-3 bg-white ${
              currentUser.role === 'barangay'
                ? 'border-t border-[#7EA0C5]/30 text-[#5482B4]'
                : 'border-t border-slate-100 text-slate-500'
            }`}>
              <div className="flex flex-wrap items-center justify-center sm:justify-start text-center sm:text-left gap-x-2 gap-y-0.5">
                <span className={`font-bold ${currentUser.role === 'barangay' ? 'text-[#011025]' : 'text-slate-800'}`}>
                  {currentUser.role === 'barangay'
                    ? `UniGuard BDRRMC • Brgy. ${(currentUser.barangay_name || '').toUpperCase()}`
                    : 'UniGuard MDRRMO'}
                </span>
                <span>&bull;</span>
                <span className={`text-[11px] ${currentUser.role === 'barangay' ? 'text-[#7EA0C5]' : 'text-slate-500'}`}>
                  {currentUser.role === 'barangay'
                    ? 'Barangay Incident Command Post • Municipality of Lingayen'
                    : 'Municipality of Lingayen MDRRMO Operations Hub'}
                </span>
              </div>
              <div className={`flex items-center gap-3 text-[11px] ${currentUser.role === 'barangay' ? 'text-[#7EA0C5]' : 'text-slate-400'}`}>
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>PWA Offline-Ready</span>
                </span>
                <span>&bull;</span>
                <span>Municipality of Lingayen</span>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>

      {/* Drill-Down Inspection Modal */}
      <DrillDownModal
        isOpen={drillDownState.isOpen}
        onClose={() => setDrillDownState({ ...drillDownState, isOpen: false })}
        filterType={drillDownState.filterType}
        filterValue={drillDownState.filterValue}
        reports={reports}
        barangays={barangays}
        onReportUpdated={refreshData}
      />

      {/* Ground Report Submission Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        currentUser={currentUser}
        barangays={barangays}
        isOnline={isOnline}
        onReportSubmitted={refreshData}
      />

      {/* Emergency Alert Notification Modal on App Open */}
      <EmergencyAlertNotificationModal
        isOpen={isAlertNotificationOpen}
        onClose={() => setIsAlertNotificationOpen(false)}
        onAcknowledge={handleAcknowledgeAlert}
        advisory={notificationAdvisory}
      />

      {/* PWA In-App Install Prompt Banner */}
      <PWAInstallPrompt />
    </div>
  );
}
