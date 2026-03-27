import React, { useState, useEffect, useRef } from 'react';
import { Bot, KeyRound, Loader2, Paperclip, Play, Send, Settings, Sparkles, Terminal, X } from 'lucide-react';
import { parseAiActionResponse, type AiAction } from '../../utils/aiActions';
import type { ExecutionAuditReport } from '../../utils/executionAudit';
import type { StepPreview } from './StepsListPreview';
import { isMcpLocal } from '../../utils/ai/mcpClient';
import { useAiChat } from './useAiChat';
import type { TekMode } from './aiChatReducer';
import {
  clearStoredMcpHost,
  getStoredMcpHost,
  resolveMcpHost,
  resolveMcpHostCandidates,
  setStoredMcpHost,
  type McpChatAttachment,
} from '../../utils/ai/mcpClient';

interface AiChatPanelProps {
  steps: StepPreview[];
  runLog: string;
  code: string;
  executionSource: 'steps' | 'blockly' | 'live';
  runStatus: 'idle' | 'connecting' | 'running' | 'done' | 'error';
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    connectionType?: string;
    host?: string;
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
      visaBackend?: string;
      visaResource?: string;
    }>;
  };
  executorEndpoint?: { host: string; port: number } | null;
  instrumentEndpoint?: { executorUrl: string; visaResource: string; backend: string; liveMode?: boolean } | null;
  contextAttachments?: McpChatAttachment[];
  lastAuditReport?: ExecutionAuditReport | null;
  onApplyAiActions?: (actions: AiAction[]) => Promise<{ applied: number; rerunStarted: boolean; changed: boolean }>;
  onLiveScreenshot?: (screenshot: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string }) => void;
  onRun?: () => void;
}

const MAX_ATTACHMENT_COUNT = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_EXCERPT = 12000;
const INSTRUMENT_OUTPUT_MODE_STORAGE = 'tekautomate.ai.instrument_output_mode';

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'log', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf',
  'py', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'scss', 'sh', 'bat',
]);

