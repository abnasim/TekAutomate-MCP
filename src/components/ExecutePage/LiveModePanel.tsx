import React, { useEffect, useState } from 'react';
import { Camera, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, MonitorSmartphone, RefreshCw, Terminal } from 'lucide-react';
import { VncViewer } from './VncViewer';

export interface LiveModeCapture {
  dataUrl: string;
  capturedAt: string;
  sizeBytes: number;
  mimeType: string;
}

interface LiveModePanelProps {
  capture: LiveModeCapture | null;
  isCapturing: boolean;
  error: string | null;
  autoRefresh: boolean;
  refreshInterval: number;
  runLog?: string;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  onChangeRefreshInterval: (seconds: number) => void;
  vncAvailable?: boolean | null;
  vncActive?: boolean;
  vncConnecting?: boolean;
  vncError?: string | null;
  vncSessionInfo?: { wsUrl: string; targetHost: string; targetPort: number; sessionId: string } | null;
  onToggleVnc?: () => void;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function getRunLogLineClass(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return 'text-slate-400 dark:text-slate-500';
  if (/^\[OK\]/.test(trimmed)) return 'text-emerald-700 dark:text-emerald-300 font-semibold';
  if (/^\[STEP\]/.test(trimmed)) return 'text-sky-700 dark:text-sky-300';
  if (/^\[RESP\]/.test(trimmed)) return 'text-violet-700 dark:text-violet-300';
  if (/^\[Error\]/.test(trimmed) || /^Traceback/.test(trimmed)) return 'text-rose-700 dark:text-rose-300 font-semibold';
  return 'text-slate-700 dark:text-slate-200';
}

export function LiveModePanel({
  capture,
  isCapturing,
  error,
  autoRefresh,
  refreshInterval,
  runLog,
  onRefresh,
  onToggleAutoRefresh,
  onChangeRefreshInterval,
  vncAvailable = null,
  vncActive = false,
  vncConnecting = false,
  vncError = null,
  vncSessionInfo = null,
  onToggleVnc,
}: LiveModePanelProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [viewMode, setViewMode] = useState<'screenshot' | 'vnc'>('screenshot');
  const logLines = (runLog || '').split(/\r?\n/).filter(Boolean);
  const hasLogs = logLines.length > 0;
  const canShowVncTab = Boolean(vncActive || vncAvailable);
  const isVncViewActive = viewMode === 'vnc' && vncActive && vncSessionInfo;

  useEffect(() => {
    if (vncActive && vncSessionInfo) {
      setViewMode('vnc');
    }
  }, [vncActive, vncSessionInfo?.sessionId]);

  return (
    <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800/50">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">Live Mode</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {canShowVncTab ? (
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setViewMode('screenshot')}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    viewMode === 'screenshot'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Screenshot
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('vnc')}
                  disabled={!vncActive || !vncSessionInfo}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    viewMode === 'vnc'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  VNC
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onToggleAutoRefresh}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                autoRefresh
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Auto {autoRefresh ? 'on' : 'off'}
            </button>
            <select
              value={refreshInterval}
              onChange={(e) => onChangeRefreshInterval(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
            {onToggleVnc ? (
              <button
                type="button"
                onClick={onToggleVnc}
                disabled={vncConnecting}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  vncActive
                    ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
                title={
                  vncActive
                    ? 'Stop VNC session'
                    : 'Start VNC session'
                }
                aria-label={vncActive ? 'Stop VNC session' : 'Start VNC session'}
              >
                {vncConnecting ? <Loader2 size={12} className="animate-spin" /> : <MonitorSmartphone size={12} />}
                {vncActive ? 'VNC on' : 'VNC'}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isCapturing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {isCapturing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {isCapturing ? 'Capturing...' : 'Capture'}
          </button>
        </div>
      </div>

      {/* Main content: screenshot + logs */}
      <div className={`flex-1 min-h-0 p-4 space-y-3 ${isVncViewActive ? 'overflow-hidden' : 'overflow-auto'}`}>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        {vncError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            {vncError}
          </div>
        )}

        {isVncViewActive ? (
          <VncViewer wsUrl={vncSessionInfo.wsUrl} />
        ) : capture ? (
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-sm dark:border-slate-800">
              <img
                src={capture.dataUrl}
                alt="Latest oscilloscope screenshot"
                className="block w-full h-auto max-h-[calc(100vh-14rem)] object-contain"
              />
            </div>
            <div className="absolute top-2 left-2 inline-flex items-center gap-2 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] text-white/80 backdrop-blur-sm">
              <ImageIcon size={10} />
              {new Date(capture.capturedAt).toLocaleString()}
              <span className="text-white/50">·</span>
              {formatBytes(capture.sizeBytes)}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
            {isCapturing ? (
              <Loader2 size={28} className="animate-spin text-sky-500" />
            ) : (
              <Camera size={28} className="text-slate-400 dark:text-slate-500" />
            )}
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {viewMode === 'vnc'
                  ? (vncConnecting ? 'Starting VNC session...' : 'VNC session not started')
                  : (isCapturing ? 'Capturing scope screen...' : 'No screenshot yet')}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {viewMode === 'vnc'
                  ? 'Click the VNC pill to start a live session. Screenshot mode stays separate.'
                  : 'Capture the scope screen to inspect it here and share with AI.'}
              </div>
            </div>
          </div>
        )}

        {/* Logs section - collapsible, below screenshot */}
        {hasLogs && !isVncViewActive && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
            >
              {showLogs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Terminal size={12} />
              Logs ({logLines.length} lines)
            </button>
            {showLogs && (
              <div className="max-h-[200px] overflow-auto bg-slate-50 dark:bg-slate-900/95 px-3 py-2 text-[10px] font-mono leading-4">
                {logLines.slice(-50).map((line, idx) => (
                  <div key={`live-log-${idx}`} className={`${getRunLogLineClass(line)} whitespace-pre-wrap break-words`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
