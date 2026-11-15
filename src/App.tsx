import { useCallback, useEffect, useState } from 'react';
import {
  Inbox,
  LayoutDashboard,
  LogOut,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { GeneratorView } from './components/GeneratorView';
import { InboxView } from './components/InboxView';
import { ToastContainer } from './components/ToastContainer';
import { WalletView } from './components/WalletView';
import { useRealtime } from './hooks/useRealtime';
import { apiRequest, formatIDR, getStoredToken, setStoredToken } from './lib/api';
import type { DashboardStats, Rental, ToastMessage, User } from './types';

type NavTab = 'dashboard' | 'generator' | 'inbox' | 'wallet' | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [selectedRentalId, setSelectedRentalId] = useState<string | null>(null);
  const [incomingPushCount, setIncomingPushCount] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((type: 'success' | 'error' | 'info', title: string, message?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingWorkspace(true);
    try {
      const [statsRes, rentalsRes] = await Promise.all([
        apiRequest<DashboardStats>('/api/dashboard/stats'),
        apiRequest<{ rentals: Rental[] }>('/api/rentals'),
      ]);
      setStats(statsRes);
      setRentals(rentalsRes.rentals);
    } catch {
      // Errors handled silently on background refresh
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  // Verify existing session on load
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiRequest<{ user: User }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user?.id, loadWorkspaceData]);

  // 1-second live countdown clock when user has active rentals
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { connected: wsConnected } = useRealtime(Boolean(user), {
    onSmsReceived: (payload) => {
      setIncomingPushCount((c) => c + 1);
      const sender = typeof payload.sender === 'string' ? payload.sender : 'SMS Masuk';
      const otp = typeof payload.otpCode === 'string' ? `Kode: ${payload.otpCode}` : undefined;
      notify('success', `OTP diterima dari ${sender}`, otp);
    },
    onRentalExpired: (payload) => {
      loadWorkspaceData();
      const phone = typeof payload.phoneNumber === 'string' ? payload.phoneNumber : '';
      notify('info', 'Masa sewa berakhir', `${phone} kini berstatus Expired dan OTP telah dihapus.`);
    },
    onBalanceUpdated: (payload) => {
      setUser((prev) => (prev ? { ...prev, balance: payload.balance } : prev));
    },
    onStatsUpdated: () => {
      loadWorkspaceData();
    },
  });

  const handleAuthSuccess = (token: string, loggedInUser: User) => {
    setStoredToken(token);
    setUser(loggedInUser);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    setStoredToken(null);
    setUser(null);
    setStats(null);
    setRentals([]);
    setSelectedRentalId(null);
    notify('info', 'Anda telah keluar dari akun');
  };

  const handleReleaseRental = async (rentalId: string) => {
    try {
      await apiRequest(`/api/rentals/${rentalId}/release`, { method: 'POST' });
      notify('info', 'Sewa dihentikan', 'Nomor telah dinonaktifkan dan data OTP dihapus.');
      await loadWorkspaceData();
    } catch (err) {
      notify('error', 'Gagal mengakhiri sewa', err instanceof Error ? err.message : undefined);
    }
  };

  const handleCopyNumber = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      notify('success', 'Nomor disalin', phone);
    } catch {
      notify('error', 'Gagal menyalin nomor');
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#060B18] flex flex-col items-center justify-center gap-3 text-slate-300">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600 to-sky-500 flex items-center justify-center animate-pulse">
          <PhoneCall className="w-5 h-5 text-white" />
        </div>
        <p className="text-xs font-medium text-slate-400">Memuat workspace BEAUTY NUMBER...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <AuthScreen onSuccess={handleAuthSuccess} onNotify={notify} />
      </>
    );
  }

  const activeRentalCount = rentals.filter((r) => r.status === 'Active').length;
  const navItems: Array<{ id: NavTab; label: string; shortLabel: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', shortLabel: 'Beranda', icon: LayoutDashboard },
    { id: 'generator', label: 'Generate Number', shortLabel: 'Generator', icon: Sparkles },
    { id: 'inbox', label: 'Kotak Masuk OTP', shortLabel: 'OTP', icon: Inbox },
    { id: 'wallet', label: 'Dompet & Profil', shortLabel: 'Dompet', icon: Wallet },
    ...(user.role === 'admin'
      ? [{ id: 'admin' as NavTab, label: 'Admin Console', shortLabel: 'Admin', icon: ShieldCheck }]
      : []),
  ];

  const pageTitle = navItems.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-[#060B18] text-slate-100 flex flex-col md:flex-row">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Desktop Sidebar Navigation */}
      <aside className="hidden md:flex md:flex-col md:w-64 lg:w-72 shrink-0 bg-[#0A1020] border-r border-slate-800/80 min-h-screen sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-slate-800/80 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-sky-500 flex items-center justify-center shrink-0">
            <PhoneCall className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">BEAUTY NUMBER</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Navigasi utama">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-violet-600/20 text-white border border-violet-500/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </span>
                {item.id === 'inbox' && activeRentalCount > 0 && (
                  <span className="font-mono tabular-nums text-xs font-bold text-sky-400">{activeRentalCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div className="p-3.5 rounded-xl bg-[#070C1A] border border-slate-800/80">
            <div className="text-[11px] text-slate-400">Saldo Dompet</div>
            <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-white">
              {formatIDR(user.balance)}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className="mt-2 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            >
              Isi Saldo &rarr;
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{user.name}</div>
              <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors shrink-0"
              aria-label="Keluar dari akun"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Mobile + Desktop) */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 lg:px-8 bg-[#060B18]/90 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="md:hidden w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-sky-500 flex items-center justify-center shrink-0">
              <PhoneCall className="w-4 h-4 text-white" />
            </div>
            <span className="md:hidden text-sm font-bold text-white whitespace-nowrap">BEAUTY NUMBER</span>
            <span className="hidden md:inline text-sm font-semibold text-slate-200 whitespace-nowrap">
              {pageTitle}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0D1528] border border-slate-800 text-xs font-mono tabular-nums font-bold text-sky-300 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              {formatIDR(user.balance)}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className="hidden sm:inline-flex min-h-[38px] px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Number</span>
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 pb-24 md:pb-10 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              rentals={rentals}
              loading={loadingWorkspace}
              nowMs={nowMs}
              onNavigateGenerator={() => setActiveTab('generator')}
              onOpenInbox={(rentalId) => {
                setSelectedRentalId(rentalId);
                setActiveTab('inbox');
              }}
              onReleaseRental={handleReleaseRental}
              onCopyNumber={handleCopyNumber}
            />
          )}

          {activeTab === 'generator' && (
            <GeneratorView
              userBalance={user.balance}
              onRented={(rentalId, newBalance) => {
                setUser((prev) => (prev ? { ...prev, balance: newBalance } : prev));
                setSelectedRentalId(rentalId);
                loadWorkspaceData();
                setActiveTab('inbox');
              }}
              onNotify={notify}
            />
          )}

          {activeTab === 'inbox' && (
            <InboxView
              rentals={rentals}
              selectedRentalId={selectedRentalId}
              onSelectRental={setSelectedRentalId}
              wsConnected={wsConnected}
              nowMs={nowMs}
              incomingPushCount={incomingPushCount}
              onReleaseRental={handleReleaseRental}
              onNavigateGenerator={() => setActiveTab('generator')}
              onNotify={notify}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletView
              user={user}
              onBalanceUpdated={(newBal) => setUser((prev) => (prev ? { ...prev, balance: newBal } : prev))}
              onUserUpdated={(updatedUser) => setUser(updatedUser)}
              onLogout={handleLogout}
              onNotify={notify}
            />
          )}

          {activeTab === 'admin' && user.role === 'admin' && <AdminView onNotify={notify} />}
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A1020]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe"
        aria-label="Navigasi seluler"
      >
        <div
          className={`grid h-[58px] items-center ${
            user.role === 'admin' ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.id === 'inbox' && activeRentalCount > 0 && (
                    <span className="absolute -top-1 -right-2 text-[9px] font-mono font-bold bg-violet-600 text-white px-1 rounded-full leading-tight">
                      {activeRentalCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium tracking-tight whitespace-nowrap">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
