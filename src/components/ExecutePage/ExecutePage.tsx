import React, { useMemo, useState } from 'react';
import { Code, Terminal, Copy, Pencil, Sparkles } from 'lucide-react';
import { streamMcpChat, resolveMcpHost } from '../../utils/ai/mcpClient';
import { StepsListPreview } from './StepsListPreview';
import type { StepPreview } from './StepsListPreview';
import { PythonCodeEditor } from '../PythonCodeEditor';
import type { AiAction } from '../../utils/aiActions';
import type { ExecutionAuditReport } from '../../utils/executionAudit';
import { AiChatProvider } from './aiChatContext';
import { AiChatPanel } from './aiChatPanel';

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
  onBack: () => void;
  lastAuditReport?: ExecutionAuditReport | null;
  onClearRunLog?: () => void;
  onApplyAiActions?: (actions: AiAction[]) => Promise<{ applied: number; rerunStarted: boolean; changed: boolean }>;
  onLiveScreenshot?: (screenshot: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string }) => void;
  blocklyContent: React.ReactNode;
  liveModeContent: React.ReactNode;
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

function ExecutePageContent({
  executionSource,
  setExecutionSource,
  steps,
  code,
  runLog,
  runStatus,
  executorEndpoint,
  instrumentEndpoint,
  chatContextAttachments,
  flowContext,
  onRun,
  onBack,
  lastAuditReport,
  onClearRunLog,
  onApplyAiActions,
  onLiveScreenshot,
  blocklyContent,
  liveModeContent,
}: ExecutePageProps) {
  const [rightTab, setRightTab] = useState<'code' | 'logs'>('logs');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState('');
  const [aiCheckResult, setAiCheckResult] = useState('');
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  // Intentionally unused in this compact layout; execution controls are handled elsewhere.
  void onRun;
  void onBack;

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

  return (
    <div className="h-full flex flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="flex-1 min-h-0 flex">
        <AiChatPanel
          steps={steps}
          runLog={runLog}
          code={code}
          executionSource={executionSource}
          runStatus={runStatus}
          flowContext={flowContext}
          executorEndpoint={executorEndpoint}
          instrumentEndpoint={instrumentEndpoint}
          contextAttachments={chatContextAttachments}
          onApplyAiActions={onApplyAiActions}
          onLiveScreenshot={onLiveScreenshot}
          onRun={onRun}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-slate-100 dark:bg-slate-950">
          <div className="flex border-b border-slate-200 dark:border-slate-800/50">
            <button
              onClick={() => setExecutionSource('steps')}
              className={`px-4 py-3 text-sm font-medium ${
                executionSource === 'steps'
                  ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Steps
            </button>
            <button
              onClick={() => setExecutionSource('blockly')}
              className={`px-4 py-3 text-sm font-medium ${
                executionSource === 'blockly'
                  ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Blockly
            </button>
            <button
              onClick={() => setExecutionSource('live')}
              className={`px-4 py-3 text-sm font-medium ${
                executionSource === 'live'
                  ? 'border-b-2 border-purple-500 text-slate-900 bg-slate-200/70 dark:text-white dark:bg-slate-800/30'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Live
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {executionSource === 'steps' ? (
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

