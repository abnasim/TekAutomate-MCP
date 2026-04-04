/**
 * QR scanner / manual IP entry for Tek Automate executor connection.
 * Camera only starts when user clicks "Scan QR". Manual IP verifies connectivity before connecting.
 */

import React, { useCallback, useRef, useState } from 'react';
import { X, Wifi, WifiOff, Camera, Loader2 } from 'lucide-react';

export interface QRConnectScannerProps {
  onSuccess: (payload: string) => void;
  onCancel: () => void;
}

const DEFAULT_PORT = 8765;

export function QRConnectScanner({ onSuccess, onCancel }: QRConnectScannerProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'connected' | 'failed'>('idle');
  const [showCamera, setShowCamera] = useState(false);
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
    setShowCamera(false);
  }, []);

  const handleCancel = useCallback(async () => {
    await stopCamera();
    onCancel();
  }, [stopCamera, onCancel]);

  const verifyAndConnect = useCallback(async (h: string, p: number) => {
    setStatus('verifying');
    setError(null);
    try {
      const url = `http://${h}:${p}/run`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol_version: 1,
          action: 'send_scpi',
          timeout_sec: 5,
          scope_visa: '-',
          liveMode: true,
          commands: [],
          timeout_ms: 3000,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 200) {
        setStatus('connected');
        await stopCamera();
        setTimeout(() => {
          onSuccess(`tekautomate://connect?v=1&host=${encodeURIComponent(h)}&port=${p}`);
        }, 800);
      } else {
        setStatus('failed');
        setError(`Executor responded with status ${res.status}. Check if it's running.`);
      }
    } catch (err) {
      setStatus('failed');
      if (err instanceof Error && err.name === 'TimeoutError') {
        setError('Connection timed out. Check IP and ensure executor is running.');
      } else {
        setError('Could not reach executor. Check IP, port, and network.');
      }
    }
  }, [onSuccess, stopCamera]);

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
    await verifyAndConnect(h, p);
  }, [host, port, verifyAndConnect]);

  const startCamera = useCallback(async () => {
    setShowCamera(true);
    // Wait for DOM to render the qr-reader div
    setTimeout(async () => {
      if (!scannerRef.current || startedRef.current) return;
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const scanner = new Html5Qrcode('qr-reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 200, height: 200 } } as any,
          async (decodedText: string) => {
            if (decodedText && (decodedText.startsWith('tekautomate://') || decodedText.startsWith('{"v"') || decodedText.startsWith('{"host"'))) {
              await scanner.stop().catch(() => {});
              html5QrRef.current = null;
              startedRef.current = false;
              setShowCamera(false);
              onSuccess(decodedText);
            }
          },
          () => {}
        );
        html5QrRef.current = scanner;
        startedRef.current = true;
      } catch (e) {
        console.warn('QR scanner init failed:', e);
        setError('Camera not available. Use manual entry.');
        setShowCamera(false);
      }
    }, 100);
  }, [onSuccess]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={handleCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Connect to Executor</span>
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
          {/* Manual IP Entry */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Enter the executor IP address shown in the TekAutomate Executor window:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={host}
                onChange={(e) => { setHost(e.target.value); setError(null); setStatus('idle'); }}
                placeholder="192.168.1.10"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                inputMode="decimal"
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              />
              <input
                type="text"
                value={port}
                onChange={(e) => { setPort(e.target.value); setError(null); setStatus('idle'); }}
                placeholder="8765"
                className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                inputMode="numeric"
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              />
            </div>
            <button
              type="button"
              onClick={handleManualSubmit}
              disabled={status === 'verifying'}
              className={`mt-2 w-full py-2.5 px-3 text-sm font-medium rounded-lg flex items-center justify-center gap-2 ${
                status === 'connected'
                  ? 'bg-green-600 text-white'
                  : status === 'failed'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {status === 'verifying' && <Loader2 size={16} className="animate-spin" />}
              {status === 'connected' && <Wifi size={16} />}
              {status === 'failed' && <WifiOff size={16} />}
              {status === 'idle' && <Wifi size={16} />}
              {status === 'verifying' ? 'Verifying...' :
               status === 'connected' ? 'Connected!' :
               status === 'failed' ? 'Retry' : 'Connect'}
            </button>
          </div>

          {/* Status/Error */}
          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 text-center">{error}</p>
          )}
          {status === 'connected' && (
            <p className="text-xs text-green-600 dark:text-green-400 text-center font-medium">
              Executor is reachable at {host}:{port}
            </p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            <span className="text-xs text-gray-400 dark:text-gray-500">or</span>
            <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          </div>

          {/* QR Scanner — only shows when clicked */}
          {showCamera ? (
            <div>
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
              <button
                type="button"
                onClick={stopCamera}
                className="mt-2 w-full py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Close camera
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startCamera}
              className="w-full py-2.5 px-3 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center gap-2"
            >
              <Camera size={16} />
              Scan QR Code
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
