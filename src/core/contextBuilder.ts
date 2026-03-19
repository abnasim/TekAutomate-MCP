import type { McpChatRequest } from './schemas';
import { planIntent } from './intentPlanner';

const OUTPUT_RULE = [
  'OUTPUT FORMAT:',
  '1) One short sentence.',
  '2) ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
  'No code fences. No prose after ACTIONS_JSON.',
  'If no changes needed: actions:[].',
  'For pyvisa/vxi11 use write/query/save_* only; tm_device_command only for tm_devices.',
  'Every query step must include saveAs.',
].join('\n');

const OUTPUT_RULE_COMPACT = [
  'Follow-up mode: keep output concise.',
  'Return one short sentence + ACTIONS_JSON only.',
  'Do not repeat long explanations unless asked.',
].join('\n');

function formatPlannerArgs(
  args: Array<{
    name: string;
    type: string;
    validValues?: string[];
  }>
): string {
  return args
    .map((arg) => `${arg.name}(${arg.validValues?.join('|') || arg.type})`)
    .join(', ');
}

function summarizeStepsForCompact(steps: Array<Record<string, unknown>>): string {
  if (!Array.isArray(steps) || steps.length === 0) return '0 steps';
  const types = steps.slice(0, 12).map((s) => String(s.type || 'unknown'));
  return `${steps.length} steps [${types.join(', ')}${steps.length > 12 ? ', ...' : ''}]`;
}

function workspaceSection(req: McpChatRequest, compact = false): string {
  if (compact) {
    const parts: string[] = [
      `Backend: ${req.flowContext.backend}`,
      `Device: ${req.flowContext.deviceType || 'UNKNOWN'} / ${req.flowContext.modelFamily || 'UNKNOWN'}`,
      `Selected Step: ${req.flowContext.selectedStepId || 'none'}`,
      `Flow: ${summarizeStepsForCompact(req.flowContext.steps || [])}`,
      `RunStatus: ${req.runContext.runStatus || 'idle'}`,
    ];
    if (req.flowContext.validationErrors?.length) {
      parts.push(`ValidationErrors: ${req.flowContext.validationErrors.length}`);
    }
    return `## WORKSPACE\n\n${parts.join('\n')}`;
  }

  const sections: string[] = [
    `Backend: ${req.flowContext.backend}`,
    `Device: ${req.flowContext.deviceType || 'UNKNOWN'} / ${req.flowContext.modelFamily || 'UNKNOWN'}`,
    `Selected Step: ${req.flowContext.selectedStepId || 'none'}`,
    `Steps: ${JSON.stringify(req.flowContext.steps, null, 2)}`,
  ];

  if (req.flowContext.validationErrors?.length) {
    sections.push(
      'Validation Errors:\n' + req.flowContext.validationErrors.map((error) => `- ${error}`).join('\n')
    );
  }

  if (req.runContext.logTail) {
    sections.push(`Last run log:\n${req.runContext.logTail}`);
  }

  return `## WORKSPACE\n\n${sections.join('\n')}`;
}

export async function buildContext(
  req: McpChatRequest,
  options?: { compact?: boolean }
): Promise<string> {
  const compact = Boolean(options?.compact);
  const plannerOutput = await planIntent(req);
  const sections: string[] = [];

  sections.push(compact ? OUTPUT_RULE_COMPACT : OUTPUT_RULE);

  if (plannerOutput.resolvedCommands.length > 0) {
    const scpiCommands = plannerOutput.resolvedCommands.filter(
      (resolved) => !resolved.header.startsWith('STEP:')
    );
    const stepMarkers = plannerOutput.resolvedCommands.filter((resolved) =>
      resolved.header.startsWith('STEP:')
    );

    if (scpiCommands.length > 0) {
      if (compact) {
        sections.push(
          '## PLANNER RESOLVED\n\n' +
            scpiCommands
              .map((resolved) => {
                const saveAs = resolved.saveAs ? `\n  saveAs: ${resolved.saveAs}` : '';
                return `${resolved.concreteCommand}${saveAs}`;
              })
              .join('\n')
        );
      } else {
        sections.push(
          '## PLANNER RESOLVED - USE THESE EXACT COMMANDS\n\n' +
            'These commands are verified against the command index.\n' +
            'Use them exactly as shown. Do not substitute or invent alternatives.\n\n' +
            scpiCommands
              .map((resolved) => {
                const lines = [
                  resolved.concreteCommand,
                  `  syntax: ${resolved.syntax?.set || resolved.syntax?.query || 'N/A'}`,
                ];

                if (resolved.arguments?.length) {
                  lines.push(`  args: ${formatPlannerArgs(resolved.arguments)}`);
                }

                if (resolved.examples?.[0]?.scpi) {
                  lines.push(`  example: ${resolved.examples[0].scpi}`);
                }

                if (resolved.saveAs) {
                  lines.push(`  saveAs: ${resolved.saveAs}`);
                }

                return lines.join('\n');
              })
              .join('\n\n')
        );
      }
    }

    if (stepMarkers.length > 0) {
      sections.push(
        '## BUILT-IN STEP TYPES - USE THESE FOR SAVE/RECALL\n\n' +
          stepMarkers
            .map((resolved) => `${resolved.stepType}: ${JSON.stringify(resolved.stepParams || {})}`)
            .join('\n')
      );
    }
  }

  if (plannerOutput.unresolved.length > 0) {
    sections.push(
      '## UNRESOLVED - USE YOUR KNOWLEDGE FOR THESE\n\n' + plannerOutput.unresolved.join('\n')
    );
  }

  sections.push(workspaceSection(req, compact));

  return sections.join('\n\n---\n\n');
}

