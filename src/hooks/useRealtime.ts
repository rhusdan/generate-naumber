import { useEffect, useRef, useState } from 'react';
import { getStoredToken } from '../lib/api';

interface RealtimeHandlers {
  onSmsReceived?: (payload: Record<string, unknown>) => void;
  onRentalExpired?: (payload: Record<string, unknown>) => void;
  onBalanceUpdated?: (payload: { balance: number }) => void;
  onStatsUpdated?: () => void;
}

export function useRealtime(enabled: boolean, handlers: RealtimeHandlers) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (!disposed) setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { event: string; data: unknown };
          if (parsed.event === 'sms:received') {
            handlersRef.current.onSmsReceived?.(parsed.data as Record<string, unknown>);
          } else if (parsed.event === 'rental:expired') {
            handlersRef.current.onRentalExpired?.(parsed.data as Record<string, unknown>);
          } else if (parsed.event === 'balance:updated') {
            handlersRef.current.onBalanceUpdated?.(parsed.data as { balance: number });
          } else if (parsed.event === 'stats:updated') {
            handlersRef.current.onStatsUpdated?.();
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]);

  return { connected };
}
