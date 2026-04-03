import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Code, Terminal, Copy, Pencil, Sparkles, Play, RotateCcw, RotateCw, Trash2, Mail } from 'lucide-react';
import { streamMcpChat } from '../../utils/ai/mcpClient';
import { StepsListPreview } from './StepsListPreview';
import type { StepPreview } from './StepsListPreview';
import { PythonCodeEditor } from '../PythonCodeEditor';
import { normalizeAiActions, type AiAction } from '../../utils/aiActions';
import type { ExecutionAuditReport } from '../../utils/executionAudit';
import { AiChatProvider } from './aiChatContext';
import { AiChatPanel } from './aiChatPanel';
import type { ParsedActionsPreview } from './OpenAiChatKitPanel';

export type ExecutionSource = 'steps' | 'blockly' | 'live';

export interface ExecutePageProps {
  executionSource: ExecutionSource;
  setExecutionSource: (s: ExecutionSource) => void;
  steps: StepPreview[];
  code: string;
  runLog: string;
  runStatus: 'idle' | 'connecting' | 'running' | 'done' | 'error';
  executorEndpoint: { host: string; port: number } | null;
  instrumentEndpoint?: { executorUrl: string; visaResource: string; backend: string; liveMode?: boolean } | null;
  latestLiveScreenshot?: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string } | null;
  chatContextAttachments?: Array<{ name: string; mimeType: string; size: number; dataUrl?: string; textExcerpt?: string }>;
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    connectionType?: string;
    host?: string;
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    validationErrors?: string[];
    selectedStep?: StepPreview | null;
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
      visaBackend?: string;
    }>;
  };
  onRun: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onBack: () => void;
  lastAuditReport?: ExecutionAuditReport | null;
  onClearRunLog?: () => void;
  onApplyAiActions?: (actions: AiAction[]) => Promise<{ applied: number; rerunStarted: boolean; changed: boolean }>;
  onLiveScreenshot?: (screenshot: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string }) => void;
  blocklyContent: React.ReactNode;
  liveModeContent: React.ReactNode;
}

interface WorkflowProposalState extends ParsedActionsPreview {
  id: string;
  receivedAt: number;
  workspaceRevisionAtReceipt: number;
  appliedAtRevision?: number;
}

const EXECUTE_PAGE_PROPOSAL_STORAGE = 'tekautomate.execute.proposal.history';
const EXECUTE_PAGE_TAB_STORAGE = 'tekautomate.execute.center_tab';
const EXECUTE_PAGE_AUTO_APPLY_STORAGE = 'tekautomate.execute.proposals.auto_apply';

function loadStoredWorkflowProposals(): WorkflowProposalState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(EXECUTE_PAGE_PROPOSAL_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkflowProposalState[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && Array.isArray(item.actions))
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : `proposal_${typeof item.receivedAt === 'number' ? item.receivedAt : Date.now()}`,
        summary: typeof item.summary === 'string' ? item.summary : '',
        findings: Array.isArray(item.findings) ? item.findings.map(String) : [],
        suggestedFixes: Array.isArray(item.suggestedFixes) ? item.suggestedFixes.map(String) : [],
        actions: item.actions,
        rawJson: typeof item.rawJson === 'string' ? item.rawJson : '',
        source: item.source,
        receivedAt: typeof item.receivedAt === 'number' ? item.receivedAt : Date.now(),
        workspaceRevisionAtReceipt: typeof item.workspaceRevisionAtReceipt === 'number' ? item.workspaceRevisionAtReceipt : 0,
        appliedAtRevision: typeof item.appliedAtRevision === 'number' ? item.appliedAtRevision : undefined,
      }));
  } catch {
    return [];
  }
}

function loadStoredCenterTab(defaultTab: ExecutionSource): ExecutionSource | 'proposals' {
  if (typeof window === 'undefined') return defaultTab;
  try {
    const raw = window.localStorage.getItem(EXECUTE_PAGE_TAB_STORAGE);
    return raw === 'proposals' || raw === 'steps' || raw === 'blockly' || raw === 'live'
      ? raw
      : defaultTab;
  } catch {
    return defaultTab;
  }
}

