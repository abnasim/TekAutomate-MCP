import React from 'react';

export interface StepPreview {
  id: string;
  type: string;
  label: string;
  params?: Record<string, unknown>;
  children?: StepPreview[];
}

function buildStepOrderMap(steps: StepPreview[]): Map<string, number> {
  const order = new Map<string, number>();
  let idx = 1;
  const visit = (list: StepPreview[]) => {
    for (const step of list) {
      order.set(step.id, idx++);
      if (step.children?.length) visit(step.children);
    }
  };
  visit(steps);
  return order;
}

function stepSubtitle(step: StepPreview): string {
  const p = step.params;
  if (!p) return '';

  switch (step.type) {
    case 'connect': {
      const names = Array.isArray((p as Record<string, unknown>).instruments)
        ? ((p as Record<string, unknown>).instruments as Array<{ name?: string }>).map((d) => d?.name).filter(Boolean)
        : [];
      const host = typeof p.host === 'string' ? p.host : typeof p.hostIP === 'string' ? p.hostIP : '';
      const parts = [names.join(', '), host].filter(Boolean);
      return parts.join(' · ');
    }
    case 'query':
    case 'write':
    case 'set_and_query':
      return typeof p.command === 'string' ? p.command : '';
    case 'sleep':
      return typeof p.duration === 'number' ? `${p.duration}s` : '';
    case 'comment':
      return typeof p.text === 'string' ? p.text : '';
    case 'python':
      return typeof p.code === 'string' ? (p.code.split('\n')[0] || '').trim() : '';
    case 'save_waveform':
      return [p.source, p.filename].filter(Boolean).join(' -> ') || '';
    case 'save_screenshot':
      return [p.filename, p.scopeType].filter(Boolean).join(' · ') || '';
    case 'recall':
      return [p.recallType, p.filepath || p.filename].filter(Boolean).join(' · ') || '';
    case 'group':
      return step.children?.length ? `${step.children.length} step(s)` : '';
    case 'tm_device_command':
      return (typeof p.code === 'string' ? p.code : typeof p.commandPath === 'string' ? p.commandPath : '') || '';
    default:
      return '';
  }
}

function typeChipClass(type: string): string {
  switch (type) {
    case 'connect':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200';
    case 'disconnect':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
    case 'query':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
    case 'write':
    case 'set_and_query':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
    case 'save_screenshot':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200';
    case 'save_waveform':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200';
    case 'python':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    case 'group':
      return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

function StepRow({
  step,
  depth = 0,
  stepOrder,
}: {
  step: StepPreview;
  depth?: number;
  stepOrder: Map<string, number>;
}) {
  const hasChildren = step.children && step.children.length > 0;
  const subtitle = stepSubtitle(step);
  const stepNumber = stepOrder.get(step.id);

  return (
    <div className="space-y-1.5" style={{ marginLeft: depth * 18 }}>
      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-900/45">
        <div className="flex items-start gap-2.5">
          {typeof stepNumber === 'number' && (
            <span className="shrink-0 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              #{stepNumber}
            </span>
          )}
          <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${typeChipClass(step.type)}`}>
            {step.type.replace(/_/g, ' ')}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {step.label || step.type}
            </div>
            {subtitle && (
              <div className="mt-1 truncate text-xs font-mono text-slate-600 dark:text-slate-300">
                {subtitle}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasChildren && (
        <div className="space-y-1.5 border-l border-slate-200 pl-2 dark:border-slate-700/60">
          {step.children!.map((s) => (
            <StepRow key={s.id} step={s} depth={depth + 1} stepOrder={stepOrder} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StepsListPreview({ steps }: { steps: StepPreview[] }) {
  if (!steps.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
        <p className="text-sm">No steps in this flow.</p>
        <p className="mt-2 text-xs">Switch to Steps in the main nav to add steps.</p>
      </div>
    );
  }

  const stepOrder = buildStepOrderMap(steps);

  return (
    <div className="h-full overflow-auto bg-slate-100/70 p-4 dark:bg-slate-950/60">
      <div className="space-y-2">
        {steps.map((s) => (
          <StepRow key={s.id} step={s} stepOrder={stepOrder} />
        ))}
      </div>
    </div>
  );
}
