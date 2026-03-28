/**
 * QR scanner for Tek Automate executor connection.
 * Scan QR (tekautomate://connect?v=1&host=...&port=...) or enter URL manually.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface QRConnectScannerProps {
  onSuccess: (payload: string) => void;
  onCancel: () => void;
}

const DEFAULT_PORT = 8765;

export function QRConnectScanner({ onSuccess, onCancel }: QRConnectScannerProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<any>(null);
  const startedRef = useRef(false);

  const stopCamera = useCallback(async () => {
    const s = html5QrRef.current;
    if (s) {
      html5QrRef.current = null;
      startedRef.current = false;
      const video = document.querySelector('#qr-reader video') as HTMLVideoElement | null;
      const stream = video?.srcObject as MediaStream | null;
      if (stream?.getTracks) {
        stream.getTracks().forEach((t) => t.stop());
      }
      try {
        await s.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const handleCancel = useCallback(async () => {
    await stopCamera();
    onCancel();
  }, [stopCamera, onCancel]);

  const handleManualSubmit = useCallback(async () => {
    const h = host.trim();
    if (!h) {
      setError('Enter executor IP or hostname');
      return;
    }
    const p = parseInt(port.trim(), 10);
    if (Number.isNaN(p) || p < 1 || p > 65535) {
      setError('Port must be 1–65535');
      return;
    }
    setError(null);
    await stopCamera();
    onSuccess(`tekautomate://connect?v=1&host=${encodeURIComponent(h)}&port=${p}`);
  }, [host, port, onSuccess, stopCamera]);

  useEffect(() => {
    if (!scannerRef.current || startedRef.current) return;
    let scanner: any = null;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('qr-reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 200, height: 200 }, aspectRatio: 1 },
          (decodedText: string) => {
            if (decodedText && (decodedText.startsWith('tekautomate://') || decodedText.startsWith('{"v"') || decodedText.startsWith('{"host"'))) {
              scanner?.stop().then(() => onSuccess(decodedText)).catch(() => onSuccess(decodedText));
            }
          },
          () => {}
        );
        html5QrRef.current = scanner;
        startedRef.current = true;

        // Apply 2x zoom for easier QR scanning
        try {
          const video = document.querySelector('#qr-reader video') as HTMLVideoElement | null;
          const stream = video?.srcObject as MediaStream | null;
          const track = stream?.getVideoTracks()?.[0];
          if (track) {
            const caps = track.getCapabilities?.() as any;
            if (caps?.zoom) {
              const targetZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2));
              await track.applyConstraints({ advanced: [{ zoom: targetZoom } as any] } as any);
            }
          }
        } catch {
          // zoom not supported on this device/browser
        }
      } catch (e) {
        console.warn('QR scanner init failed (camera not available or denied):', e);
        setError('Camera not available. Use manual entry below.');
      }
    })();
    return () => {
      const s = html5QrRef.current;
      if (s) {
        html5QrRef.current = null;
        startedRef.current = false;
        s.stop().catch(() => {});
      }
    };
  }, [onSuccess]);

  const isSecureContext = typeof window !== 'undefined' && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={handleCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Connect to executor</span>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {!isSecureContext && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
              Camera may not work over HTTP. Use manual entry below.
            </p>
          )}
          <div className="relative w-full max-w-[250px] mx-auto">
            <div
              id="qr-reader"
              ref={scannerRef}
              className="rounded-lg overflow-hidden bg-black"
              style={{ width: '100%', minHeight: 250, aspectRatio: '1' }}
            />
            <style>{`
              #qr-reader video { display: block !important; width: 100% !important; height: 100% !important; object-fit: cover !important; }
              #qr-reader__scan_region video { display: block !important; }
            `}</style>
          </div>
          {error && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">{error}</p>
          )}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Or enter executor IP and port:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={host}
                onChange={(e) => { setHost(e.target.value); setError(null); }}
                placeholder="192.168.1.10"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                inputMode="decimal"
              />
              <input
                type="text"
                value={port}
                onChange={(e) => { setPort(e.target.value); setError(null); }}
                placeholder="8765"
                className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                inputMode="numeric"
              />
            </div>
            <button
              type="button"
              onClick={handleManualSubmit}
              className="mt-2 w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
