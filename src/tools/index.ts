import { getCommandByHeader } from './getCommandByHeader';
import { getCommandGroup } from './getCommandGroup';
import { getEnvironment } from './getEnvironment';
import { getInstrumentState } from './getInstrumentState';
import { getPolicy } from './getPolicy';
import { getTemplateExamples } from './getTemplateExamples';
import { getVisaResources } from './getVisaResources';
import { getBlockSchema } from './getBlockSchema';
import { listValidStepTypes } from './listValidStepTypes';
import { probeCommand } from './probeCommand';
import { retrieveRagChunks } from './retrieveRagChunks';
import { searchKnownFailures } from './searchKnownFailures';
import { searchScpi } from './searchScpi';
import { searchTmDevices } from './searchTmDevices';
import { validateActionPayload } from './validateActionPayload';
import { validateDeviceContext } from './validateDeviceContext';
import { verifyScpiCommands } from './verifyScpiCommands';
import { GROUP_NAMES } from '../core/commandGroups';

export const TOOL_HANDLERS = {
  search_scpi: searchScpi,
  get_command_group: getCommandGroup,
  get_command_by_header: getCommandByHeader,
  verify_scpi_commands: verifyScpiCommands,
  search_tm_devices: searchTmDevices,
  retrieve_rag_chunks: retrieveRagChunks,
  search_known_failures: searchKnownFailures,
  get_template_examples: getTemplateExamples,
  get_policy: getPolicy,
  list_valid_step_types: listValidStepTypes,
  get_block_schema: getBlockSchema,
  validate_action_payload: validateActionPayload,
  validate_device_context: validateDeviceContext,
  get_instrument_state: getInstrumentState,
  probe_command: probeCommand,
  get_visa_resources: getVisaResources,
  get_environment: getEnvironment,
} as const;

export type ToolName = keyof typeof TOOL_HANDLERS;

export function getToolDefinitions() {
  return [
    {
      name: 'search_scpi',
      description: 'Search the SCPI command library by feature or keyword (e.g. "FastFrame", "trigger edge", "measurement frequency"). Use this when you know what you want to DO but not the exact command header. Returns syntax, examples, and commandId.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Feature or command to search, e.g. FastFrame.' },
          modelFamily: { type: 'string', description: 'Instrument model family filter, e.g. mso_5_series.' },
          limit: { type: 'number', description: 'Max results to return (default 10).' },
          commandType: { type: 'string', enum: ['set', 'query', 'both'], description: 'Optional command type filter.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_group',
      description:
        'Get all commands in a named group with group description. Use when user asks about a feature area, not a specific command.',
      parameters: {
        type: 'object',
        properties: {
          groupName: {
            type: 'string',
            enum: GROUP_NAMES,
            description: 'The command group to retrieve.',
          },
        },
        required: ['groupName'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_by_header',
      description: 'Exact lookup by known SCPI header (e.g. "HORizontal:FASTframe:STATE"). Use this instead of search_scpi when you already know the header. Faster and more precise than search.',
      parameters: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'Exact SCPI header, e.g. ACQuire:MODE?' },
          family: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['header'],
        additionalProperties: false,
      },
    },
    {
      name: 'verify_scpi_commands',
      description: 'Batch-verify multiple SCPI command strings at once. Use AFTER generating a full set of steps to confirm every command is valid before returning ACTIONS_JSON. Returns verified:true/false per command.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of SCPI command strings to verify.',
          },
          modelFamily: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['commands'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_tm_devices',
      description: 'Search tm_devices method tree and docstrings.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Method or feature query.' },
          model: { type: 'string', description: 'Optional model filter, e.g. MSO56.' },
          limit: { type: 'number', description: 'Max results to return (default 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'retrieve_rag_chunks',
      description: 'Retrieve documentation chunks from local knowledge base. corpus options: "scpi" | "tmdevices" | "templates" | "pyvisa_tekhsi" | "app_logic" | "error_patterns". Use for architecture questions, workflow patterns, known bugs, and connection examples.',
      parameters: {
        type: 'object',
        properties: {
          corpus: {
            type: 'string',
            enum: ['scpi', 'tmdevices', 'app_logic', 'errors', 'templates', 'pyvisa_tekhsi'],
          },
          query: { type: 'string', description: 'Search query text.' },
          topK: { type: 'number', description: 'Max chunks to return (default 5).' },
        },
        required: ['corpus', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_known_failures',
      description: 'Search known runtime failures and their fixes. Use when user reports an error, unexpected behavior, or asks why something is not working. Returns symptom/cause/fix triplets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symptom/error text to search.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_template_examples',
      description: 'Retrieve matching workflow template examples.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Template search query.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_policy',
      description: 'Load policy pack by mode.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['steps_json', 'blockly_xml', 'scpi_verification', 'response_format', 'backend_taxonomy'],
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_valid_step_types',
      description: 'List valid step/block types by mode and backend.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['steps_json', 'blockly_xml'] },
          backend: { type: 'string', description: 'Optional backend filter.' },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_block_schema',
      description: 'Get required fields and valid values for a block type.',
      parameters: {
        type: 'object',
        properties: {
          blockType: { type: 'string', description: 'Blockly block type name.' },
        },
        required: ['blockType'],
        additionalProperties: false,
      },
    },
    {
      name: 'validate_action_payload',
      description: 'Validate the ACTIONS_JSON payload structure before returning it to the user. Call this as the LAST step before outputting ACTIONS_JSON to catch schema errors, missing saveAs, and invalid step types.',
      parameters: {
        type: 'object',
        properties: {
          actionsJson: { type: 'object', description: 'Parsed ACTIONS_JSON object.' },
          originalSteps: { type: 'array', items: { type: 'object' }, description: 'Optional original steps for substitution checks.' },
        },
        required: ['actionsJson'],
        additionalProperties: false,
      },
    },
    {
      name: 'validate_device_context',
      description: 'Validate device context alignment for SCPI commands.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'object' }, description: 'Steps to validate.' },
        },
        required: ['steps'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_instrument_state',
      description: 'Probe instrument identity/state via code_executor.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'probe_command',
      description: 'Probe a single SCPI command via code_executor.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'SCPI command to probe.' },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_visa_resources',
      description: 'List VISA resources via code_executor.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_environment',
      description: 'Inspect runtime environment via code_executor.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  ];
}

export async function runTool(name: string, args: Record<string, unknown>) {
  const fn = (TOOL_HANDLERS as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[name];
  if (!fn) {
    return { ok: false, data: null, sourceMeta: [], warnings: [`Unknown tool: ${name}`] };
  }
  return fn(args);
}
