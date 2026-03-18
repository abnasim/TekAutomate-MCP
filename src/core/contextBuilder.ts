import type { McpChatRequest } from './schemas';
import { planIntent } from './intentPlanner';

const OUTPUT_RULE = [
  'FIRST LINE OF YOUR RESPONSE MUST BE ONE SENTENCE ONLY.',
  'SECOND LINE MUST BE ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
  'NO numbered lists. NO step explanations. NO prose sections.',
  'IF YOU WRITE MORE THAN 2 LINES BEFORE ACTIONS_JSON YOU ARE WRONG.',
  '',
  'OUTPUT RULE (read first):',
  'End your response with ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
  'No code fences. No raw arrays. No prose after ACTIONS_JSON.',
  'If no changes needed: ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[]}',
  'COMPLEX flows (3+ steps): after one short summary sentence, output ACTIONS_JSON immediately. No numbered lists or step-by-step prose. The actions array is the breakdown.',
  'Never ask for confirmation. If parameters are inferable, build immediately and state assumptions in the summary.',
  'If backend is pyvisa/vxi11: use write/query/save_* steps. tm_device_command is ONLY for tm_devices backend.',
  'Combine related SCPI settings into ONE write step using semicolons.',
  'Every query step MUST include saveAs. No exceptions.',
  'Do not search for SCPI. Use only the planner-resolved commands below unless an item is explicitly marked unresolved.',
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

function workspaceSection(req: McpChatRequest): string {
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

export async function buildContext(req: McpChatRequest): Promise<string> {
  const plannerOutput = await planIntent(req);
  const sections: string[] = [];

  sections.push(OUTPUT_RULE);

  if (plannerOutput.resolvedCommands.length > 0) {
    const scpiCommands = plannerOutput.resolvedCommands.filter(
      (resolved) => !resolved.header.startsWith('STEP:')
    );
    const stepMarkers = plannerOutput.resolvedCommands.filter((resolved) =>
      resolved.header.startsWith('STEP:')
    );

    if (scpiCommands.length > 0) {
      sections.push(
        '## PLANNER RESOLVED — USE THESE EXACT COMMANDS\n\n' +
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

    if (stepMarkers.length > 0) {
      sections.push(
        '## BUILT-IN STEP TYPES — USE THESE FOR SAVE/RECALL\n\n' +
          stepMarkers
            .map((resolved) => `${resolved.stepType}: ${JSON.stringify(resolved.stepParams || {})}`)
            .join('\n')
      );
    }
  }

  if (plannerOutput.unresolved.length > 0) {
    sections.push(
      '## UNRESOLVED — USE YOUR KNOWLEDGE FOR THESE\n\n' + plannerOutput.unresolved.join('\n')
    );
  }

  sections.push(workspaceSection(req));

  return sections.join('\n\n---\n\n');
}
