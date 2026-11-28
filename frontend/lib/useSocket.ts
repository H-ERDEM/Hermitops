"use client";
import { useEffect, useRef, useState } from "react";

/** Coordinator olay akışı mesajı (ws.ts/hub.ts; demo paneli ve kontrol için). */
export interface SocketEvent {
  type: string;
  [k: string]: unknown;
}

/**
 * Coordinator WebSocket'ine (/ws) bağlanır ve gelen olayları verir.
 * Üretimde same-origin (`wss://host/ws`). Dev'de rewrites WS'i vekilleyemez; coordinator'a
 * doğrudan bağlanmak için NEXT_PUBLIC_WS_URL ver (ör. ws://127.0.0.1:8787/ws).
 */
export function useSocket(enabled = true) {
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<SocketEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const url =
      process.env.NEXT_PUBLIC_WS_URL ??
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        try {
          setLast(JSON.parse(ev.data) as SocketEvent);
        } catch {
          /* protokol dışı mesaj yok sayılır */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [enabled]);

  return { connected, last, socket: wsRef };
}