function loadStoredAutoApply(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EXECUTE_PAGE_AUTO_APPLY_STORAGE) === 'true';
  } catch {
    return false;
  }
}

function getRunLogLineClass(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return 'text-slate-400 dark:text-slate-500';
  if (/^---\s.+\s---$/.test(trimmed)) return 'text-cyan-700 dark:text-cyan-300 font-semibold';
  if (/^\[DECODE\]/.test(trimmed)) return 'text-fuchsia-700 dark:text-fuchsia-300';
  if (/^\[OK\]/.test(trimmed)) return 'text-emerald-700 dark:text-emerald-300 font-semibold';
  if (/^\[STEP\]/.test(trimmed)) return 'text-sky-700 dark:text-sky-300';
  if (/^\[RESP\]/.test(trimmed)) return 'text-violet-700 dark:text-violet-300';
  if (/^\[WARN\]/.test(trimmed)) return 'text-amber-700 dark:text-amber-300';
  if (/^\[Error\]/.test(trimmed) || /^Traceback/.test(trimmed) || /Exception:/.test(trimmed)) return 'text-rose-700 dark:text-rose-300 font-semibold';
  if (/^Exit code:\s*0\b/i.test(trimmed)) return 'text-emerald-700 dark:text-emerald-300 font-semibold';
  if (/^Exit code:\s*[1-9]\d*\b/i.test(trimmed)) return 'text-rose-700 dark:text-rose-300 font-semibold';
  if (/^Connecting and sending script/i.test(trimmed) || /^Connecting via /i.test(trimmed)) return 'text-blue-700 dark:text-blue-300';
  if (/^Executing /i.test(trimmed)) return 'text-indigo-700 dark:text-indigo-300';
  if (/^(Done\.|Quick test done\.)$/i.test(trimmed)) return 'text-emerald-700 dark:text-emerald-300 font-semibold';
  if (/^(Run failed\.|Quick test failed\.)$/i.test(trimmed)) return 'text-rose-700 dark:text-rose-300 font-semibold';
  if (/^(Executor:|URL:|Flow source:|Planned execution|Duration:)/i.test(trimmed)) return 'text-cyan-700 dark:text-cyan-200';
  return 'text-slate-700 dark:text-slate-200';
}

function describeProposalAction(action: AiAction): { title: string; detail?: string } {
  const payload = (action.payload || {}) as Record<string, unknown>;
  const targetId = typeof action.target_step_id === 'string' ? action.target_step_id : '';

  if (action.action_type === 'replace_step') {
    const newStep =
      payload.new_step && typeof payload.new_step === 'object'
        ? (payload.new_step as Record<string, unknown>)
        : null;
    const label = typeof newStep?.label === 'string' ? newStep.label : typeof newStep?.type === 'string' ? newStep.type : 'step';
    return { title: `Replace step ${targetId || '(selected step)'}`, detail: `with ${label}` };
  }

  if (action.action_type === 'insert_step_after') {
    const newStep =
      payload.new_step && typeof payload.new_step === 'object'
        ? (payload.new_step as Record<string, unknown>)
        : payload.newStep && typeof payload.newStep === 'object'
          ? (payload.newStep as Record<string, unknown>)
          : null;
    const label = typeof newStep?.label === 'string' ? newStep.label : typeof newStep?.type === 'string' ? newStep.type : 'step';
    return { title: `Insert after ${targetId || 'end of flow'}`, detail: label };
  }

  if (action.action_type === 'remove_step') {
    return { title: `Remove step ${targetId || '(unknown target)'}` };
  }

  if (action.action_type === 'set_step_param') {
    const param = typeof payload.param === 'string' ? payload.param : 'parameter';
    const value = Object.prototype.hasOwnProperty.call(payload, 'value') ? JSON.stringify(payload.value) : '';
    return { title: `Update ${param} on ${targetId || '(unknown target)'}`, detail: value || undefined };
  }

  if (action.action_type === 'replace_flow') {
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    return { title: 'Replace entire flow', detail: `${steps.length} top-level step${steps.length === 1 ? '' : 's'}` };
  }

  if (action.action_type === 'move_step') {
    const groupId = typeof payload.target_group_id === 'string' ? payload.target_group_id : '';
    return { title: `Move step ${targetId || '(unknown target)'}`, detail: `into ${groupId || 'target group'}` };
  }

  if (action.action_type === 'add_error_check_after_step') {
    return { title: `Add error check after ${targetId || '(unknown target)'}` };
  }

  if (action.action_type === 'replace_sleep_with_opc_query') {
    return { title: `Replace sleep on ${targetId || '(unknown target)'}`, detail: 'with *OPC? wait' };
  }

  return { title: String(action.action_type).replace(/_/g, ' ') };
}