function isTextAttachment(file: File): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true;
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  return Boolean(ext && TEXT_EXTENSIONS.has(ext));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read attachment as Data URL.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read attachment as text.'));
    reader.readAsText(file);
  });
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function AiChatPanel({
  steps,
  runLog,
  code,
  executionSource,
  runStatus,
  flowContext,
  executorEndpoint,
  instrumentEndpoint,
  contextAttachments = [],
  lastAuditReport,
  onApplyAiActions,
  onLiveScreenshot,
  onRun,
}: AiChatPanelProps) {
  const TRANSIENT_HINT_MS = 5500;
  const TRANSIENT_FADE_MS = 900;
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<McpChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applyStatusAt, setApplyStatusAt] = useState<number | null>(null);
  const [applyingTurnIndex, setApplyingTurnIndex] = useState<number | null>(null);
  const [quickActionsCollapsed, setQuickActionsCollapsed] = useState(true);
  const [testingKey, setTestingKey] = useState(false);
  const [testKeyStatus, setTestKeyStatus] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(560);
  const [mcpStatus, setMcpStatus] = useState<{ available: boolean; message?: string }>({ available: true });
  const [mcpHostInput, setMcpHostInput] = useState(() => resolveMcpHost());
  const [mcpHostStatus, setMcpHostStatus] = useState<string | null>(null);
  const [instrumentOutputMode, setInstrumentOutputMode] = useState<'clean' | 'verbose'>(() => {
    if (typeof window === 'undefined') return 'verbose';
    try {
      return window.localStorage.getItem(INSTRUMENT_OUTPUT_MODE_STORAGE) === 'clean' ? 'clean' : 'verbose';
    } catch {
      return 'verbose';
    }
  });
  const [transientUiNow, setTransientUiNow] = useState(() => Date.now());
  const prevStepsRef = useRef(steps);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const clearApplyStatus = () => {
    setApplyStatus(null);
    setApplyStatusAt(null);
  };

  const showApplyStatus = (message: string) => {
    setApplyStatus(message);
    setApplyStatusAt(Date.now());
  };

  const downloadPythonSnippet = (codeText: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`tekautomate_ai_${timestamp}.py`, codeText);
    showApplyStatus('Downloaded Python snippet.');
  };

  useEffect(() => {
    prevStepsRef.current = steps;
  }, [steps]);

  const {
    state,
    providerModels,
    quickActions,
    sendUserMessage,
    applyActionsFromTurn,
    clearChat,
    setApiKey,
    clearApiKey,
    setTekMode,
    setProvider,
    setModel,
    setToolCallMode,
  } = useAiChat({
    steps,
    runLog,
    code,
    executionSource,
    runStatus,
    flowContext,
    executorEndpoint,
    instrumentEndpoint,
    instrumentOutputMode,
    lastAuditReport,
    onLiveScreenshot,
    onApplyAiActions,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(INSTRUMENT_OUTPUT_MODE_STORAGE, instrumentOutputMode);
    } catch {
      // Ignore storage failures.
    }
  }, [instrumentOutputMode]);

  useEffect(() => {
    if (!state.apiKey.trim()) return; // need key for live
    if (executionSource !== 'live') return;
    if (state.tekMode === 'live') return;
    setTekMode('live');
  }, [executionSource, setTekMode, state.tekMode, state.apiKey]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.history, state.isLoading]);

  useEffect(() => {
    let active = true;
    const hosts = resolveMcpHostCandidates();
    if (!hosts.length) {
      setMcpStatus({
        available: false,
        message: 'MCP host is not configured. Add your local or hosted MCP URL in settings.',
      });
      return undefined;
    }
    const controllers: AbortController[] = [];
    const timeouts: number[] = [];
    (async () => {
      let lastFailure = 'MCP not reachable.';
      for (const host of hosts) {
        const controller = new AbortController();
        controllers.push(controller);
        const timeout = window.setTimeout(() => controller.abort(), 4000);
        timeouts.push(timeout);
        try {
          const res = await fetch(`${host.replace(/\/$/, '')}/health`, { signal: controller.signal });
          window.clearTimeout(timeout);
          if (!active) return;
          if (res.ok) {
            setMcpStatus({ available: true, message: `Connected to ${host}` });
            return;
          }
          lastFailure = `MCP unreachable (${res.status}). Host: ${host}`;
        } catch (err) {
          window.clearTimeout(timeout);
          lastFailure = `MCP not reachable. Host: ${host}. ${err instanceof Error ? err.message : ''}`.trim();
        }
      }
      if (!active) return;
      setMcpStatus({
        available: false,
        message: lastFailure,
      });
    })();
    return () => {
      active = false;
      for (const timeout of timeouts) window.clearTimeout(timeout);
      for (const controller of controllers) controller.abort();
    };
  }, [mcpHostInput]);

  useEffect(() => {
    const stored = getStoredMcpHost();
    const resolved = stored || resolveMcpHost();
    if (resolved && resolved !== mcpHostInput) {
      setMcpHostInput(resolved);
    }
  }, []);

  const normalizeMcpHost = (value: string): string => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/\/+$/, '');
  };

  const saveMcpHost = async () => {
    const normalized = normalizeMcpHost(mcpHostInput);
    setMcpHostStatus(null);
    if (!normalized) {
      clearStoredMcpHost();
      setMcpHostInput(resolveMcpHost());
      setMcpHostStatus('Cleared custom MCP URL. Using default resolution.');
      return;
    }
    setStoredMcpHost(normalized);
    setMcpHostInput(normalized);
    setMcpHostStatus(`Saved MCP URL: ${normalized}`);
  };

  const clearMcpHost = () => {
    clearStoredMcpHost();
    const fallback = resolveMcpHost();
    setMcpHostInput(fallback);
    setMcpHostStatus('Cleared custom MCP URL.');
  };

  const testMcpHostConnection = async () => {
    const normalized = normalizeMcpHost(mcpHostInput);
    const hosts = normalized ? [normalized] : resolveMcpHostCandidates();
    if (!hosts.length) {
      setMcpHostStatus('Enter an MCP URL first.');
      return;
    }
    setMcpHostStatus('Testing MCP connection...');
    try {
      let lastStatus = 'Failed to reach MCP host.';
      for (const host of hosts) {
        const res = await fetch(`${host}/health`);
        if (res.ok) {
          setMcpHostStatus(`MCP is reachable at ${host}`);
          return;
        }
        lastStatus = `MCP responded with ${res.status} at ${host}.`;
      }
      setMcpHostStatus(lastStatus);
    } catch (error) {
      setMcpHostStatus(error instanceof Error ? error.message : 'Failed to reach MCP host.');
    }
  };

  useEffect(() => {
    if (!applyStatus || applyStatusAt == null) return;
    const remainingMs = applyStatusAt + TRANSIENT_HINT_MS - Date.now();
    if (remainingMs <= 0) {
      clearApplyStatus();
      return;
    }
    const timeout = window.setTimeout(() => {
      clearApplyStatus();
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [applyStatus, applyStatusAt, TRANSIENT_HINT_MS]);

  useEffect(() => {
    const now = Date.now();
    setTransientUiNow(now);
    const expiryTimes: number[] = [];
    if (applyStatus && applyStatusAt != null) {
      expiryTimes.push(applyStatusAt + TRANSIENT_HINT_MS);
    }
    state.history.forEach((turn) => {
      if (turn.actions?.length && !turn.streaming && typeof turn.timestamp === 'number') {
        expiryTimes.push(turn.timestamp + TRANSIENT_HINT_MS);
      }
      if (typeof turn.appliedAt === 'number') {
        expiryTimes.push(turn.appliedAt + TRANSIENT_HINT_MS);
      }
    });
    const nextExpiry = expiryTimes
      .filter((value) => value > now)
      .sort((a, b) => a - b)[0];
    if (!nextExpiry) return;
    const timeout = window.setTimeout(() => {
      setTransientUiNow(Date.now());
    }, Math.max(60, nextExpiry - now + 40));
    return () => window.clearTimeout(timeout);
  }, [state.history, applyStatus, applyStatusAt, TRANSIENT_HINT_MS]);

  const modeSummary = state.tekMode === 'mcp'
    ? 'MCP — deterministic SCPI planner'
    : state.tekMode === 'live'
      ? 'Live — instrument copilot'
      : 'AI — conversational assistant';

  const interactionSummary = state.tekMode === 'mcp'
    ? 'Search commands, build flows, validate SCPI. No AI calls.'
    : state.tekMode === 'live'
      ? 'AI acts directly on your scope via tools.'
      : 'Chat about measurements and debugging. Say "build it" when ready.';

  const cleanAssistantDisplayText = (text: string): string => {
    return String(text || '')
      .replace(/`?\[(\d+)\]`?/g, '')
      .replace(/\[\d+\]\s*\[\d+\]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const formatTurnText = (turn: typeof state.history[number], text: string): string => {
      const shouldClean =
        turn.role === 'assistant' &&
        turn.routedVia === 'assistant';
      return shouldClean ? cleanAssistantDisplayText(text) : String(text || '').trim();
    };

    const stripStructuredPayloads = (text: string): string => {
      let next = String(text || '').trim();
      if (!next) return '';
      next = next.replace(/ACTIONS_JSON\s*:\s*\{[\s\S]*$/i, '').trim();
      next = next.replace(/```json\s*[\s\S]*?```/gi, '').trim();
      next = next.replace(/```(?:python|py)\s*[\s\S]*?```/gi, '').trim();
      const candidate = next.match(/\{[\s\S]*\}/);
      if (candidate?.[0]) {
        const parsed = parseAiActionResponse(candidate[0].trim());
        if (parsed?.actions?.length) {
          next = next.replace(candidate[0], '').trim();
        }
      }
      return next.trim();
    };

  const getReplaceFlowStepCount = (action: AiAction): number | null => {
    const payload = (action.payload || {}) as { steps?: unknown[]; flow?: { steps?: unknown[] } };
    const steps = Array.isArray(payload.steps)
      ? payload.steps
      : payload.flow && typeof payload.flow === 'object' && Array.isArray(payload.flow.steps)
        ? payload.flow.steps
        : null;
    if (!steps?.length) return null;
    const hasConnect = steps.some((step) => String((step as { type?: unknown })?.type || '').toLowerCase() === 'connect');
    const hasDisconnect = steps.some((step) => String((step as { type?: unknown })?.type || '').toLowerCase() === 'disconnect');
    return steps.length + (hasConnect ? 0 : 1) + (hasDisconnect ? 0 : 1);
  };

    const assistantBodyText = (turn: typeof state.history[number]): string => {
      const content = formatTurnText(turn, turn.content || '');
      if (content) {
        if (turn.actions?.length) {
          const stripped = stripStructuredPayloads(content);
          if (stripped) return stripped;
        } else {
          return content;
        }
      }
      if (turn.streaming) return 'Analyzing...';
      if (turn.summary) return formatAssistantSummary(turn);
      return 'Done.';
    };

  // Render inline markdown: **bold**, *italic*, `code`
  const renderInlineMarkdown = (text: string): React.ReactNode => {
    if (!text) return null;
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    while (remaining.length > 0) {
      // Find earliest match across bold, italic, inline code
      let earliest = remaining.length;
      let matchTag = '';
      let matchInner = '';
      let matchLen = 0;
      const patterns: Array<{ re: RegExp; tag: string }> = [
        { re: /\*\*([^*\n]+)\*\*/, tag: 'strong' },
        { re: /\*([^*\n]+)\*/, tag: 'em' },
        { re: /`([^`\n]+)`/, tag: 'code' },
      ];
      for (const { re, tag } of patterns) {
        const m = re.exec(remaining);
        if (m && m.index < earliest) {
          earliest = m.index;
          matchTag = tag;
          matchInner = m[1];
          matchLen = m[0].length;
        }
      }
      if (!matchTag) {
        parts.push(remaining);
        break;
      }
      if (earliest > 0) parts.push(remaining.slice(0, earliest));
      const k = `mk-${key++}`;
      if (matchTag === 'strong') {
        parts.push(<strong key={k} className="font-semibold text-slate-900 dark:text-white">{matchInner}</strong>);
      } else if (matchTag === 'em') {
        parts.push(<em key={k}>{matchInner}</em>);
      } else {
        parts.push(<code key={k} className="font-mono text-[11px] bg-slate-200 dark:bg-white/10 px-1 py-0.5 rounded text-violet-700 dark:text-violet-300">{matchInner}</code>);
      }
      remaining = remaining.slice(earliest + matchLen);
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  // Render markdown text for AI/Live mode responses
  const renderMarkdownBody = (text: string): React.ReactNode => {
    if (!text) return null;
    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Heading
      const hm = line.match(/^(#{1,3})\s+(.*)/);
      if (hm) {
        const level = hm[1].length;
        const cls = level === 1
          ? 'text-sm font-bold text-slate-900 dark:text-white mt-2 mb-0.5'
          : 'text-xs font-semibold text-slate-800 dark:text-white/90 mt-1.5';
        nodes.push(<div key={`h-${i}`} className={cls}>{renderInlineMarkdown(hm[2])}</div>);
        i++;
        continue;
      }
      // Bullet list — collect consecutive lines
      if (/^\s*[-*]\s/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s/, ''));
          i++;
        }
        nodes.push(
          <ul key={`ul-${i}`} className="my-1 space-y-0.5 pl-2">
            {items.map((item, idx) => (
              <li key={idx} className="flex gap-1.5 text-sm leading-relaxed">
                <span className="text-slate-400 dark:text-white/40 flex-shrink-0">•</span>
                <span>{renderInlineMarkdown(item)}</span>
              </li>
            ))}
          </ul>
        );
        continue;
      }
      // Numbered list
      if (/^\d+\.\s/.test(line)) {
        const items: Array<{ n: string; t: string }> = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          const m = lines[i].match(/^(\d+)\.\s(.*)/);
          if (m) items.push({ n: m[1], t: m[2] });
          i++;
        }
        nodes.push(
          <ol key={`ol-${i}`} className="my-1 space-y-0.5 pl-2">
            {items.map((item, idx) => (
              <li key={idx} className="flex gap-1.5 text-sm leading-relaxed">
                <span className="text-slate-400 dark:text-white/40 flex-shrink-0 font-mono text-xs min-w-[1.2rem]">{item.n}.</span>
                <span>{renderInlineMarkdown(item.t)}</span>
              </li>
            ))}
          </ol>
        );
        continue;
      }
      // Empty line
      if (!line.trim()) {
        nodes.push(<div key={`br-${i}`} className="h-0.5" />);
        i++;
        continue;
      }
      // Regular line
      nodes.push(<div key={`p-${i}`} className="text-sm leading-relaxed">{renderInlineMarkdown(line)}</div>);
      i++;
    }
    return <div className="space-y-0.5">{nodes}</div>;
  };

  const renderAssistantMessageContent = (text: string, tekMode?: string): React.ReactNode => {
    const source = String(text || '');
    const renderJsonDisclosure = (key: string, jsonText: string, label = 'JSON payload'): React.ReactNode => {
      const parsedActions = parseAiActionResponse(jsonText);
      const preview = jsonText.split('\n').slice(0, 3).join('\n');
      const summary = typeof parsedActions?.summary === 'string' ? parsedActions.summary.trim() : '';
      const findings = (parsedActions?.findings || []).filter(Boolean);
      const fixes = (parsedActions?.suggestedFixes || []).filter(Boolean);
      const actionCount = parsedActions?.actions?.length || 0;
      const extractActionStep = (action: AiAction): Record<string, unknown> | null => {
        if (action.action_type === 'replace_flow') {
          const flow = action.payload?.flow && typeof action.payload.flow === 'object'
            ? (action.payload.flow as Record<string, unknown>)
            : null;
          const flowSteps = flow && Array.isArray(flow.steps) ? (flow.steps as Record<string, unknown>[]) : [];
          return flowSteps.find((step) => {
            const type = String(step.type || '').toLowerCase();
            return type && type !== 'connect' && type !== 'disconnect';
          }) || flowSteps[0] || null;
        }
        if (action.payload?.new_step && typeof action.payload.new_step === 'object') {
          return action.payload.new_step as Record<string, unknown>;
        }
        if ((action.payload as Record<string, unknown> | undefined)?.newStep && typeof (action.payload as Record<string, unknown>).newStep === 'object') {
          return (action.payload as Record<string, unknown>).newStep as Record<string, unknown>;
        }
        return null;
      };
      const describeAction = (action: AiAction): string => {
        const step = extractActionStep(action);
        const stepLabel = typeof step?.label === 'string' ? step.label.trim() : '';
        const stepType = typeof step?.type === 'string' ? step.type.trim() : '';
        const targetId = typeof action.target_step_id === 'string' ? action.target_step_id.trim() : '';
        switch (action.action_type) {
          case 'insert_step_after':
            if (stepLabel) return `Insert "${stepLabel}"${targetId ? ` after ${targetId}` : ''}.`;
            if (stepType) return `Insert ${stepType} step${targetId ? ` after ${targetId}` : ''}.`;
            return 'Insert step.';
          case 'replace_step':
            if (stepLabel) return `Replace step with "${stepLabel}".`;
            if (stepType) return `Replace step with ${stepType} step.`;
            return 'Replace step.';
          case 'replace_flow': {
            const flow = action.payload?.flow && typeof action.payload.flow === 'object'
              ? (action.payload.flow as Record<string, unknown>)
              : null;
            const flowSteps = flow && Array.isArray(flow.steps) ? (flow.steps as Record<string, unknown>[]) : [];
            const meaningful = flowSteps.filter((item) => {
              const type = String(item.type || '').toLowerCase();
              return type && type !== 'connect' && type !== 'disconnect';
            });
            if (meaningful.length) {
              const labels = meaningful
                .slice(0, 3)
                .map((item) => String(item.label || item.type || 'step').trim())
                .filter(Boolean);
              return `Replace flow with ${meaningful.length} step${meaningful.length === 1 ? '' : 's'}${labels.length ? ` including ${labels.join(', ')}` : ''}.`;
            }
            return 'Replace the current flow.';
          }
          case 'set_step_param': {
            const param = typeof action.payload?.param === 'string' ? action.payload.param.trim() : 'parameter';
            return `Update ${param}${targetId ? ` on ${targetId}` : ''}.`;
          }
          case 'remove_step':
            return `Remove step${targetId ? ` ${targetId}` : ''}.`;
          case 'move_step': {
            const groupId = typeof action.payload?.target_group_id === 'string' ? action.payload.target_group_id.trim() : '';
            return `Move step${targetId ? ` ${targetId}` : ''}${groupId ? ` to ${groupId}` : ''}.`;
          }
          case 'add_error_check_after_step':
            return `Add error check${targetId ? ` after ${targetId}` : ''}.`;
          case 'replace_sleep_with_opc_query':
            return `Replace sleep${targetId ? ` on ${targetId}` : ''} with OPC query.`;
          default:
            return actionTitle(action);
        }
      };
      const actionDescriptions = (parsedActions?.actions || []).slice(0, 5).map(describeAction);
      const genericSummary = /built a server-side verified common tekautomate flow\.?|proposed flow\.?|generated flow\.?/i.test(summary);
      const displaySummary = summary && !genericSummary
        ? summary
        : actionDescriptions[0] || summary || '';
      const isActionsPayload = /actions_json/i.test(label) || actionCount > 0 || !!summary;
      return (
        <details key={key} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-white/80">
            <div className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <span className="text-[10px] font-normal text-slate-500 dark:text-white/45">Click to expand</span>
            </div>
            {isActionsPayload ? (
              <div className="mt-2 space-y-2">
                {!!displaySummary && (
                  <div className="whitespace-pre-wrap break-words text-[12px] font-medium text-slate-700 dark:text-white/85">
                    {displaySummary}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 text-[10px] font-normal">
                  {actionCount > 0 && (
                    <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
                      {actionCount} {actionCount === 1 ? 'change' : 'changes'}
                    </span>
                  )}
                  {findings.length > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      {findings.length} finding{findings.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {fixes.length > 0 && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {fixes.length} suggestion{fixes.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] font-normal text-slate-500 dark:text-white/35">
                {preview}
              </div>
            )}
          </summary>
          {isActionsPayload ? (
            <div className="space-y-3 border-t border-slate-200 dark:border-white/10 px-3 py-3 rounded-b-xl">
              {!!summary && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">Summary</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-700 dark:text-white/85">
                    {displaySummary}
                  </div>
                </div>
              )}
              {!!actionDescriptions.length && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">Changes</div>
                  <div className="mt-1 space-y-1">
                    {actionDescriptions.map((description, index) => (
                      <div key={`${key}-action-${index}`} className="text-[12px] leading-relaxed text-slate-700 dark:text-white/80">
                        - {description}
                      </div>
                    ))}
                    {(parsedActions?.actions?.length || 0) > actionDescriptions.length && (
                      <div className="text-[11px] text-slate-500 dark:text-white/45">
                        + {(parsedActions?.actions?.length || 0) - actionDescriptions.length} more
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!!findings.length && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">Findings</div>
                  <div className="mt-1 space-y-1">
                    {findings.map((finding, index) => (
                      <div key={`${key}-finding-${index}`} className="text-[12px] leading-relaxed text-slate-700 dark:text-white/80">
                        - {finding}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!!fixes.length && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">Suggested Fixes</div>
                  <div className="mt-1 space-y-1">
                    {fixes.map((fix, index) => (
                      <div key={`${key}-fix-${index}`} className="text-[12px] leading-relaxed text-slate-700 dark:text-white/80">
                        - {fix}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <details className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/20">
                <summary className="cursor-pointer list-none px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">
                  Raw JSON
                </summary>
                <pre className="overflow-x-auto border-t border-slate-200 dark:border-white/10 px-3 py-3 text-[11px] leading-relaxed text-slate-100 bg-slate-900 rounded-b-lg">
                  <code>{jsonText}</code>
                </pre>
              </details>
            </div>
          ) : (
            <pre className="overflow-x-auto border-t border-slate-200 dark:border-white/10 px-3 py-3 text-[11px] leading-relaxed text-slate-100 bg-slate-900 rounded-b-xl">
              <code>{jsonText}</code>
            </pre>
          )}
        </details>
      );
    };
    const findBalancedJson = (
      raw: string,
      startIndex: number
    ): { json: string; end: number } | null => {
      const openChar = raw[startIndex];
      if (openChar !== '{' && openChar !== '[') return null;
      const closeChar = openChar === '{' ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = startIndex; i < raw.length; i += 1) {
        const ch = raw[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === openChar) depth += 1;
        if (ch === closeChar) {
          depth -= 1;
          if (depth === 0) {
            return { json: raw.slice(startIndex, i + 1), end: i + 1 };
          }
        }
      }
      return null;
    };
    // ── SCPI command cards ──
    const scpiMatch = source.match(/SCPI_COMMANDS:/);
    if (scpiMatch?.index !== undefined) {
      const before = source.slice(0, scpiMatch.index).trim();
      const jsonStr = source.slice(scpiMatch.index + 'SCPI_COMMANDS:'.length).trim();
      try {
        const cards = JSON.parse(jsonStr) as Array<{
          header: string;
          description: string;
          set: string | null;
          query: string | null;
          type: string;
          group: string;
          families: string[];
          example: string;
        }>;
        return (
          <div className="space-y-2">
            {!!before && <div className="text-xs text-slate-600 dark:text-white/70">{before}</div>}
            {cards.map((card, idx) => (
              <div
                key={`scpi-card-${idx}`}
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] overflow-hidden"
              >
                <div className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate" title={card.header}>
                      {card.header}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-white/50 line-clamp-1">
                      {card.description}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {card.query && (
                      <button
                        type="button"
                        onClick={() => {
                          const queryCmd = card.query!.replace(/\s*<[^>]+>/g, '').trim();
                          void onApplyAiActions?.([{
                            id: `scpi-q-${idx}-${Date.now()}`,
                            action_type: 'insert_step_after',
                            target_step_id: undefined,
                            confidence: 'high',
                            reason: `Add query: ${card.header}`,
                            payload: {
                              newStep: { type: 'query', label: card.header + '?', params: { command: queryCmd, saveAs: 'result' } },
                            },
                          }]);
                          showApplyStatus(`Added query: ${card.header}`);
                        }}
                        className="rounded-md border border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/30 px-2 py-1 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition-colors"
                      >
                        + Query
                      </button>
                    )}
                    {card.set && (
                      <button
                        type="button"
                        onClick={() => {
                          void onApplyAiActions?.([{
                            id: `scpi-w-${idx}-${Date.now()}`,
                            action_type: 'insert_step_after',
                            target_step_id: undefined,
                            confidence: 'high',
                            reason: `Add write: ${card.header}`,
                            payload: {
                              newStep: { type: 'write', label: card.header, params: { command: card.example } },
                            },
                          }]);
                          showApplyStatus(`Added write: ${card.header}`);
                        }}
                        className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-2 py-1 text-[10px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                      >
                        + Write
                      </button>
                    )}
                  </div>
                </div>
                {(card.set || card.query) && (
                  <div className="border-t border-slate-100 dark:border-white/5 px-3 py-1.5 bg-slate-50 dark:bg-white/[0.02]">
                    <div className="text-[10px] font-mono text-slate-500 dark:text-white/40 truncate">
                      {card.set || card.query}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      } catch {
        // Fall through to normal rendering if JSON parse fails
      }
    }

    const useMarkdown = tekMode === 'ai' || tekMode === 'live';
    const renderProse = (t: string) => useMarkdown
      ? renderMarkdownBody(t)
      : <div className="whitespace-pre-wrap break-words">{t}</div>;

    const markerMatch = source.match(/ACTIONS_JSON:\s*/i);
    if (markerMatch?.index !== undefined) {
      const markerIndex = markerMatch.index;
      const jsonStart = source.indexOf('{', markerIndex + markerMatch[0].length);
      const balanced = jsonStart >= 0 ? findBalancedJson(source, jsonStart) : null;
      if (balanced) {
        const before = source.slice(0, markerIndex).trim();
        const after = source.slice(balanced.end).trim();
        return (
          <div className="space-y-3">
            {!!before && renderProse(before)}
            {renderJsonDisclosure(`actions-${markerIndex}`, balanced.json, 'ACTIONS_JSON payload')}
            {!!after && renderProse(after)}
          </div>
        );
      }
    }
    const trimmed = source.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return <div className="space-y-3">{renderJsonDisclosure('raw-json', trimmed)}</div>;
    }
    const blockPattern = /```([a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(source)) !== null) {
      const prose = source.slice(cursor, match.index);
      if (prose) {
        parts.push(
          <div key={`prose-${cursor}`}>
            {renderProse(prose)}
          </div>
        );
      }
      const language = String(match[1] || '').trim();
      const code = match[2].replace(/\n$/, '');
      const isJsonBlock = language.toLowerCase() === 'json' || /^[[{]/.test(code.trim());
      const isPythonBlock = /^(python|py)$/i.test(language);
      parts.push(
        isJsonBlock
          ? renderJsonDisclosure(`code-${match.index}`, code, language ? `${language} payload` : 'JSON payload')
          : (
            <div key={`code-${match.index}`} className="space-y-1">
              {(!!language || isPythonBlock) && (
                <div className="flex items-center justify-between gap-3">
                  {!!language && (
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/35">
                      {language}
                    </div>
                  )}
                  {isPythonBlock && (
                    <button
                      type="button"
                      onClick={() => downloadPythonSnippet(code)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/10 dark:text-white/60 dark:hover:border-cyan-400/50 dark:hover:text-cyan-200"
                    >
                      Download .py
                    </button>
                  )}
                </div>
              )}
              <pre className="overflow-x-auto rounded-xl bg-slate-900 px-3 py-3 text-[11px] leading-relaxed text-slate-100">
                <code>{code}</code>
              </pre>
            </div>
          )
      );
      cursor = match.index + match[0].length;
    }
    const tail = source.slice(cursor);
    if (tail || !parts.length) {
      parts.push(
        <div key={`tail-${cursor}`}>
          {renderProse(tail || source)}
        </div>
      );
    }
    return <div className="space-y-3">{parts}</div>;
  };

  const openAttachmentPicker = () => {
    attachmentInputRef.current?.click();
  };

  const removeAttachment = (name: string) => {
    setAttachments((prev) => prev.filter((item) => item.name !== name));
  };

  const handleAttachmentSelection = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    setAttachmentError(null);

    if (attachments.length + incoming.length > MAX_ATTACHMENT_COUNT) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENT_COUNT} files per message.`);
      return;
    }

    const tooLarge = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge) {
      setAttachmentError(`${tooLarge.name} is larger than 8 MB. Please attach a smaller file.`);
      return;
    }

    try {
      const mapped = await Promise.all(
        incoming.map(async (file): Promise<McpChatAttachment> => {
          const mimeType = file.type || 'application/octet-stream';
          const isImage = mimeType.startsWith('image/');
          const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          const item: McpChatAttachment = {
            name: file.name,
            mimeType,
            size: file.size,
          };
          if (isImage || isPdf) {
            item.dataUrl = await readFileAsDataUrl(file);
          }
          if (isTextAttachment(file)) {
            const text = await readFileAsText(file);
            item.textExcerpt = text.slice(0, MAX_TEXT_EXCERPT);
          }
          return item;
        })
      );
      setAttachments((prev) => [...prev, ...mapped]);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Failed to read selected attachment.');
    } finally {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
    }
  };

  const handleSend = () => {
    const next = input.trim();
    if (!next && attachments.length === 0 && contextAttachments.length === 0) return;
    // All modes route through MCP server (avoids browser CORS issues with AI APIs)
    if (!mcpStatus.available) {
      showApplyStatus(mcpStatus.message || 'MCP not reachable. Check MCP server URL in settings.');
      return;
    }
    // Live mode with hosted MCP can't reach local executor — warn user
    if (state.tekMode === 'live' && !isMcpLocal()) {
      showApplyStatus('Live mode requires local MCP server. The hosted MCP cannot reach your local executor. Switch MCP host to localhost:8787 in settings.');
      return;
    }
    setQuickActionsCollapsed(true);
    setInput('');
    setAttachmentError(null);
    const message = next || 'Use attached files as context.';
    const pendingAttachments = [...contextAttachments, ...attachments];
    setAttachments([]);
    void sendUserMessage(message, [], { attachments: pendingAttachments });
  };

  const formatAssistantSummary = (turn: typeof state.history[number]): string => {
    const narrative = formatTurnText(turn, (turn.content || '')
      .replace(/ACTIONS_JSON:\s*[\s\S]*$/i, '')
      .trim());
    const base = formatTurnText(turn, turn.summary || narrative || turn.content || 'Done.');
    if (!turn.actions?.length || turn.appliedAt || turn.noOpAt) {
      // Prefer full narrative text when no flow actions are proposed.
      return narrative || base;
    }
    return base
      .replace(/^I(?:'ve| have)\s+/i, 'Proposed: ')
      .replace(/^I\s+will\s+/i, 'Proposed: ')
      .replace(/^Added\b/i, 'Proposed additions:')
      .replace(/^Rebuilt\b/i, 'Proposed rebuild:')
      .replace(/^Updated\b/i, 'Proposed update:')
      .replace(/^Fixed\b/i, 'Proposed fix:');
  };

  const actionTitle = (action: AiAction): string => {
    switch (action.action_type) {
      case 'set_step_param':
        return 'Update step parameter';
      case 'insert_step_after':
        return 'Insert step';
      case 'remove_step':
        return 'Remove step';
      case 'replace_step':
        return 'Replace step';
      case 'move_step':
        return 'Move step';
      case 'replace_flow':
        return 'Proposed flow';
      case 'add_error_check_after_step':
        return 'Add error check';
      case 'replace_sleep_with_opc_query':
        return 'Replace sleep with OPC query';
      default:
        return action.action_type;
    }
  };

  const shortText = (value: unknown, max = 80): string => {
    const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  };

  const isIncrementalUserIntentAt = (assistantTurnIndex: number): boolean => {
    if (assistantTurnIndex <= 0) return false;
    const prev = state.history[assistantTurnIndex - 1];
    if (!prev || prev.role !== 'user') return false;
    const text = String(prev.content || '').toLowerCase();
    return /\b(add|insert|append|extend|keep|retain|don['’]?t replace|do not replace|existing flow|just add)\b/.test(text);
  };

  const actionDetail = (action: AiAction, assistantTurnIndex?: number): string => {
    const payload = (action.payload || {}) as Record<string, unknown>;
    if (action.action_type === 'set_step_param') {
      const param = String(payload.param || 'param');
      const value = shortText(payload.value, 70);
      return `${param} = ${value}`;
    }
    if (action.action_type === 'insert_step_after' || action.action_type === 'replace_step') {
      const step = (payload.new_step || payload.newStep || {}) as Record<string, unknown>;
      const stepType = String(step.type || 'step');
      const label = shortText(step.label || '', 60);
      const cmd = shortText((step.params as Record<string, unknown> | undefined)?.command || '', 90);
      if (cmd) return `${stepType}${label ? ` (${label})` : ''} - ${cmd}`;
      if (label) return `${stepType} (${label})`;
      return stepType;
    }
    if (action.action_type === 'replace_flow') {
      const count = getReplaceFlowStepCount(action);
      if (typeof assistantTurnIndex === 'number' && isIncrementalUserIntentAt(assistantTurnIndex)) {
        return count
          ? `Proposes replacing the current flow with a ${count}-step payload (incremental request detected).`
          : 'Proposes replacing the current flow (incremental request detected).';
      }
      return count
        ? `Proposes a ${count}-step flow payload for the workspace`
        : 'Proposes a new flow payload for the workspace';
    }
    if (action.action_type === 'move_step') {
      const afterId = shortText(payload.after_step_id || payload.afterStepId || payload.position, 40);
      return afterId ? `Move near ${afterId}` : 'Reorder step';
    }
    return '';
  };

  const applyButtonLabel = (turn: typeof state.history[number]): string => {
    const actionCount = turn.actions?.length || 0;
    if (!actionCount) return 'Apply';
    if (actionCount === 1 && turn.actions?.[0]?.action_type === 'replace_flow') {
      const stepCount = getReplaceFlowStepCount(turn.actions[0]);
      return stepCount ? `Use this ${stepCount}-step flow` : 'Use this flow';
    }
    return `Apply ${actionCount} ${actionCount === 1 ? 'change' : 'changes'}`;
  };

  const applyHintText = (turn: typeof state.history[number]): string => {
    if (!turn.actions?.length) return '';
    if (turn.actions.length === 1 && turn.actions[0].action_type === 'replace_flow') {
      return 'A proposed flow is below. Click `Use this flow` to add it to the workspace.';
    }
    return 'Proposed changes are below. Click `Apply` to update the flow.';
  };

  const isTransientVisible = (startedAt?: number | null): boolean => {
    return typeof startedAt === 'number' && transientUiNow - startedAt < TRANSIENT_HINT_MS;
  };

  const transientOpacity = (startedAt?: number | null): number => {
    if (typeof startedAt !== 'number') return 0;
    const remainingMs = startedAt + TRANSIENT_HINT_MS - transientUiNow;
    if (remainingMs <= 0) return 0;
    if (remainingMs >= TRANSIENT_FADE_MS) return 1;
    return Math.max(0, remainingMs / TRANSIENT_FADE_MS);
  };

  const testProviderKey = async () => {
    setTestKeyStatus(null);
    const trimmedKey = state.apiKey.trim();
    if (!trimmedKey) {
      setTestKeyStatus('Enter API key first.');
      return;
    }
    setTestingKey(true);
    try {
      const hosts = resolveMcpHostCandidates();
      const host = hosts[0];
      if (!host) {
        setTestKeyStatus('MCP host not configured. Set localStorage key "tekautomate.mcp.host" to your HTTPS MCP URL.');
        return;
      }
      const baseHost = host.replace(/\/$/, '');
      const shouldTestHostedRoute = state.provider === 'openai';
      const runLegacyChatTest = async () =>
        fetch(`${baseHost}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: shouldTestHostedRoute
              ? 'Reply with exactly: HOSTED_OK'
              : 'Reply with exactly: OK',
            outputMode: 'steps_json',
            provider: state.provider,
            apiKey: trimmedKey,
            model: state.model || providerModels[0],
            openaiAssistantId: shouldTestHostedRoute ? '__SERVER_DEFAULT_ASSISTANT__' : undefined,
            flowContext: {
              backend: 'pyvisa',
              host: '127.0.0.1',
              connectionType: 'tcpip',
              modelFamily: 'unknown',
              steps: [],
              selectedStepId: null,
              executionSource: executionSource || 'steps',
            },
            runContext: {
              runStatus: runStatus || 'idle',
              logTail: '',
              auditOutput: '',
              exitCode: null,
            },
            history: [],
          }),
        });

      let res = shouldTestHostedRoute
        ? await runLegacyChatTest()
        : await fetch(`${baseHost}/ai/key-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: state.provider,
              apiKey: trimmedKey,
              model: state.model || providerModels[0],
            }),
          });

      if (res.status === 404) {
        res = await runLegacyChatTest();
      }

      let data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        code?: string;
        hint?: string;
      };

      if (data?.code === 'integer_below_min_value') {
        res = await runLegacyChatTest();
        data = (await res.json()) as typeof data;
      }

      if (!res.ok || !data.ok) {
        const details = [data?.code, data?.error, data?.message, data?.hint].filter(Boolean).join(' | ');
        setTestKeyStatus(`Failed: ${details || `HTTP ${res.status}`}`);
        return;
      }
      setTestKeyStatus(
        shouldTestHostedRoute
          ? 'Success: hosted Responses route accepted.'
          : 'Success: provider/key/model accepted.'
      );
    } catch (err) {
      setTestKeyStatus(err instanceof Error ? `Failed: ${err.message}` : 'Failed: test request error.');
    } finally {
      setTestingKey(false);
    }
  };

  return (
    <aside
      className="flex-shrink-0 border-r border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/90 flex flex-col min-h-0"
      style={{ width: panelWidth, position: 'relative' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Bot size={14} className="text-cyan-600 dark:text-cyan-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">AI Assistant</div>
              <div className="text-[10px] text-slate-500 dark:text-white/50">
                {modeSummary}
              </div>
              {!mcpStatus.available && (
                <div className="text-[10px] text-amber-600 dark:text-amber-300">MCP offline</div>
              )}
            </div>
        </div>
        <div className="flex items-center gap-2">
          {state.tekMode !== 'live' && (
          <button
            type="button"
            onClick={onRun}
            disabled={!onRun || runStatus === 'running' || runStatus === 'connecting'}
            className="text-[10px] px-2 py-1 rounded bg-gradient-to-r from-violet-600 to-cyan-600 text-white disabled:opacity-40"
            title="Run current flow on scope"
          >
            <span className="inline-flex items-center gap-1">
              <Play size={10} />
              {runStatus === 'running' || runStatus === 'connecting' ? 'Running...' : 'Run on scope'}
            </span>
          </button>
          )}
          <div className="hidden sm:flex items-center rounded-full border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => setTekMode('mcp')}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                state.tekMode === 'mcp'
                  ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200'
                  : 'text-slate-500 dark:text-white/55 hover:text-slate-800 dark:hover:text-white/85'
              }`}
              title="Switch to MCP mode."
            >
              MCP
            </button>
            <button
              type="button"
              onClick={() => { if (!state.apiKey.trim()) { showApplyStatus('Set an API key first.'); } else setTekMode('ai'); }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                state.tekMode === 'ai'
                  ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-200'
                  : 'text-slate-500 dark:text-white/55 hover:text-slate-800 dark:hover:text-white/85'
              }`}
              title="Switch to AI conversational mode."
            >
              AI
            </button>
            {executionSource === 'live' && (
              <button
                type="button"
                onClick={() => { if (!state.apiKey.trim()) { showApplyStatus('Set an API key first.'); } else setTekMode('live'); }}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  state.tekMode === 'live'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : 'text-slate-500 dark:text-white/55 hover:text-slate-800 dark:hover:text-white/85'
                }`}
                title="Switch to live conversation mode with tools and screenshots."
              >
                Live
              </button>
            )}
          </div>
          {state.tekMode === 'live' && (
            <button
              type="button"
              onClick={() => setShowLiveLogs((v) => !v)}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                showLiveLogs
                  ? 'border-amber-500/50 text-amber-600 bg-amber-500/10 dark:text-amber-300'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/70'
              }`}
              title="Toggle execution logs"
            >
              <Terminal size={10} />
              Logs
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80 transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

            {showSettings && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-4">

          {/* ── Provider & Keys ── */}
          {(['openai', 'anthropic'] as const).map((pid) => {
            const isActive = state.provider === pid;
            const label = pid === 'openai' ? 'OpenAI' : 'Claude';
            const placeholder = pid === 'anthropic' ? 'sk-ant-...' : 'sk-...';
            const hasKey = pid === 'openai' ? state.openaiApiKey.trim().length > 0 : state.anthropicApiKey.trim().length > 0;
            return (
              <div
                key={pid}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  isActive
                    ? 'border-violet-400/50 dark:border-violet-500/30 bg-white dark:bg-white/[0.03]'
                    : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setProvider(pid)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    {isActive && <span className="h-2 w-2 rounded-full bg-violet-500" />}
                    <span className={`text-[11px] font-semibold ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50'}`}>
                      {label}
                    </span>
                    {hasKey && !isActive && (
                      <span className="inline-flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400">
                        <span className="h-1 w-1 rounded-full bg-emerald-500" />
                        key set
                      </span>
                    )}
                  </div>
                  {isActive && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300 font-medium">Active</span>
                  )}
                </button>
                {isActive && (
                  <div className="px-3 pb-2.5 space-y-2 border-t border-slate-100 dark:border-white/5 pt-2">
                    <select
                      value={state.model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-1.5 text-xs text-slate-700 dark:text-white/80 focus:outline-none focus:border-violet-500/50"
                    >
                      {!providerModels.includes(state.model) && state.model ? (
                        <option value={state.model}>{state.model}</option>
                      ) : null}
                      {providerModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div className="relative">
                      <KeyRound className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-white/30" />
                      <input
                        type="password"
                        value={state.apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 py-1.5 pl-8 pr-8 text-xs text-slate-700 dark:text-white/80 placeholder-slate-300 dark:placeholder-white/20 focus:outline-none focus:border-violet-500/50"
                        placeholder={placeholder}
                      />
                      {!!state.apiKey && (
                        <button type="button" onClick={clearApiKey} className="absolute right-2 top-1.5 text-slate-300 dark:text-white/30 hover:text-slate-600 dark:hover:text-white/60" title="Clear key">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      {testKeyStatus && (
                        <span className="text-[10px] text-slate-500 dark:text-white/50 truncate max-w-[200px]">{testKeyStatus}</span>
                      )}
                      {!testKeyStatus && !!state.apiKey && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Key saved
                        </span>
                      )}
                      {!testKeyStatus && !state.apiKey && <span />}
                      <button
                        type="button"
                        onClick={() => void testProviderKey()}
                        disabled={testingKey || !state.apiKey}
                        className="text-[10px] px-2 py-1 rounded-md bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-40 transition-colors"
                      >
                        {testingKey ? 'Testing...' : 'Test'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Advanced ── */}
          <details className="group">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60 select-none">
              Advanced
            </summary>
            <div className="mt-2 space-y-2.5 pl-0.5">
              <label className="block">
                <span className="text-[10px] text-slate-500 dark:text-white/50">MCP server</span>
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="url"
                    value={mcpHostInput}
                    onChange={(e) => setMcpHostInput(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-1.5 text-xs text-slate-700 dark:text-white/80 placeholder-slate-300 dark:placeholder-white/20 focus:outline-none focus:border-violet-500/50"
                    placeholder="https://..."
                  />
                  <button type="button" onClick={() => void saveMcpHost()} className="text-[10px] px-2 py-1 rounded-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10">Save</button>
                  <button type="button" onClick={() => void testMcpHostConnection()} className="text-[10px] px-2 py-1 rounded-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10">Test</button>
                </div>
                {mcpHostStatus && (
                  <p className="mt-1 text-[10px] text-cyan-600 dark:text-cyan-400">{mcpHostStatus}</p>
                )}
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-500 dark:text-white/50">Executor output</span>
                <select
                  value={instrumentOutputMode}
                  onChange={(e) => setInstrumentOutputMode(e.target.value === 'clean' ? 'clean' : 'verbose')}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-1.5 text-xs text-slate-700 dark:text-white/80 focus:outline-none focus:border-violet-500/50"
                >
                  <option value="verbose">Verbose</option>
                  <option value="clean">Clean</option>
                </select>
              </label>
              <label
                className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-white/50"
                title="AI handles tools directly, bypassing planner/shortcut interception."
              >
                <span>Tool-call mode</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(state.toolCallMode)}
                  onClick={() => setToolCallMode(!state.toolCallMode)}
                  className={`relative h-4 w-8 rounded-full transition-colors ${
                    state.toolCallMode
                      ? 'bg-cyan-500'
                      : 'bg-slate-300 dark:bg-white/20'
                  }`}
                >
                  <span
                    className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                    style={{ left: state.toolCallMode ? '18px' : '2px' }}
                  />
                </button>
              </label>
            </div>
          </details>

        </div>
      )}
      <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5">
        {!mcpStatus.available && (
          <div className="mb-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700 px-3 py-2 text-[11px]">
            MCP not reachable. {mcpStatus.message || 'Check MCP host and try again.'}
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/30">
            Quick Actions
          </div>
          <button
            type="button"
            onClick={() => setQuickActionsCollapsed((v) => !v)}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"
          >
            {quickActionsCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {!quickActionsCollapsed && (
          <div className="grid grid-cols-2 gap-1.5">
            {quickActions.map((qa) => (
              <button
                key={qa.id}
                type="button"
                onClick={() => {
                  setQuickActionsCollapsed(true);
                  setInput(qa.promptTemplate);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                disabled={state.isLoading}
                className="flex min-h-[34px] items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-white/70 hover:text-slate-900 dark:hover:text-white text-[11px] font-medium transition-colors text-left disabled:opacity-40"
              >
                <Sparkles size={10} className="text-violet-400 flex-shrink-0" />
                <span className="line-clamp-1 leading-tight">{qa.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-auto py-2 space-y-0.5">
        {state.history.length === 0 ? (
          <div className="mx-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3 text-xs text-slate-400 dark:text-white/40">
            {state.tekMode === 'mcp'
              ? 'MCP mode: search SCPI commands, build flows, and validate steps without AI.'
              : state.tekMode === 'live'
                ? 'Live mode: AI can see your scope, send commands, and capture screenshots.'
                : 'AI mode: chat about your measurement problem, then say "build it" when ready.'}
          </div>
        ) : (
          state.history.map((turn, turnIndex) => (
            <div key={`chat-turn-${turnIndex}`}>
              {turn.role === 'user' ? (
                <div className="flex justify-end px-3 py-1">
                  <div className="max-w-[85%] bg-violet-100 dark:bg-violet-600/30 border border-violet-300 dark:border-violet-500/30 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-violet-900 dark:text-white/90">
                    {turn.isStandaloneQuickAction && (
                      <div className="mb-1 inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                        Standalone Quick Action
                      </div>
                    )}
                    {turn.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 px-3 py-1">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={13} className="text-cyan-600 dark:text-cyan-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-slate-800 dark:text-white/80">
                      {renderAssistantMessageContent(assistantBodyText(turn), turn.tekMode)}
                    </div>
                    {!!turn.actions?.length && !turn.streaming && !turn.appliedAt && !turn.noOpAt && isTransientVisible(turn.timestamp) && (
                      <div
                        className="mt-1 ml-2 text-[11px] text-violet-700 transition-opacity duration-300 dark:text-violet-300"
                        style={{ opacity: transientOpacity(turn.timestamp) }}
                      >
                        {applyHintText(turn)}
                      </div>
                    )}
                    {turn.role === 'assistant' &&
                      state.history[turnIndex - 1]?.role === 'user' &&
                      state.history[turnIndex - 1]?.isStandaloneQuickAction && (
                        <div className="mt-1 ml-2 text-[11px] text-cyan-700 dark:text-cyan-300">
                          Standalone Quick Action mode (no prior chat history attached).
                        </div>
                      )}
                    {!!turn.appliedAt && isTransientVisible(turn.appliedAt) && (
                      <div
                        className="mt-1 ml-2 text-[11px] text-emerald-700 transition-opacity duration-300 dark:text-emerald-300"
                        style={{ opacity: transientOpacity(turn.appliedAt) }}
                      >
                        Changes applied to the current flow.
                      </div>
                    )}
                    {!!turn.noOpAt && isTransientVisible(turn.noOpAt) && (
                      <div
                        className="mt-1 ml-2 text-[11px] text-slate-600 transition-opacity duration-300 dark:text-white/60"
                        style={{ opacity: transientOpacity(turn.noOpAt) }}
                      >
                        Proposed flow already matches the current workspace.
                      </div>
                    )}
                    {turn.streaming && (
                      <div className="flex gap-1 mt-1.5 ml-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {turn.role === 'assistant' && !!turn.findings?.length && (
                <div className="mx-3 mb-1 ml-11">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 space-y-1">
                    {turn.findings.slice(0, 4).map((f, i) => (
                      <div key={`finding-${turnIndex}-${i}`} className="text-xs text-amber-800 dark:text-amber-200/80 flex gap-1.5">
                        <span className="text-amber-600 dark:text-amber-400 mt-0.5">!</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {turn.role === 'assistant' && !!turn.suggestedFixes?.length && (
                <div className="mx-3 mb-1 ml-11">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 space-y-1">
                    {turn.suggestedFixes.slice(0, 4).map((f, i) => (
                      <div key={`fix-${turnIndex}-${i}`} className="text-xs text-emerald-800 dark:text-emerald-200/80 flex gap-1.5">
                        <span className="text-emerald-600 dark:text-emerald-400 mt-0.5">+</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {turn.role === 'assistant' && !!turn.actions?.length && !turn.streaming && !turn.noOpAt && (
                <div className="mx-3 mb-2 ml-11 space-y-1.5">
                  <div className="text-[10px] text-slate-400 dark:text-white/30 uppercase tracking-wide px-1">Suggested changes</div>
                  {turn.actions.slice(0, 5).map((action, ai) => (
                    <div
                      key={action.id || ai}
                      className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs text-slate-800 dark:text-white/85 font-semibold">
                          {actionTitle(action)}
                        </div>
                        {!!actionDetail(action, turnIndex) && (
                          <div className="text-[11px] text-slate-600 dark:text-white/60 break-words">
                            {actionDetail(action, turnIndex)}
                          </div>
                        )}
                        {action.target_step_id && (
                          <div className="text-[10px] text-slate-400 dark:text-white/30 font-mono break-all">
                            Target: {action.target_step_id}
                          </div>
                        )}
                        {action.reason && (
                          <div className="text-[10px] text-slate-500 dark:text-white/40 break-words">{action.reason}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      clearApplyStatus();
                      setApplyingTurnIndex(turnIndex);
                      try {
                        const msg = await applyActionsFromTurn(turnIndex);
                        showApplyStatus(msg);
                      } catch (err) {
                        showApplyStatus(err instanceof Error ? err.message : 'Failed to apply actions.');
                      } finally {
                        setApplyingTurnIndex(null);
                      }
                    }}
                    disabled={applyingTurnIndex !== null || !!turn.appliedAt || !!turn.noOpAt}
                    className="w-full py-2 rounded-xl border border-white/10 bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-xs font-semibold shadow-sm transition-all hover:from-violet-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {turn.appliedAt
                      ? 'Applied'
                      : turn.noOpAt
                        ? 'Already current'
                      : applyingTurnIndex === turnIndex
                        ? 'Applying...'
                        : (turn.actions?.length === 1 &&
                            turn.actions[0].action_type === 'replace_flow' &&
                            isIncrementalUserIntentAt(turnIndex))
                          ? 'Review replace-flow suggestion'
                          : applyButtonLabel(turn)}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {showLiveLogs && state.tekMode === 'live' && (
        <div className="border-t border-amber-200 dark:border-amber-800/40 bg-slate-50 dark:bg-slate-900/80 max-h-[150px] overflow-auto">
          <div className="px-3 py-1.5 text-[10px] font-mono leading-4 text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
            {(runLog || 'No logs yet.').split(/\r?\n/).slice(-30).map((line, idx) => (
              <div key={`live-inline-log-${idx}`}>{line || ' '}</div>
            ))}
          </div>
        </div>
      )}

      <div className="px-3 py-3 border-t border-slate-200 dark:border-white/10">
        <div className="relative flex flex-col gap-2">
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.txt,.md,.json,.csv,.log,.xml,.yaml,.yml,.ini,.cfg,.conf,.py,.ts,.tsx,.js,.jsx,.html,.css,.scss,.sh,.bat"
            className="hidden"
            onChange={(e) => {
              void handleAttachmentSelection(e.target.files);
            }}
          />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setQuickActionsCollapsed(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              state.tekMode === 'mcp'
                ? 'Search SCPI commands, build flows, validate steps...'
                : state.tekMode === 'live'
                  ? 'Tell AI what to do with the scope...'
                  : 'Ask about measurements, debugging, scope setup...'
            }
            rows={4}
            className="w-full min-h-[110px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:border-violet-500/50 rounded-xl px-3.5 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/30 resize-y outline-none transition-colors"
          />
          {(contextAttachments.length > 0 || attachments.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {contextAttachments.map((file) => (
                <span
                  key={`context-${file.name}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-sky-300/70 bg-sky-50 px-2 py-1 text-[10px] text-sky-700 dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-300"
                  title={`${file.name} will be included automatically`}
                >
                  <span className="truncate max-w-[170px]">{file.name}</span>
                  <span className="font-semibold uppercase tracking-wide">auto</span>
                </span>
              ))}
              {attachments.map((file) => (
                <span
                  key={file.name}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-300/70 dark:border-white/20 bg-slate-100 dark:bg-white/10 px-2 py-1 text-[10px] text-slate-700 dark:text-white/80"
                  title={file.name}
                >
                  <span className="truncate max-w-[170px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.name)}
                    className="text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                clearChat();
                setInput('');
                setAttachments([]);
                setAttachmentError(null);
                clearApplyStatus();
              }}
              className="text-[10px] text-slate-400 dark:text-white/30 hover:text-slate-700 dark:hover:text-white/60 transition-colors"
            >
              Clear chat
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openAttachmentPicker}
                disabled={state.isLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-white/15 text-slate-600 dark:text-white/80 text-xs font-medium hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
                title="Attach screenshot, PDF, or text file"
              >
                <Paperclip size={12} />
                Attach
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={state.isLoading || (!input.trim() && attachments.length === 0 && contextAttachments.length === 0)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white text-xs font-semibold disabled:opacity-40 transition-all"
              >
                {state.isLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {state.isLoading ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
        {state.error && <div className="mt-1 text-xs text-red-400">{state.error}</div>}
        {attachmentError && <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{attachmentError}</div>}
        {applyStatus && isTransientVisible(applyStatusAt) && (
          <div
            className="mt-1 text-xs text-cyan-700 transition-opacity duration-300 dark:text-cyan-400"
            style={{ opacity: transientOpacity(applyStatusAt) }}
          >
            {applyStatus}
          </div>
        )}
      </div>

      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-violet-500/40 transition-colors z-10"
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startWidth = panelWidth;
          const onMove = (ev: MouseEvent) => {
            const newWidth = Math.min(760, Math.max(420, startWidth + (ev.clientX - startX)));
            setPanelWidth(newWidth);
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
          e.preventDefault();
        }}
      />
    </aside>
  );
}



