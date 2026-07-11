import './index.css';
import { useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { I18nProvider } from '@expert/i18n';
import { Sidebar } from '@expert/components/layout/Sidebar';
import { TopBar } from '@expert/components/layout/TopBar';
import { ToastHost } from '@expert/components/shared/ui-kit';
import LoginPage from '@expert/pages/auth/LoginPage';
import AssignmentsPage from '@expert/pages/assignments/AssignmentsPage';
import GradeSessionPage from '@expert/pages/grading/GradeSessionPage';
import MyResultsPage from '@expert/pages/results/MyResultsPage';
import DeadlinesPage from '@expert/pages/deadlines/DeadlinesPage';
import EligibilityPage from '@expert/pages/eligibility/EligibilityPage';
import RulesPage from '@expert/pages/rules/RulesPage';
import { ForcePasswordChangeModal } from '@expert/components/shared/ForcePasswordChangeModal';
import { clearExpertSession, getStoredExpertUser, isExpertSessionValid } from '@expert/utils/auth';
import type { CertType } from '@expert/services/api';
import { expertApi } from '@expert/services/api';

function RequireExpert({ children }: { children: React.ReactElement }) {
  if (isExpertSessionValid()) return children;
  clearExpertSession();
  return <Navigate to="/login" replace />;
}

const NAV_TO_PATH: Record<string, string> = {
  assignments: '/',
  eligibility: '/eligibility',
  deadlines: '/deadlines',
  results: '/results',
  rules: '/rules',
};

function activeIdFromPath(pathname: string): string {
  if (pathname.startsWith('/sessions')) return 'assignments';
  if (pathname.startsWith('/eligibility')) return 'eligibility';
  if (pathname.startsWith('/deadlines')) return 'deadlines';
  if (pathname.startsWith('/results')) return 'results';
  if (pathname.startsWith('/rules')) return 'rules';
  return 'assignments';
}

function ExpertShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [competencies, setCompetencies] = useState<CertType[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [eligibilityPendingCount, setEligibilityPendingCount] = useState(0);

  const activeId = activeIdFromPath(location.pathname);

  const refreshEligibilityPending = useCallback(() => {
    expertApi
      .getEligibilityCounts()
      .then((r) => setEligibilityPendingCount(r.data.pending))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshEligibilityPending();
    const id = window.setInterval(refreshEligibilityPending, 30_000);
    return () => window.clearInterval(id);
  }, [refreshEligibilityPending]);

  const handleLogout = () => {
    clearExpertSession();
    window.location.href = '/axis_expert/login';
  };

  const handleNavigate = (id: string) => {
    const path = NAV_TO_PATH[id] ?? '/';
    navigate(path);
  };

  const onCompetenciesChanged = useCallback((cts: CertType[]) => {
    setCompetencies((prev) =>
      prev.length === cts.length && prev.every((c, i) => c === cts[i]) ? prev : cts,
    );
  }, []);

  const onOverdueChanged = useCallback((n: number) => {
    setOverdueCount(n);
  }, []);

  // Admin reset the password to the temp value — block the portal until the
  // expert sets a real one. Survives reloads because the flag is stored with
  // the login user in localStorage.
  const mustChangePassword = getStoredExpertUser()?.mustChangePassword === true;

  return (
    <div className="h-screen w-full flex bg-[var(--gray-light)] text-[var(--gray-700)] overflow-hidden border-none">
      {mustChangePassword && <ForcePasswordChangeModal />}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          competencies={competencies}
          onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        />
        <div className="flex flex-1 min-h-0">
          <Sidebar
            activeId={activeId}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
            isPanelOpen={isSidebarOpen}
            overdueCount={overdueCount}
            eligibilityPendingCount={eligibilityPendingCount}
          />
          <main className="flex-1 min-w-0 overflow-y-auto bg-white">
            <div
              className={[
                'mx-auto py-8 w-full transition-[max-width,padding] duration-300 ease-out',
                isSidebarOpen
                  ? 'max-w-[1400px] 2xl:max-w-[1520px] px-8'
                  : 'max-w-[1560px] 2xl:max-w-[1680px] px-12',
              ].join(' ')}
            >
              <Routes>
                <Route
                  index
                  element={
                    <AssignmentsPage
                      onCompetenciesChanged={onCompetenciesChanged}
                      onOverdueChanged={onOverdueChanged}
                    />
                  }
                />
                <Route path="sessions/:sessionId" element={<GradeSessionPage />} />
                <Route path="eligibility" element={<EligibilityPage onPendingChanged={refreshEligibilityPending} />} />
                <Route path="results" element={<MyResultsPage />} />
                <Route path="deadlines" element={<DeadlinesPage />} />
                <Route path="rules" element={<RulesPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter basename="/axis_expert">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <RequireExpert>
                <ExpertShell />
              </RequireExpert>
            }
          />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
