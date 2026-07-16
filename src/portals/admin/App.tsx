import './index.css';
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { I18nProvider, useI18n } from '@admin/i18n';
import { Sidebar } from '@admin/components/layout/Sidebar';
import { TopBar } from '@admin/components/layout/TopBar';
import { ToastHost } from '@admin/components/shared/ui-kit';
import LoginPage from '@admin/pages/auth/LoginPage';
import { DashboardScreen } from '@admin/pages/dashboard/DashboardPage';
import MonitoringPage from '@admin/pages/examinees/MonitoringPage';
import SchedulePage from '@admin/pages/exam/SchedulePage';
import GradingPage from '@admin/pages/grading/GradingPage';
import StatsPage from '@admin/pages/analytics/StatsPage';
import PlaceholderPage from '@admin/pages/shared/PlaceholderPage';
import QuestionBankPage from '@admin/pages/exam/QuestionBankPage';
import InquiryPage from '@admin/pages/content/InquiryPage';
import ExamineesScreen from '@admin/pages/examinees/ExamineesPage';
import RegistrationsPage from '@admin/pages/registrations/RegistrationsPage';
import RefundRequestsPage from '@admin/pages/registrations/RefundRequestsPage';
import ResultsPage from '@admin/pages/grading/ResultsPage';
import ExpertsPage from '@admin/pages/grading/ExpertsPage';
import EligibilityPage from '@admin/pages/grading/EligibilityPage';
import EligibilityRefundsPage from '@admin/pages/grading/EligibilityRefundsPage';
import NoticesPage from '@admin/pages/content/NoticesPage';
import FaqPage from '@admin/pages/content/FaqPage';
import MembersPage from '@admin/pages/members/MembersPage';
import NotificationSettingsPage from '@admin/pages/settings/NotificationSettingsPage';
import { adminApi, LiveSummary } from '@admin/services/api';
import { disconnectAdminSocket, getAdminSocket } from '@admin/services/adminSocket';
import { clearAdminSession, getStoredAdminUser, isAdminSessionValid } from '@admin/utils/auth';
import { SessionSupersededModalHost } from '@admin/components/SessionSupersededModalHost';
import { ForcePasswordChangeModal } from '@admin/components/ForcePasswordChangeModal';
import { adminPageIdFromPath, adminPathForPage } from '@admin/adminRoutes';

function RequireAuth({ children }: { children: React.ReactElement }) {
  if (isAdminSessionValid()) return children;
  clearAdminSession();
  return <Navigate to="/login" replace />;
}

function AdminShell() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const activeId = adminPageIdFromPath(location.pathname);
  const [live, setLive] = useState<LiveSummary | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getMonitorSummary()
      .then((res) => !cancelled && setLive(res.data))
      .catch(() => undefined);

    const sock = getAdminSocket();
    const onLive = (p: LiveSummary) => setLive(p);
    sock.on('exam:live-status', onLive);
    return () => {
      cancelled = true;
      sock.off('exam:live-status', onLive);
    };
  }, []);

  const handleLogout = () => {
    disconnectAdminSocket();
    clearAdminSession();
    window.location.href = '/axis_manager/login';
  };

  const examInProgress = live?.inProgress ?? false;
  const examInfo = {
    name: live?.examName ?? '',
    takers: live?.takers ?? 0,
    warnings: live?.warnings ?? 0,
  };

  const handleNavigate = (id: string) => {
    navigate(adminPathForPage(id));
    setIsSidebarOpen(true);
  };

  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  const handleRailSelect = (id: string, isActiveGroup: boolean) => {
    if (isActiveGroup) {
      setIsSidebarOpen((prev) => !prev);
      return;
    }

    handleNavigate(id);
  };

  const renderContent = () => {
    switch (activeId) {
      case 'dashboard':
        return (
          <DashboardScreen
            onJumpToMonitoring={() => handleNavigate('monitoring')}
            onJumpToStats={() => handleNavigate('stats')}
            onJumpToSchedule={() => handleNavigate('schedule')}
          />
        );
      case 'monitoring':
        return <MonitoringPage />;
      case 'schedule':
        return <SchedulePage />;
      case 'grading':
        return <GradingPage />;
      case 'stats':
        return <StatsPage />;
      case 'notification-settings':
        return <NotificationSettingsPage />;
      case 'question-bank':
        return <QuestionBankPage />;
      case 'qna':
        return <InquiryPage />;
      case 'examinee':
        return <ExamineesScreen />;
      case 'members':
        return <MembersPage />;
      case 'registrations':
        return <RegistrationsPage />;
      case 'results':
        return <ResultsPage />;
      case 'experts':
        return <ExpertsPage />;
      case 'eligibility':
        return <EligibilityPage />;
      case 'eligibility-refunds':
        return <EligibilityRefundsPage />;
      case 'refund-requests':
        return <RefundRequestsPage />;
      case 'notices':
        return <NoticesPage />;
      case 'faq':
        return <FaqPage />;
      default:
        return <PlaceholderPage title={activeId} subtitle={t('ph.body')} />;
    }
  };

  return (
    <div className="h-screen w-full flex bg-[var(--gray-light)] text-[var(--gray-700)] overflow-hidden border-none">
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeId={activeId}
          examInProgress={examInProgress}
          examInfo={examInfo}
          onJumpToMonitoring={() => handleNavigate('monitoring')}
          onToggleSidebar={handleToggleSidebar}
          onNavigate={handleNavigate}
        />
        <div className="flex flex-1 min-h-0">
          <Sidebar
            activeId={activeId}
            onNavigate={handleNavigate}
            onRailSelect={handleRailSelect}
            onLogout={handleLogout}
            examInProgress={examInProgress}
            isPanelOpen={isSidebarOpen}
          />
          <main className="flex-1 min-w-0 overflow-y-auto bg-white">
            <div
              className={[
                'mx-auto py-8 w-full transition-[max-width,padding] duration-300 ease-out ',
                isSidebarOpen
                  ? 'max-w-[1520px] 2xl:max-w-[1600px] px-8'
                  : 'max-w-[1680px] 2xl:max-w-[1760px] px-12',
              ].join(' ')}
            >
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
      <ToastHost />
      {getStoredAdminUser()?.mustChangePassword === true && <ForcePasswordChangeModal />}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter basename="/axis_manager">
        <SessionSupersededModalHost />
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AdminShell />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
