import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  Clock,
  Copy,
  Inbox,
  MessageSquareText,
  PhoneOff,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiRequest, formatCountdown, formatDateTime, formatIDR } from '../lib/api';
import type { Rental, SmsMessage } from '../types';

interface InboxViewProps {
  rentals: Rental[];
  selectedRentalId: string | null;
  onSelectRental: (id: string) => void;
  wsConnected: boolean;
  nowMs: number;
  incomingPushCount: number;
  onReleaseRental: (id: string) => Promise<void>;
  onNavigateGenerator: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export function InboxView({
  rentals,
  selectedRentalId,
  onSelectRental,
  wsConnected,
  nowMs,
  incomingPushCount,
  onReleaseRental,
  onNavigateGenerator,
  onNotify,
}: InboxViewProps) {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loadingSms, setLoadingSms] = useState(false);
  const [sendingDemo, setSendingDemo] = useState(false);
  const [demoSender, setDemoSender] = useState('BEAUTY-SANDBOX');
  const [demoCustomCode, setDemoCustomCode] = useState('');

  const activeRental =
    rentals.find((r) => r.id === selectedRentalId) ||
    rentals.find((r) => r.status === 'Active') ||
    rentals[0] ||
    null;

  const loadMessages = async (rentalId: string) => {
    setLoadingSms(true);
    try {
      const res = await apiRequest<{ messages: SmsMessage[]; expired: boolean }>(`/api/rentals/${rentalId}/sms`);
      setMessages(res.messages);
    } catch {
      setMessages([]);
    } finally {
      setLoadingSms(false);
    }
  };

