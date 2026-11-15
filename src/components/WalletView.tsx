import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  LogOut,
  Save,
  ShieldCheck,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { apiRequest, formatDateTime, formatIDR } from '../lib/api';
import type { Transaction, User } from '../types';

interface WalletViewProps {
  user: User;
  onBalanceUpdated: (newBalance: number) => void;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

const PRESET_AMOUNTS = [50000, 100000, 250000, 500000];
const PAYMENT_METHODS = ['QRIS', 'Virtual Account', 'E-Wallet', 'Card'];

export function WalletView({ user, onBalanceUpdated, onUserUpdated, onLogout, onNotify }: WalletViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [amount, setAmount] = useState<number>(100000);
  const [paymentMethod, setPaymentMethod] = useState('QRIS');
  const [processingTopup, setProcessingTopup] = useState(false);

  const [displayName, setDisplayName] = useState(user.name);
  const [savingProfile, setSavingProfile] = useState(false);

  const loadTransactions = async () => {
    setLoadingTx(true);
    try {
      const res = await apiRequest<{ transactions: Transaction[] }>('/api/transactions');
      setTransactions(res.transactions);
    } catch {
      // Handled gracefully
    } finally {
      setLoadingTx(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [user.balance]);

  const handleTopup = async (e: FormEvent) => {
    e.preventDefault();
    setProcessingTopup(true);
    try {
      const res = await apiRequest<{
        transaction: Transaction;
        balance: number;
        sandboxMode: boolean;
      }>('/api/payments/topup', {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMethod }),
      });
      onBalanceUpdated(res.balance);
      await loadTransactions();
      onNotify(
        'success',
        res.sandboxMode ? 'Top up sandbox berhasil' : 'Instruksi pembayaran dibuat',
        res.sandboxMode
          ? `Saldo bertambah ${formatIDR(amount)} via ${paymentMethod}.`
          : `Ref: ${res.transaction.gatewayRef} menunggu konfirmasi gateway.`
      );
    } catch (err) {
      onNotify('error', 'Top up gagal', err instanceof Error ? err.message : undefined);
    } finally {
      setProcessingTopup(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: displayName }),
      });
      onUserUpdated(res.user);
      onNotify('success', 'Profil diperbarui');
    } catch (err) {
      onNotify('error', 'Gagal memperbarui profil', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Dompet, Pembayaran &amp; Profil</h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
          Kelola saldo sewa nomor, riwayat transaksi payment gateway, dan informasi akun Anda.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Top Up & Balance Card */}
        <div className="lg:col-span-7 rounded-2xl bg-[#0D1528] border border-slate-800/90 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800/80">
            <div>
              <span className="text-xs font-medium text-slate-400">Saldo Tersedia</span>
              <div className="mt-1 text-3xl font-bold font-mono tabular-nums text-white">
                {formatIDR(user.balance)}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-sky-300 bg-sky-500/10 border border-sky-500/25 px-3 py-2 rounded-xl self-start sm:self-auto">
              <ShieldCheck className="w-4 h-4" />
              <span>Payment Gateway Ready</span>
            </div>
          </div>

          <form onSubmit={handleTopup} className="mt-5 space-y-5">
            <div>
              <span className="block text-xs font-semibold text-slate-300 mb-2.5">Pilih Nominal Top Up</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {PRESET_AMOUNTS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(val)}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border font-mono tabular-nums text-xs font-bold transition-all ${
                      amount === val
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-[#070C1A] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {formatIDR(val)}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-xs text-slate-400 mb-1.5" htmlFor="topup-custom">
                  Atau masukkan nominal lain (Rp)
                </label>
                <input
                  id="topup-custom"
                  type="number"
                  min={10000}
                  max={10000000}
                  step={5000}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-sm text-white focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-300 mb-2.5">Metode Pembayaran</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      paymentMethod === method
                        ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                        : 'bg-[#070C1A] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={processingTopup}
              className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            >
              <CreditCard className="w-4 h-4" />
              <span>{processingTopup ? 'Memproses Pembayaran...' : `Isi Saldo ${formatIDR(amount)}`}</span>
            </button>
          </form>
        </div>

        {/* Profile Card */}
        <div className="lg:col-span-5 rounded-2xl bg-[#0D1528] border border-slate-800/90 p-5 sm:p-6 flex flex-col justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 pb-4 border-b border-slate-800/80">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-sky-500 flex items-center justify-center text-white font-bold text-base shrink-0">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white truncate">{user.name}</h2>
                <p className="text-xs text-slate-400 truncate">
                  {user.email} · {user.role === 'admin' ? 'Administrator' : 'Pengguna'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="profile-name">
                  Nama Tampilan
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="profile-name"
                    type="text"
                    required
                    minLength={2}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full min-h-[44px] pl-10 pr-4 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div className="text-xs text-slate-400">
                Terdaftar sejak <span className="text-slate-200 tabular-nums">{formatDateTime(user.createdAt)}</span>
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{savingProfile ? 'Menyimpan...' : 'Simpan Perubahan Profil'}</span>
              </button>
            </form>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar dari Akun</span>
          </button>
        </div>
      </div>

      {/* Transaction History */}
      <section className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-sky-400" />
            <h2 className="text-base font-bold text-white">Riwayat Pembayaran &amp; Transaksi</h2>
          </div>
        </div>

        {loadingTx ? (
          <div className="py-8 space-y-3">
            <div className="h-12 rounded-xl bg-slate-800/40 animate-pulse" />
            <div className="h-12 rounded-xl bg-slate-800/40 animate-pulse" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">Belum ada catatan transaksi.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6 mt-2">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="py-3 font-medium">Referensi</th>
                  <th className="py-3 font-medium">Keterangan</th>
                  <th className="py-3 font-medium">Metode</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 font-medium">Waktu</th>
                  <th className="py-3 font-medium text-right">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {transactions.map((tx) => {
                  const isTopup = tx.type === 'topup' || tx.type === 'refund';
                  return (
                    <tr key={tx.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 pr-3 font-mono text-slate-300 whitespace-nowrap">{tx.gatewayRef}</td>
                      <td className="py-3 pr-3 text-slate-200">{tx.description}</td>
                      <td className="py-3 pr-3 text-slate-400 whitespace-nowrap">{tx.paymentMethod}</td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            tx.status === 'Completed'
                              ? 'text-emerald-400'
                              : tx.status === 'Pending'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td
                        className={`py-3 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                          isTopup ? 'text-emerald-400' : 'text-slate-200'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isTopup ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                          {isTopup ? '+' : '-'}
                          {formatIDR(tx.amount)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
