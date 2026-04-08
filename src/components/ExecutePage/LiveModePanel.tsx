import React, { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, MonitorSmartphone, RefreshCw, Settings, Terminal } from 'lucide-react';
import { clearStoredMcpHost, getStoredMcpHost, resolveMcpHost, resolveMcpHostCandidates, setStoredMcpHost } from '../../utils/ai/mcpClient';
import { VncViewer } from './VncViewer';

export interface LiveModeCapture {
  dataUrl: string;
  capturedAt: string;
  sizeBytes: number;
  mimeType: string;
}

interface LiveModePanelProps {
  viewMode: 'screenshot' | 'vnc';
  onChangeViewMode: (mode: 'screenshot' | 'vnc') => void;
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

export interface LiveModeToolbarProps {
  viewMode: 'screenshot' | 'vnc';
  onChangeViewMode: (mode: 'screenshot' | 'vnc') => void;
  isCapturing: boolean;
  autoRefresh: boolean;
  refreshInterval: number;
  vncAvailable?: boolean | null;
  vncActive?: boolean;
  vncConnecting?: boolean;
  vncSessionInfo?: { wsUrl: string; targetHost: string; targetPort: number; sessionId: string } | null;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  onChangeRefreshInterval: (seconds: number) => void;
  onToggleVnc?: () => void;
  instrumentOptions?: Array<{ id: string; label: string; detail?: string }>;
  selectedInstrumentId?: string | null;
  onSelectInstrument?: (id: string) => void;
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
  viewMode,
  onChangeViewMode,
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
  const logLines = (runLog || '').split(/\r?\n/).filter(Boolean);
  const hasLogs = logLines.length > 0;
  const isVncViewActive = viewMode === 'vnc' && vncActive && vncSessionInfo;

  return (
    <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-950">
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

export function LiveModeToolbar({
  viewMode,
  onChangeViewMode,
  isCapturing,
  autoRefresh,
  refreshInterval,
  vncAvailable = null,
  vncActive = false,
  vncConnecting = false,
  vncSessionInfo = null,
  onRefresh,
  onToggleAutoRefresh,
  onChangeRefreshInterval,
  onToggleVnc,
  instrumentOptions,
  selectedInstrumentId,
  onSelectInstrument,
}: LiveModeToolbarProps) {
  const canShowVncTab = Boolean(vncActive || vncAvailable);
  const [showMcpPill, setShowMcpPill] = useState(false);
  const [mcpHostInput, setMcpHostInput] = useState(() => getStoredMcpHost());
  const [mcpHostStatus, setMcpHostStatus] = useState<string | null>(null);
  const mcpPillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!showMcpPill) return;
      if (mcpPillRef.current && mcpPillRef.current.contains(event.target as Node)) return;
      setShowMcpPill(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMcpPill]);

  const normalizeMcpHost = (value: string): string => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withScheme.replace(/\/+$/, '');
  };

  const saveMcpHost = () => {
    const normalized = normalizeMcpHost(mcpHostInput);
    setMcpHostStatus(null);
    if (!normalized) {
      clearStoredMcpHost();
      setMcpHostStatus('Cleared MCP URL.');
      return;
    }
    setStoredMcpHost(normalized);
    setMcpHostStatus(`Saved MCP URL: ${normalized}`);
  };

  const testMcpHost = async () => {
    const normalized = normalizeMcpHost(mcpHostInput);
    const hosts = normalized ? [normalized] : resolveMcpHostCandidates();
    if (!hosts.length) {
      setMcpHostStatus('Enter an MCP URL first.');
      return;
    }
    setMcpHostStatus('Testing MCP...');
    try {
      let lastStatus = 'Failed to reach MCP host.';
      for (const host of hosts) {
        const res = await fetch(`${host.replace(/\/$/, '')}/health`);
        if (res.ok) {
          setMcpHostStatus(`MCP reachable at ${host}`);
          return;
        }
        lastStatus = `MCP responded with ${res.status} at ${host}.`;
      }
      setMcpHostStatus(lastStatus);
    } catch (err) {
      setMcpHostStatus(err instanceof Error ? err.message : 'Failed to reach MCP host.');
    }
  };

  return (
    <div className="relative z-30 flex items-center gap-2">
      <div className="relative flex items-center gap-1" ref={mcpPillRef}>
        <button
          type="button"
          onClick={() => setShowMcpPill((v) => !v)}
          className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          title="Configure MCP server"
        >
          <Settings size={12} />
        </button>
      </div>
      {showMcpPill && (
        <div
          className="fixed z-[9999] flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{
            top: mcpPillRef.current
              ? mcpPillRef.current.getBoundingClientRect().top + mcpPillRef.current.getBoundingClientRect().height / 2 - 16
              : 0,
            left: 8,
          }}
        >
          <input
            type="url"
            value={mcpHostInput}
            onChange={(e) => setMcpHostInput(e.target.value)}
            placeholder="MCP server URL"
            className="w-64 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:border-violet-500/60 dark:border-white/10 dark:bg-slate-800 dark:text-white"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={saveMcpHost}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void testMcpHost()}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
            >
              Test
            </button>
          </div>
          {mcpHostStatus && (
            <span className="text-[10px] text-cyan-600 dark:text-cyan-300 whitespace-nowrap">
              {mcpHostStatus}
            </span>
          )}
        </div>
      )}
      {instrumentOptions && instrumentOptions.length > 0 && (
        <select
          value={selectedInstrumentId || instrumentOptions[0]?.id}
          onChange={(e) => onSelectInstrument?.(e.target.value)}
          className="px-2 py-1 text-[11px] border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
          title="Choose which connected instrument to drive in Live Mode"
        >
          {instrumentOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}{opt.detail ? ` · ${opt.detail}` : ''}
            </option>
          ))}
        </select>
      )}
      {canShowVncTab ? (
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => onChangeViewMode('screenshot')}
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
            onClick={() => onChangeViewMode('vnc')}
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
          title={vncActive ? 'Stop VNC session' : 'Start VNC session'}
          aria-label={vncActive ? 'Stop VNC session' : 'Start VNC session'}
        >
          {vncConnecting ? <Loader2 size={12} className="animate-spin" /> : <MonitorSmartphone size={12} />}
          {vncActive ? 'VNC on' : 'VNC'}
        </button>
      ) : null}
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
  );
}