  useEffect(() => {
    if (!activeRental || activeRental.status !== 'Active') {
      setMessages([]);
      return;
    }
    loadMessages(activeRental.id);
  }, [activeRental?.id, activeRental?.status, incomingPushCount]);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify('success', `${label} disalin`, text);
    } catch {
      onNotify('error', 'Gagal menyalin ke clipboard');
    }
  };

  const handleTriggerDemoSms = async () => {
    if (!activeRental || !activeRental.isDemo || activeRental.status !== 'Active') return;
    setSendingDemo(true);
    try {
      const res = await apiRequest<{ message: SmsMessage }>(`/api/rentals/${activeRental.id}/demo-sms`, {
        method: 'POST',
        body: JSON.stringify({
          sender: demoSender.trim() || 'BEAUTY-SANDBOX',
          customCode: demoCustomCode.trim(),
        }),
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [res.message, ...prev];
      });
      setDemoCustomCode('');
      onNotify(
        'success',
        `OTP DEMO dibuat: ${res.message.otpCode || 'Terkirim'}`,
        `Dari ${res.message.sender} ke ${activeRental.phoneNumber}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim SMS uji coba DEMO.';
      onNotify('error', 'Gagal', msg);
    } finally {
      setSendingDemo(false);
    }
  };

  const handleDeleteSms = async (smsId: string) => {
    if (!activeRental) return;
    try {
      await apiRequest(`/api/rentals/${activeRental.id}/sms/${smsId}`, { method: 'DELETE' });
      setMessages((prev) => prev.filter((m) => m.id !== smsId));
      onNotify('info', 'Pesan OTP dihapus', 'Data pesan telah dibersihkan dari server.');
    } catch (err) {
      onNotify('error', 'Gagal menghapus pesan', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Kotak Masuk SMS &amp; OTP</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Pesan verifikasi diterima secara real-time dan otomatis terhapus saat masa sewa selesai.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium self-start sm:self-auto">
          {wsConnected ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-xl">
              <Wifi className="w-3.5 h-3.5" />
              Real-time Stream Terhubung
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400 bg-slate-800/60 border border-slate-700 px-3 py-1.5 rounded-xl">
              <WifiOff className="w-3.5 h-3.5" />
              Menghubungkan ulang...
            </span>
          )}
        </div>
      </div>

      {rentals.length === 0 ? (
        <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-10 text-center">
          <Inbox className="w-9 h-9 text-slate-500 mx-auto" />
          <h2 className="mt-3 text-base font-semibold text-white">Belum ada nomor yang disewa</h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            Sewa nomor virtual sementara dari Generator Nomor Cantik untuk mulai menerima SMS verifikasi secara langsung.
          </p>
          <button
            type="button"
            onClick={onNavigateGenerator}
            className="mt-5 min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
          >
            Buka Generator Nomor
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: User Rentals List */}
          <div className="lg:col-span-5 xl:col-span-4 rounded-2xl bg-[#0D1528] border border-slate-800/80 p-4 sm:p-5 h-fit">
            <h2 className="text-sm font-bold text-white pb-3 border-b border-slate-800/80">
              Daftar Nomor Anda ({rentals.length})
            </h2>
            <div className="mt-3 space-y-2 max-h-[540px] overflow-y-auto pr-1">
              {rentals.map((r) => {
                const isSelected = activeRental?.id === r.id;
                const isActive = r.status === 'Active';
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRental(r.id)}
                    className={`w-full min-h-[64px] p-3.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-violet-600/15 border-violet-500/60'
                        : 'bg-[#070C1A] border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono tabular-nums text-sm font-bold text-white truncate">
                        {r.phoneNumber}
                      </span>
                      {r.isDemo && (
                        <span className="font-mono text-[10px] font-bold text-amber-300 border border-amber-400/35 px-1.5 py-0.5 rounded shrink-0">
                          DEMO
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400 truncate">
                        {r.countryName} · {r.carrier}
                      </span>
                      {isActive ? (
                        <span className="font-mono tabular-nums text-emerald-400 font-semibold shrink-0">
                          {formatCountdown(r.expiresAt, nowMs)}
                        </span>
                      ) : (
                        <span className="text-slate-500 shrink-0">Expired</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Active Rental Details & SMS Messages */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-4">
            {activeRental && (
              <motion.div
                key={activeRental.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="rounded-2xl bg-[#0D1528] border border-slate-800/90 p-5 sm:p-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-5 border-b border-slate-800/80">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {activeRental.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                          <Activity className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          Expired
                        </span>
                      )}
                      {activeRental.isDemo ? (
                        <span className="font-mono text-[11px] font-bold text-amber-300 border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 rounded-md">
                          DEMO SANDBOX
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] font-bold text-sky-300 border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 rounded-md">
                          LIVE API
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2.5">
                      <h2 className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
                        {activeRental.phoneNumber}
                      </h2>
                      <button
                        type="button"
                        onClick={() => handleCopy(activeRental.phoneNumber, 'Nomor telepon')}
                        className="p-2 rounded-xl bg-[#070C1A] border border-slate-800 text-slate-300 hover:text-white transition-colors"
                        aria-label="Salin nomor telepon"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {activeRental.countryName} · {activeRental.carrier} · {activeRental.providerName} · Biaya{' '}
                      <span className="font-mono tabular-nums text-slate-200">{formatIDR(activeRental.pricePaid)}</span>
                    </p>
                  </div>

                  {activeRental.status === 'Active' && (
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <div className="px-3.5 py-2 rounded-xl bg-[#070C1A] border border-slate-800 text-right">
                        <div className="text-[10px] text-slate-400">Sisa Masa Aktif</div>
                        <div className="text-base font-bold font-mono tabular-nums text-sky-400">
                          {formatCountdown(activeRental.expiresAt, nowMs)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onReleaseRental(activeRental.id)}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <PhoneOff className="w-3.5 h-3.5" />
                        <span>Akhiri Sewa</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Progress Bar for Lease Countdown */}
                {activeRental.status === 'Active' && (
                  <div className="mt-4">
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-sky-400 transition-all duration-1000"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              ((activeRental.expiresAt - nowMs) /
                                Math.max(1, activeRental.expiresAt - activeRental.startedAt)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Prominent DEMO OTP Tester Panel when active rental is DEMO */}
                {activeRental.status === 'Active' && activeRental.isDemo && (
                  <div className="mt-5 rounded-xl bg-[#070C1A] border border-violet-500/30 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-white">Buat OTP Uji Coba (Mode DEMO)</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Nomor berlabel DEMO adalah sandbox internal (tidak menerima SMS dari WhatsApp/Google/bank). Untuk SMS asli, atur API Twilio/Vonage/Telnyx di Admin Console.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-300 mb-1" htmlFor="demo-sender">
                          Nama Pengirim
                        </label>
                        <input
                          id="demo-sender"
                          type="text"
                          maxLength={32}
                          value={demoSender}
                          onChange={(e) => setDemoSender(e.target.value)}
                          placeholder="BEAUTY-SANDBOX"
                          className="w-full min-h-[42px] px-3 bg-[#0D1528] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-300 mb-1" htmlFor="demo-code">
                          Kode OTP (opsional, 4–8 digit)
                        </label>
                        <input
                          id="demo-code"
                          type="text"
                          inputMode="numeric"
                          maxLength={8}
                          value={demoCustomCode}
                          onChange={(e) => setDemoCustomCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="Kosong = 6 digit acak"
                          className="w-full min-h-[42px] px-3 bg-[#0D1528] border border-slate-800 rounded-xl font-mono text-xs text-white placeholder:font-sans focus:outline-none focus:border-sky-400"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <button
                          type="button"
                          disabled={sendingDemo}
                          onClick={handleTriggerDemoSms}
                          className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 whitespace-nowrap"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{sendingDemo ? 'Membuat OTP...' : 'Buat & Kirim OTP (DEMO)'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Toolbar */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>OTP otomatis dihapus saat masa aktif habis (maks. 5 menit penyimpanan).</span>
                  </div>

                  {activeRental.status === 'Active' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadMessages(activeRental.id)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#070C1A] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingSms ? 'animate-spin' : ''}`} />
                        <span>Segarkan</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Messages Feed */}
                <div className="mt-5 space-y-3">
                  {activeRental.status !== 'Active' ? (
                    <div className="py-8 text-center rounded-xl bg-[#070C1A] border border-slate-800/80 px-4">
                      <Clock className="w-7 h-7 text-slate-500 mx-auto" />
                      <p className="mt-2.5 text-sm font-semibold text-slate-200">Masa sewa nomor ini telah kedaluwarsa</p>
                      <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                        Untuk membuat atau menerima OTP, sewa nomor aktif terlebih dahulu melalui Generator Nomor.
                      </p>
                      <button
                        type="button"
                        onClick={onNavigateGenerator}
                        className="mt-4 min-h-[42px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                      >
                        Sewa Nomor Aktif di Generator
                      </button>
                    </div>
                  ) : loadingSms && messages.length === 0 ? (
                    <div className="h-28 rounded-xl bg-slate-800/40 animate-pulse" />
                  ) : messages.length === 0 ? (
                    <div className="py-10 text-center rounded-xl bg-[#070C1A] border border-slate-800/80 px-4">
                      <MessageSquareText className="w-7 h-7 text-slate-500 mx-auto" />
                      <p className="mt-2.5 text-sm font-semibold text-white">Belum ada SMS/OTP masuk</p>
                      <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                        {activeRental.isDemo
                          ? 'Klik tombol "Buat & Kirim OTP (DEMO)" di atas untuk langsung menghasilkan kode OTP uji coba ke nomor ini.'
                          : 'Pesan SMS resmi yang dikirim ke nomor ini akan muncul otomatis secara real-time atau saat disegarkan.'}
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className="rounded-xl bg-[#070C1A] border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-bold text-white">{msg.sender}</span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="text-slate-400 tabular-nums">{formatDateTime(msg.receivedAt)}</span>
                            {msg.isDemo && (
                              <span className="font-mono text-[10px] font-bold text-amber-300 border border-amber-400/35 px-1.5 py-0.5 rounded">
                                DEMO
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-slate-200 leading-relaxed break-words">{msg.body}</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {msg.otpCode && (
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.otpCode!, 'Kode OTP')}
                              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-sky-300 font-mono text-sm font-bold tabular-nums inline-flex items-center gap-2 transition-colors"
                            >
                              <span>{msg.otpCode}</span>
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteSms(msg.id)}
                            className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-900 hover:bg-rose-500/15 border border-slate-800 hover:border-rose-500/30 text-slate-400 hover:text-rose-300 inline-flex items-center justify-center transition-colors"
                            aria-label="Hapus pesan OTP sekarang"
                            title="Hapus OTP sekarang"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