function ExecutePageContent({
  executionSource,
  setExecutionSource,
  steps,
  code,
  runLog,
  runStatus,
  executorEndpoint,
  instrumentEndpoint,
  latestLiveScreenshot,
  chatContextAttachments,
  flowContext,
  onRun,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onBack,
  lastAuditReport,
  onClearRunLog,
  onApplyAiActions,
  onLiveScreenshot,
  blocklyContent,
  liveModeContent,
}: ExecutePageProps) {
  const [centerTab, setCenterTab] = useState<ExecutionSource | 'proposals'>(() => loadStoredCenterTab(executionSource));
  const [rightTab, setRightTab] = useState<'code' | 'logs'>('logs');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState('');
  const [aiCheckResult, setAiCheckResult] = useState('');
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [proposalHistory, setProposalHistory] = useState<WorkflowProposalState[]>(() => loadStoredWorkflowProposals());
  const [activeProposalId, setActiveProposalId] = useState<string | null>(() => loadStoredWorkflowProposals()[0]?.id || null);
  const [applyingProposal, setApplyingProposal] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<string | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [pendingReapplyProposalId, setPendingReapplyProposalId] = useState<string | null>(null);
  const [autoApplyProposals, setAutoApplyProposals] = useState<boolean>(() => loadStoredAutoApply());
  const workflowProposal = useMemo(
    () => proposalHistory.find((proposal) => proposal.id === activeProposalId) || proposalHistory[0] || null,
    [activeProposalId, proposalHistory]
  );
  void onBack;

  useEffect(() => {
    setCenterTab((current) => (current === 'proposals' && workflowProposal ? current : executionSource));
  }, [executionSource, workflowProposal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EXECUTE_PAGE_TAB_STORAGE, centerTab);
    } catch {
      // Ignore storage failures.
    }
  }, [centerTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (proposalHistory.length) {
        window.localStorage.setItem(EXECUTE_PAGE_PROPOSAL_STORAGE, JSON.stringify(proposalHistory));
      } else {
        window.localStorage.removeItem(EXECUTE_PAGE_PROPOSAL_STORAGE);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [proposalHistory]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EXECUTE_PAGE_AUTO_APPLY_STORAGE, autoApplyProposals ? 'true' : 'false');
    } catch {
      // Ignore storage failures.
    }
  }, [autoApplyProposals]);

  const runLogLines = useMemo(
    () => (runLog || 'Logs will appear here when you run the flow.').split(/\r?\n/),
    [runLog]
  );

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLog = () => {
    const text = String(runLog || '').trim();
    navigator.clipboard.writeText(text || 'Logs will appear here when you run the flow.');
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const clearProposalHistory = useCallback(() => {
    setProposalHistory([]);
    setActiveProposalId(null);
    setPendingReapplyProposalId(null);
    setProposalStatus(null);
    if (centerTab === 'proposals') {
      setCenterTab(executionSource);
    }
  }, [centerTab, executionSource]);

  const applyProposalNow = useCallback(async (proposal: WorkflowProposalState) => {
    if (!proposal?.actions?.length || !onApplyAiActions) return;
    setPendingReapplyProposalId(null);
    setApplyingProposal(true);
    setProposalStatus(null);
    try {
      const normalizedActions = normalizeAiActions(proposal.actions as unknown[]);
      if (!normalizedActions.length) {
        setProposalStatus('Proposal actions could not be normalized into valid TekAutomate actions.');
        return;
      }
      const result = await onApplyAiActions(normalizedActions as AiAction[]);
      if (result.changed && result.applied > 0) {
        const nextRevision = workspaceRevision + 1;
        setProposalStatus(proposal.summary || `Applied ${result.applied} action(s).`);
        setWorkspaceRevision(nextRevision);
        setProposalHistory((current) =>
          current.map((item) =>
            item.id === proposal.id
              ? { ...item, appliedAtRevision: nextRevision }
              : item
          )
        );
        setCenterTab('steps');
      } else {
        setProposalStatus('No flow changes were applied. The proposal already matches the current flow.');
      }
    } catch (err) {
      setProposalStatus(err instanceof Error ? err.message : 'Failed to apply workflow proposal.');
    } finally {
      setApplyingProposal(false);
    }
  }, [onApplyAiActions, workspaceRevision]);

  const handleProposalDetected = useCallback((proposal: ParsedActionsPreview | null) => {
    if (!proposal) {
      setProposalStatus(null);
      return;
    }
    const existingMatch = proposalHistory.find((item) => item.rawJson === proposal.rawJson);
    const nextProposal: WorkflowProposalState = {
      ...proposal,
      id: existingMatch?.id || `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: Date.now(),
      workspaceRevisionAtReceipt: workspaceRevision,
      appliedAtRevision: existingMatch?.appliedAtRevision,
    };
    setProposalHistory((current) => {
      const deduped = current.filter((item) => item.rawJson !== nextProposal.rawJson);
      return [nextProposal, ...deduped].slice(0, 20);
    });
    setActiveProposalId(nextProposal.id);
    setProposalStatus(null);
    if (autoApplyProposals && onApplyAiActions) {
      if (typeof existingMatch?.appliedAtRevision === 'number') {
        setProposalStatus('This proposal was already applied, so auto-apply skipped it to avoid stacking duplicate steps.');
        return;
      }
      void applyProposalNow(nextProposal);
      return;
    }
    setCenterTab('proposals');
  }, [applyProposalNow, autoApplyProposals, onApplyAiActions, proposalHistory, workspaceRevision]);

  const handleApplyProposal = useCallback(async () => {
    if (!workflowProposal?.actions?.length || !onApplyAiActions) return;
    if (typeof workflowProposal.appliedAtRevision === 'number') {
      setPendingReapplyProposalId(workflowProposal.id);
      return;
    }
    await applyProposalNow(workflowProposal);
  }, [applyProposalNow, onApplyAiActions, workflowProposal]);

  const pendingReapplyProposal = useMemo(
    () => proposalHistory.find((proposal) => proposal.id === pendingReapplyProposalId) || null,
    [pendingReapplyProposalId, proposalHistory]
  );

  return (
    <div className="h-full flex flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="flex-1 min-h-0 flex">
        <AiChatPanel
          steps={steps}
          workspaceRevision={workspaceRevision}
          runLog={runLog}
          code={code}
          executionSource={executionSource}
          runStatus={runStatus}
          flowContext={flowContext}
          executorEndpoint={executorEndpoint}
          instrumentEndpoint={instrumentEndpoint}
          latestLiveScreenshot={latestLiveScreenshot}
          contextAttachments={chatContextAttachments}
          onApplyAiActions={onApplyAiActions}
          onWorkflowProposal={handleProposalDetected}
          onLiveScreenshot={onLiveScreenshot}
          onRun={onRun}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-slate-100 dark:bg-slate-950">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/50 px-2">
            <div className="flex min-w-0">
              <button
                onClick={() => {
                  setExecutionSource('steps');
                  setCenterTab('steps');
                }}
                className={`px-4 py-3 text-sm font-medium ${
                  centerTab === 'steps'
                    ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Steps
              </button>
              <button
                onClick={() => {
                  setExecutionSource('blockly');
                  setCenterTab('blockly');
                }}
                className={`px-4 py-3 text-sm font-medium ${
                  centerTab === 'blockly'
                    ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Blockly
              </button>
              <button
                onClick={() => {
                  setExecutionSource('live');
                  setCenterTab('live');
                }}
                className={`px-4 py-3 text-sm font-medium ${
                  centerTab === 'live'
                    ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Live
              </button>
              <button
                onClick={() => setCenterTab('proposals')}
                className={`px-4 py-3 text-sm font-medium ${
                  centerTab === 'proposals'
                    ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  Proposals
                  {workflowProposal?.actions?.length ? (
                    <Mail size={14} className="text-cyan-600 dark:text-cyan-400" />
                  ) : null}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2 py-2">
              <button
                type="button"
                onClick={() => setAutoApplyProposals((value) => !value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  autoApplyProposals
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:border-cyan-500/50 dark:text-cyan-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
                title={autoApplyProposals ? 'Auto-apply new proposals is on' : 'Auto-apply new proposals is off'}
              >
                <Sparkles size={14} />
                Auto Apply
              </button>
              <button
                type="button"
                onClick={clearProposalHistory}
                disabled={!proposalHistory.length}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                title="Clear proposal history"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                title="Undo"
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                title="Redo"
              >
                <RotateCw size={16} />
              </button>
              <button
                type="button"
                onClick={() => { void handleApplyProposal(); }}
                disabled={!workflowProposal?.actions?.length || applyingProposal || !onApplyAiActions}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-500/40 dark:text-emerald-300"
                title="Apply the latest workflow proposal"
              >
                <Sparkles size={16} />
                {applyingProposal ? 'Applying...' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={onRun}
                disabled={runStatus === 'running' || runStatus === 'connecting'}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Run on scope"
              >
                <Play size={16} />
                {runStatus === 'running' || runStatus === 'connecting' ? 'Running...' : 'Run on Scope'}
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {centerTab === 'proposals' ? (
              <div className="h-full overflow-auto bg-slate-100/70 p-4 dark:bg-slate-950/60">
                {workflowProposal ? (
                  <div className="mx-auto flex max-w-4xl flex-col gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Latest Workflow Proposal
                      </div>
                      <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                        {workflowProposal.summary || 'Untitled workflow proposal'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                          {workflowProposal.actions.length} {workflowProposal.actions.length === 1 ? 'change' : 'changes'}
                        </span>
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {workflowProposal.findings.length} findings
                        </span>
                        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          {workflowProposal.suggestedFixes.length} suggestions
                        </span>
                      </div>
                      {proposalStatus && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {proposalStatus}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Findings</div>
                        <div className="mt-3 space-y-2">
                          {workflowProposal.findings.length ? workflowProposal.findings.map((item, index) => (
                            <div key={`proposal-finding-${index}`} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                              {item}
                            </div>
                          )) : (
                            <div className="text-sm text-slate-500 dark:text-slate-400">No findings were included.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Suggested Fixes</div>
                        <div className="mt-3 space-y-2">
                          {workflowProposal.suggestedFixes.length ? workflowProposal.suggestedFixes.map((item, index) => (
                            <div key={`proposal-suggestion-${index}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                              {item}
                            </div>
                          )) : (
                            <div className="text-sm text-slate-500 dark:text-slate-400">No suggestions were included.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {proposalHistory.length > 1 && (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Proposal History</div>
                        <div className="mt-3 space-y-2">
                          {proposalHistory.map((proposal, index) => (
                            <button
                              key={proposal.id}
                              type="button"
                              onClick={() => setActiveProposalId(proposal.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                proposal.id === workflowProposal.id
                                  ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/50 dark:bg-cyan-950/20'
                                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                                    {index === 0 ? 'Latest' : `Previous ${index}`}:
                                    {' '}
                                    {proposal.summary || 'Untitled workflow proposal'}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {proposal.actions.length} actions
                                    {typeof proposal.appliedAtRevision === 'number' ? ' • applied' : ''}
                                  </div>
                                </div>
                                <div className="text-xs text-slate-400 dark:text-slate-500">
                                  {proposal.id === workflowProposal.id ? 'Open' : 'View'}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">Action Log</div>
                      <div className="mt-3 space-y-2">
                        {workflowProposal.actions.map((action, index) => {
                          const description = describeProposalAction(action);
                          return (
                            <div key={`${action.id || 'proposal-action'}-${index}`} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                {index + 1}. {description.title}
                              </div>
                              {description.detail ? (
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {description.detail}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">Raw Payload</div>
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                        <code>{workflowProposal.rawJson}</code>
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
                    <p className="text-sm">No workflow proposals yet.</p>
                    <p className="mt-2 text-xs">When MCP stages a proposal, it will appear here with findings, suggestions, and the raw payload.</p>
                  </div>
                )}
              </div>
            ) : executionSource === 'steps' ? (
              <StepsListPreview steps={steps} />
            ) : executionSource === 'blockly' ? (
              <div className="h-full text-slate-900 dark:text-slate-100">{blocklyContent}</div>
            ) : (
              <div className="h-full text-slate-900 dark:text-slate-100">{liveModeContent}</div>
            )}
          </div>
        </main>

        {/* Right panel: hidden in live mode, collapsible Code/Logs otherwise */}
        {executionSource !== 'live' && (
        <>
          {/* Collapse/expand toggle — always visible as a vertical bar */}
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="flex-shrink-0 w-5 flex items-center justify-center border-l border-slate-200 bg-slate-100 hover:bg-slate-200 dark:border-slate-800/50 dark:bg-slate-900/50 dark:hover:bg-slate-800/80 cursor-col-resize transition-colors group"
            title={rightPanelOpen ? 'Hide Code/Logs panel' : 'Show Code/Logs panel'}
          >
            <span className="text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 text-xs select-none">
              {rightPanelOpen ? '›' : '‹'}
            </span>
          </button>
          {rightPanelOpen && (
          <aside className="w-[30rem] min-w-[24rem] max-w-[40vw] flex-shrink-0 flex flex-col border-l border-slate-200 bg-slate-100/85 dark:border-slate-800/50 dark:bg-slate-900/50">
          <div className="flex border-b border-slate-200 dark:border-slate-800/50">
            <button
              onClick={() => setRightTab('code')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium ${
                rightTab === 'code'
                  ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Code size={16} />
              Code
            </button>
            <button
              onClick={() => setRightTab('logs')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium ${
                rightTab === 'logs'
                  ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Terminal size={16} />
              Logs
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 min-h-0">
            {rightTab === 'code' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Generated script</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditorCode(code || ''); setEditorOpen(true); }}
                      className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      onClick={copyCode}
                      className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                    >
                      <Copy size={14} />
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-700 dark:border-slate-700 overflow-hidden min-h-[200px]">
                  <PythonCodeEditor
                    value={code || '# No code - add steps or build a Blockly flow, then run.'}
                    onChange={() => {}}
                    readOnly
                    className="[&_.cm-editor]:!bg-slate-900 dark:[&_.cm-editor]:!bg-slate-950 [&_.cm-scroller]:min-h-[200px] [&_.cm-gutters]:!bg-slate-900 dark:[&_.cm-gutters]:!bg-slate-950 [&_.cm-gutters]:!border-slate-700"
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs font-mono whitespace-pre-wrap break-words rounded-lg bg-slate-100 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-700/70 p-4 overflow-x-auto h-full leading-5">
                {runLogLines.map((line, idx) => (
                  <div key={`execute-log-line-${idx}`} className={`${getRunLogLineClass(line)} whitespace-pre-wrap break-words`}>
                    {line || ' '}
                  </div>
                ))}
              </div>
            )}
          </div>

          {(lastAuditReport || onClearRunLog || runLog.trim().length > 0) && (
            <div className="border-t border-slate-200 px-4 py-2 dark:border-slate-800/50">
              {lastAuditReport && (
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Audit: {lastAuditReport.status} · findings {lastAuditReport.summary.findings}
                </p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyLog}
                  className="text-[11px] px-2 py-1 rounded border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {copiedLog ? 'Copied' : 'Copy log'}
                </button>
                <button
                  type="button"
                  onClick={() => onClearRunLog?.()}
                  disabled={!onClearRunLog}
                  className="text-[11px] px-2 py-1 rounded border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Clear log
                </button>
              </div>
            </div>
          )}
          </aside>
          )}
        </>
        )}
      </div>

      {/* Code editor modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-[90vw] max-w-[1000px] h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Python Code Editor</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Edit the generated script</p>
              </div>
              <button
                onClick={() => setEditorOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-xl"
              >
                &times;
              </button>
            </div>
            <div className={`${aiCheckResult ? 'flex-[2]' : 'flex-1'} min-h-0 overflow-hidden`}>
              <PythonCodeEditor
                value={editorCode}
                onChange={setEditorCode}
                className="h-full [&_.cm-editor]:!bg-white dark:[&_.cm-editor]:!bg-slate-950 [&_.cm-scroller]:h-full [&_.cm-gutters]:!bg-slate-50 dark:[&_.cm-gutters]:!bg-slate-900"
              />
            </div>
            {aiCheckResult && (
              <div className="flex-1 min-h-0 overflow-auto border-t border-slate-200 dark:border-slate-700 px-6 py-3 bg-slate-50 dark:bg-slate-950">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1"><Sparkles size={12} /> AI Review</span>
                  <button onClick={() => setAiCheckResult('')} className="text-xs text-slate-400 hover:text-slate-600">&times; close</button>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-5">{aiCheckResult}</div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={async () => {
                  if (!editorCode.trim()) return;
                  setAiCheckLoading(true);
                  setAiCheckResult('');
                  try {
                    // Read API key from localStorage
                    const openaiKey = (() => { try { return (localStorage.getItem('tekautomate.ai.byok.api_key.openai') || '').trim(); } catch { return ''; } })();
                    const anthropicKey = (() => { try { return (localStorage.getItem('tekautomate.ai.byok.api_key.anthropic') || '').trim(); } catch { return ''; } })();
                    const apiKey = openaiKey || anthropicKey;
                    const provider = openaiKey ? 'openai' : 'anthropic';
                    if (!apiKey) {
                      setAiCheckResult('No API key found. Set your key in the AI panel first.');
                      return;
                    }
                    let result = '';
                    await streamMcpChat(
                      {
                        userMessage: `Review this TekAutomate-generated Python script for syntax errors, runtime issues, and SCPI command problems. Check:\n1. Python syntax errors\n2. Missing imports\n3. SCPI command typos or wrong syntax\n4. Scope connection/disconnection issues\n5. Missing error handling\n6. Potential timeout issues\n\nBe concise — bullet points only, max 10 items. If code looks good, say "Code looks good - no issues found."\n\n\`\`\`python\n${editorCode}\n\`\`\``,
                        outputMode: 'chat',
                        provider: provider as any,
                        apiKey,
                        model: openaiKey ? 'gpt-5.4-nano' : 'claude-sonnet-4-6',
                        flowContext: {
                          backend: flowContext?.backend || 'pyvisa',
                          modelFamily: flowContext?.modelFamily || 'unknown',
                          steps: [],
                        },
                      } as any,
                      (chunk: string) => { result += chunk; }
                    );
                    setAiCheckResult(result || 'No response from AI.');
                  } catch (err) {
                    setAiCheckResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setAiCheckLoading(false);
                  }
                }}
                disabled={aiCheckLoading || !editorCode.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-purple-600 to-cyan-600 text-white hover:from-purple-500 hover:to-cyan-500 font-medium flex items-center gap-1.5 disabled:opacity-40"
              >
                <Sparkles size={14} />
                {aiCheckLoading ? 'Checking...' : 'Check with AI'}
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setEditorOpen(false); setAiCheckResult(''); }}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(editorCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <Copy size={14} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => { setEditorOpen(false); setAiCheckResult(''); }}
                  className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-500 font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingReapplyProposal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="text-lg font-semibold text-slate-900 dark:text-white">Apply Again?</div>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              This proposal was already applied to the current workspace. Applying it again may stack duplicate steps.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Do you want to apply it again anyway?
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingReapplyProposalId(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void applyProposalNow(pendingReapplyProposal); }}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-300"
              >
                <Sparkles size={16} />
                Apply Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExecutePage(props: ExecutePageProps) {
  return (
    <AiChatProvider>
      <ExecutePageContent {...props} />
    </AiChatProvider>
  );
}

