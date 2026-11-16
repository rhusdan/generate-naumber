import { useEffect, useState, type FormEvent } from 'react';
import {
  BarChart3,
  Check,
  Copy,
  KeyRound,
  Link2,
  Plus,
  Receipt,
  Save,
  Server,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { apiRequest, formatDateTime, formatIDR } from '../lib/api';
import type { AdminOverview, AdminProvider, AdminUser, Transaction, VirtualNumber } from '../types';

interface AdminViewProps {
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

type AdminTab = 'overview' | 'providers' | 'numbers' | 'users' | 'transactions';

export function AdminView({ onNotify }: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [numbers, setNumbers] = useState<VirtualNumber[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Provider credential editing map
  const [credInputs, setCredInputs] = useState<Record<string, Record<string, string>>>({});
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; details: string; error?: string }>>({});
  const [copiedWebhookCode, setCopiedWebhookCode] = useState<string | null>(null);

  const handleCopyWebhook = async (providerCode: string) => {
    const url = `${window.location.origin}/api/webhooks/sms/${providerCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWebhookCode(providerCode);
      onNotify('success', 'Webhook URL disalin', url);
      setTimeout(() => setCopiedWebhookCode(null), 2000);
    } catch {
      onNotify('info', 'Salin manual URL webhook', url);
    }
  };

  // New number form
  const [newPhone, setNewPhone] = useState('');
  const [newCountry, setNewCountry] = useState('ID');
  const [newCarrier, setNewCarrier] = useState('Telkomsel');
  const [newPrice10m, setNewPrice10m] = useState(12000);
  const [newPrice30m, setNewPrice30m] = useState(22000);
  const [newPrice1h, setNewPrice1h] = useState(35000);
  const [newPrice24h, setNewPrice24h] = useState(75000);
  const [addingNumber, setAddingNumber] = useState(false);

  // Inline pricing edit
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPrice10m, setEditPrice10m] = useState(0);
  const [editPrice30m, setEditPrice30m] = useState(0);
  const [editPrice1h, setEditPrice1h] = useState(0);
  const [editPrice24h, setEditPrice24h] = useState(0);

  const loadAllAdminData = async () => {
    setLoading(true);
    try {
      const [ov, prov, usr, num, tx] = await Promise.all([
        apiRequest<AdminOverview>('/api/admin/overview'),
        apiRequest<{ providers: AdminProvider[] }>('/api/admin/providers'),
        apiRequest<{ users: AdminUser[] }>('/api/admin/users'),
        apiRequest<{ numbers: VirtualNumber[] }>('/api/admin/numbers'),
        apiRequest<{ transactions: Transaction[] }>('/api/admin/transactions'),
      ]);
      setOverview(ov);
      setProviders(prov.providers);
      setUsers(usr.users);
      setNumbers(num.numbers);
      setTransactions(tx.transactions);
    } catch (err) {
      onNotify('error', 'Gagal memuat panel Admin', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllAdminData();
  }, []);

  const handleSaveProvider = async (prov: AdminProvider, toggleActive?: boolean) => {
    setSavingProviderId(prov.id);
    try {
      const credentials = credInputs[prov.id] || {};
      await apiRequest(`/api/admin/providers/${prov.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          isActive: typeof toggleActive === 'boolean' ? toggleActive : prov.isActive,
          apiBaseUrl: prov.apiBaseUrl,
          credentials,
        }),
      });
      setCredInputs((prev) => ({ ...prev, [prov.id]: {} }));
      onNotify('success', 'Konfigurasi provider disimpan', 'Kredensial dienkripsi AES-256-GCM di server.');
      await loadAllAdminData();
    } catch (err) {
      onNotify('error', 'Gagal menyimpan provider', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingProviderId(null);
    }
  };

  const handleTestProvider = async (prov: AdminProvider) => {
    setTestingProviderId(prov.id);
    try {
      const credentials = credInputs[prov.id] || {};
      const res = await apiRequest<{ ok: boolean; details: string; error?: string }>(
        `/api/admin/providers/${prov.id}/test`,
        {
          method: 'POST',
          body: JSON.stringify({ credentials }),
        }
      );
      setTestResults((prev) => ({ ...prev, [prov.id]: res }));
      if (res.ok) {
        onNotify('success', `${prov.name} terhubung`, res.details);
        await loadAllAdminData();
      } else {
        onNotify('error', `Koneksi ${prov.name} gagal`, res.error);
      }
    } catch (err) {
      onNotify('error', 'Gagal menguji koneksi', err instanceof Error ? err.message : undefined);
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleAddNumber = async (e: FormEvent) => {
    e.preventDefault();
    setAddingNumber(true);
    try {
      await apiRequest('/api/admin/numbers', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber: newPhone,
          countryCode: newCountry,
          carrier: newCarrier,
          price10m: newPrice10m,
          price30m: newPrice30m,
          price1h: newPrice1h,
          price24h: newPrice24h,
        }),
      });
      setNewPhone('');
      onNotify('success', 'Nomor ditambahkan ke katalog DEMO');
      await loadAllAdminData();
    } catch (err) {
      onNotify('error', 'Gagal menambah nomor', err instanceof Error ? err.message : undefined);
    } finally {
      setAddingNumber(false);
    }
  };

  const handleSaveNumberPrice = async (id: string) => {
    try {
      await apiRequest(`/api/admin/numbers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          price10m: editPrice10m,
          price30m: editPrice30m,
          price1h: editPrice1h,
          price24h: editPrice24h,
        }),
      });
      setEditingPriceId(null);
      onNotify('success', 'Harga sewa diperbarui');
      await loadAllAdminData();
    } catch (err) {
      onNotify('error', 'Gagal mengubah harga', err instanceof Error ? err.message : undefined);
    }
  };

  const handleDeleteNumber = async (id: string) => {
    try {
      await apiRequest(`/api/admin/numbers/${id}`, { method: 'DELETE' });
      onNotify('info', 'Nomor dihapus dari katalog');
      await loadAllAdminData();
    } catch (err) {
      onNotify('error', 'Gagal menghapus nomor', err instanceof Error ? err.message : undefined);
    }
  };

  const handleAdjustBalance = async (userId: string, addAmount: number) => {
    try {
      await apiRequest(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ addBalance: addAmount }),
      });
      onNotify('success', 'Saldo pengguna disesuaikan');
      await loadAllAdminData();
    } catch (err) {
      onNotify('error', 'Gagal memperbarui saldo', err instanceof Error ? err.message : undefined);
    }
  };

  const subTabs: Array<{ id: AdminTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'Statistik', icon: BarChart3 },
    { id: 'providers', label: 'Provider & API', icon: Server },
    { id: 'numbers', label: 'Nomor & Harga', icon: Shield },
    { id: 'users', label: 'Pengguna', icon: Users },
    { id: 'transactions', label: 'Transaksi', icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Admin Control Console</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Kelola provider API resmi, kredensial terenkripsi, tarif sewa nomor, pengguna, dan transaksi.
          </p>
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-[#0D1528] border border-slate-800/90 rounded-xl overflow-x-auto">
        {subTabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {loading && !overview ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-[#0D1528] border border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === 'overview' && overview && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5">
                  <div className="text-xs text-slate-400">Total Pengguna</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">{overview.totalUsers}</div>
                </div>
                <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5">
                  <div className="text-xs text-slate-400">Total Pendapatan Sewa</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-sky-400">
                    {formatIDR(overview.totalRevenue)}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5">
                  <div className="text-xs text-slate-400">Inventori Tersedia</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-400">
                    {overview.availableNumbers} / {overview.totalNumbers}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5">
                  <div className="text-xs text-slate-400">Sewa Aktif / Selesai</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                    {overview.activeRentals} / {overview.expiredRentals}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6">
                <h2 className="text-base font-bold text-white mb-4">Distribusi Kategori Nomor Cantik</h2>
                <div className="space-y-3">
                  {overview.categoryBreakdown.map((item) => {
                    const pct = Math.round((item.count / Math.max(1, overview.totalNumbers)) * 100);
                    return (
                      <div key={item.category}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-200 font-medium">{item.category}</span>
                          <span className="font-mono tabular-nums text-slate-400">
                            {item.count} nomor ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-violet-600 to-sky-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'providers' && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-4 sm:p-5 text-xs text-slate-300 flex items-start gap-3">
                <KeyRound className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  API credentials disimpan terenkripsi AES-256-GCM di server dan tidak pernah dikirim kembali ke browser. Anda juga dapat menyetelnya langsung via Environment Variables server (<code className="font-mono text-sky-300">TWILIO_ACCOUNT_SID</code>, <code className="font-mono text-sky-300">TWILIO_AUTH_TOKEN</code>, dll.).
                </span>
              </div>

              {providers.map((prov) => (
                <div key={prov.id} className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{prov.name}</h3>
                        {prov.isDemo ? (
                          <span className="font-mono text-[10px] font-bold text-amber-300 border border-amber-400/35 px-2 py-0.5 rounded">
                            DEMO
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] font-bold text-sky-300 border border-sky-400/35 px-2 py-0.5 rounded">
                            OFFICIAL API
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{prov.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveProvider(prov, !prov.isActive)}
                      className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        prov.isActive
                          ? 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-300'
                          : 'bg-slate-800 border border-slate-700 text-slate-300'
                      }`}
                    >
                      {prov.isActive ? 'Provider Aktif' : 'Nonaktif'}
                    </button>
                  </div>

                  {prov.credentials.length > 0 && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {prov.credentials.map((cred) => (
                        <div key={cred.keyName}>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <label className="font-mono text-slate-300" htmlFor={`${prov.id}-${cred.keyName}`}>
                              {cred.keyName}
                            </label>
                            <span className={cred.configured ? 'text-emerald-400' : 'text-slate-500'}>
                              {cred.configured
                                ? `Tersimpan (${cred.source}: ${cred.maskedPreview})`
                                : 'Belum diatur'}
                            </span>
                          </div>
                          <input
                            id={`${prov.id}-${cred.keyName}`}
                            type={cred.keyName === 'TELNYX_MESSAGING_PROFILE_ID' ? 'text' : 'password'}
                            autoComplete="new-password"
                            placeholder={
                              cred.configured
                                ? 'Masukkan nilai baru untuk mengganti'
                                : cred.keyName === 'TELNYX_API_KEY'
                                  ? 'KEY... (dari API Keys Telnyx)'
                                  : cred.keyName === 'TELNYX_MESSAGING_PROFILE_ID'
                                    ? 'UUID Messaging Profile (opsional tapi disarankan)'
                                    : `Isi ${cred.keyName}`
                            }
                            value={credInputs[prov.id]?.[cred.keyName] || ''}
                            onChange={(e) =>
                              setCredInputs((prev) => ({
                                ...prev,
                                [prov.id]: {
                                  ...(prev[prov.id] || {}),
                                  [cred.keyName]: e.target.value,
                                },
                              }))
                            }
                            className="w-full min-h-[42px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {!prov.isDemo && (
                    <div className="mt-4 space-y-3">
                      <div className="p-3.5 rounded-xl bg-[#070C1A] border border-slate-800/90 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-300 inline-flex items-center gap-1.5">
                            <Link2 className="w-3.5 h-3.5 text-sky-400" />
                            Inbound SMS Webhook URL ({prov.name})
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyWebhook(prov.code)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                          >
                            {copiedWebhookCode === prov.code ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Salin URL</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="font-mono text-[11px] text-sky-300 break-all select-all">
                          {`${window.location.origin}/api/webhooks/sms/${prov.code}`}
                        </div>
                        {prov.code === 'telnyx' && (
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Tempel URL ini di Telnyx Portal → Messaging Profile → <span className="text-slate-200">Inbound Settings → Webhook URL</span>. Pastikan <code className="font-mono text-sky-300">TELNYX_API_KEY</code> diisi API Key (<code className="font-mono">KEY...</code>) dari menu <span className="text-slate-200">Account Settings → Keys & Credentials</span>, sedangkan ID UUID Profile diisi ke <code className="font-mono text-sky-300">TELNYX_MESSAGING_PROFILE_ID</code>.
                          </p>
                        )}
                      </div>
                      {testResults[prov.id] && (
                        <div
                          className={`p-3 rounded-xl border text-xs ${
                            testResults[prov.id].ok
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          }`}
                        >
                          {testResults[prov.id].ok ? testResults[prov.id].details : testResults[prov.id].error}
                        </div>
                      )}
                      <div className="flex flex-wrap justify-end gap-2.5">
                        <button
                          type="button"
                          disabled={testingProviderId === prov.id}
                          onClick={() => handleTestProvider(prov)}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-[#070C1A] hover:bg-slate-800 border border-slate-700 text-sky-300 text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Server className="w-3.5 h-3.5" />
                          <span>{testingProviderId === prov.id ? 'Menguji...' : 'Uji Koneksi API'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={savingProviderId === prov.id}
                          onClick={() => handleSaveProvider(prov)}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{savingProviderId === prov.id ? 'Menyimpan...' : 'Simpan Kredensial Terenkripsi'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'numbers' && (
            <div className="space-y-5">
              {/* Add DEMO Catalog Number */}
              <form
                onSubmit={handleAddNumber}
                className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 space-y-4"
              >
                <h2 className="text-base font-bold text-white">Tambah Nomor Cantik (Katalog DEMO)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Nomor Telepon</label>
                    <input
                      type="text"
                      required
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="+62 811-7700-8888"
                      className="w-full min-h-[42px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Negara</label>
                    <select
                      value={newCountry}
                      onChange={(e) => setNewCountry(e.target.value)}
                      className="w-full min-h-[42px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="ID">Indonesia (+62)</option>
                      <option value="US">United States (+1)</option>
                      <option value="GB">United Kingdom (+44)</option>
                      <option value="SG">Singapore (+65)</option>
                      <option value="MY">Malaysia (+60)</option>
                      <option value="JP">Japan (+81)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Operator</label>
                    <input
                      type="text"
                      required
                      value={newCarrier}
                      onChange={(e) => setNewCarrier(e.target.value)}
                      className="w-full min-h-[42px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Tarif 10 Menit (Rp)</label>
                    <input
                      type="number"
                      value={newPrice10m}
                      onChange={(e) => setNewPrice10m(Number(e.target.value))}
                      className="w-full min-h-[40px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Tarif 30 Menit (Rp)</label>
                    <input
                      type="number"
                      value={newPrice30m}
                      onChange={(e) => setNewPrice30m(Number(e.target.value))}
                      className="w-full min-h-[40px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Tarif 1 Jam (Rp)</label>
                    <input
                      type="number"
                      value={newPrice1h}
                      onChange={(e) => setNewPrice1h(Number(e.target.value))}
                      className="w-full min-h-[40px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Tarif 24 Jam (Rp)</label>
                    <input
                      type="number"
                      value={newPrice24h}
                      onChange={(e) => setNewPrice24h(Number(e.target.value))}
                      className="w-full min-h-[40px] px-3 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-xs text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={addingNumber}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{addingNumber ? 'Menambahkan...' : 'Tambah ke Katalog'}</span>
                </button>
              </form>

              {/* Numbers Table */}
              <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[740px]">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                      <th className="py-3 font-medium">Nomor</th>
                      <th className="py-3 font-medium">Negara / Operator</th>
                      <th className="py-3 font-medium">Status</th>
                      <th className="py-3 font-medium">Tarif (10m / 30m / 1j / 24j)</th>
                      <th className="py-3 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {numbers.map((num) => {
                      const isEditing = editingPriceId === num.id;
                      return (
                        <tr key={num.id}>
                          <td className="py-3 pr-3 font-mono font-semibold text-white whitespace-nowrap">
                            {num.phoneNumber}{' '}
                            {num.isDemo && <span className="text-amber-300 text-[10px]">[DEMO]</span>}
                          </td>
                          <td className="py-3 pr-3 text-slate-300">
                            {num.countryName} · {num.carrier}
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={
                                num.status === 'Available'
                                  ? 'text-emerald-400 font-semibold'
                                  : num.status === 'Active'
                                    ? 'text-sky-400 font-semibold'
                                    : 'text-slate-400'
                              }
                            >
                              {num.status}
                            </span>
                          </td>
                          <td className="py-3 pr-3 font-mono tabular-nums text-slate-200">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  value={editPrice10m}
                                  onChange={(e) => setEditPrice10m(Number(e.target.value))}
                                  className="w-20 px-2 py-1 rounded bg-[#070C1A] border border-slate-700 text-xs"
                                />
                                <input
                                  type="number"
                                  value={editPrice30m}
                                  onChange={(e) => setEditPrice30m(Number(e.target.value))}
                                  className="w-20 px-2 py-1 rounded bg-[#070C1A] border border-slate-700 text-xs"
                                />
                                <input
                                  type="number"
                                  value={editPrice1h}
                                  onChange={(e) => setEditPrice1h(Number(e.target.value))}
                                  className="w-20 px-2 py-1 rounded bg-[#070C1A] border border-slate-700 text-xs"
                                />
                                <input
                                  type="number"
                                  value={editPrice24h}
                                  onChange={(e) => setEditPrice24h(Number(e.target.value))}
                                  className="w-20 px-2 py-1 rounded bg-[#070C1A] border border-slate-700 text-xs"
                                />
                              </div>
                            ) : (
                              `${formatIDR(num.price10m)} / ${formatIDR(num.price30m)} / ${formatIDR(num.price1h)} / ${formatIDR(num.price24h)}`
                            )}
                          </td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {isEditing ? (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSaveNumberPrice(num.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
                                >
                                  Simpan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPriceId(null)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPriceId(num.id);
                                    setEditPrice10m(num.price10m);
                                    setEditPrice30m(num.price30m);
                                    setEditPrice1h(num.price1h);
                                    setEditPrice24h(num.price24h);
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                                >
                                  Atur Harga
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNumber(num.id)}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300"
                                  aria-label="Hapus nomor"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'users' && (
            <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                    <th className="py-3 font-medium">Pengguna</th>
                    <th className="py-3 font-medium">Peran</th>
                    <th className="py-3 font-medium">Total Sewa</th>
                    <th className="py-3 font-medium">Saldo</th>
                    <th className="py-3 font-medium text-right">Penyesuaian Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-white">{u.name}</div>
                        <div className="text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-3 pr-3 font-mono text-sky-300">{u.role}</td>
                      <td className="py-3 pr-3 font-mono tabular-nums text-slate-200">{u.rentalCount}</td>
                      <td className="py-3 pr-3 font-mono tabular-nums font-bold text-white">
                        {formatIDR(u.balance)}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleAdjustBalance(u.id, 100000)}
                          className="px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/40 text-sky-300 font-semibold"
                        >
                          + Rp 100.000
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'transactions' && (
            <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                    <th className="py-3 font-medium">Pengguna</th>
                    <th className="py-3 font-medium">Ref Gateway</th>
                    <th className="py-3 font-medium">Deskripsi</th>
                    <th className="py-3 font-medium">Status</th>
                    <th className="py-3 font-medium">Waktu</th>
                    <th className="py-3 font-medium text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-3 pr-3">
                        <div className="text-white font-medium">{tx.userName}</div>
                        <div className="text-slate-400">{tx.userEmail}</div>
                      </td>
                      <td className="py-3 pr-3 font-mono text-slate-300">{tx.gatewayRef}</td>
                      <td className="py-3 pr-3 text-slate-200">{tx.description}</td>
                      <td className="py-3 pr-3 text-emerald-400 font-semibold">{tx.status}</td>
                      <td className="py-3 pr-3 text-slate-400 tabular-nums">{formatDateTime(tx.createdAt)}</td>
                      <td className="py-3 text-right font-mono tabular-nums font-bold text-white">
                        {formatIDR(tx.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
