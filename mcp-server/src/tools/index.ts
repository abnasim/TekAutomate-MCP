import { getCommandByHeader } from './getCommandByHeader';
import { getCommandsByHeaderBatch } from './getCommandsByHeaderBatch';
import { getCommandGroup } from './getCommandGroup';
import { getEnvironment } from './getEnvironment';
import { getInstrumentState } from './getInstrumentState';
import { getPolicy } from './getPolicy';
import { getTemplateExamples } from './getTemplateExamples';
import { getVisaResources } from './getVisaResources';
import { getBlockSchema } from './getBlockSchema';
import { listValidStepTypes } from './listValidStepTypes';
import { materializeScpiCommand } from './materializeScpiCommand';
import { materializeScpiCommands } from './materializeScpiCommands';
import { finalizeScpiCommands } from './finalizeScpiCommands';
import { materializeTmDevicesCall } from './materializeTmDevicesCall';
import { probeCommand } from './probeCommand';
import { captureScreenshot } from './captureScreenshot';
import { sendScpi } from './sendScpi';
import { retrieveRagChunks } from './retrieveRagChunks';
import { searchKnownFailures } from './searchKnownFailures';
import { searchScpi } from './searchScpi';
import { searchTmDevices } from './searchTmDevices';
import { smartScpiLookup } from '../core/smartScpiAssistant';
import { validateActionPayload } from './validateActionPayload';
import { validateDeviceContext } from './validateDeviceContext';
import { verifyScpiCommands } from './verifyScpiCommands';
import { browseScpiCommands } from './browseScpiCommands';
import { discoverScpi } from './discoverScpi';
import { GROUP_NAMES, COMMAND_GROUPS } from '../core/commandGroups';
import { TEK_ROUTER_TOOL_DEFINITION } from '../core/toolRouter';

export const TOOL_HANDLERS = {
  tek_router: async (args: Record<string, unknown>) => {
    const { tekRouter } = await import('../core/toolRouter');
    return tekRouter(args as any);
  },
  smart_scpi_lookup: smartScpiLookup,
  search_scpi: searchScpi,
  save_learned_workflow: async (input: {
    name: string;
    description: string;
    triggers: string[];
    steps: Array<{ tool: string; args: Record<string, unknown>; description?: string }>;
  }) => {
    try {
      const { tekRouter } = await import('../core/toolRouter');
      const id = `shortcut:learned_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now()}`;
      const result = await tekRouter({
        action: 'create',
        toolId: id,
        toolName: input.name,
        toolDescription: input.description,
        toolTriggers: input.triggers,
        toolTags: ['learned', 'live_mode', 'shortcut'],
        toolCategory: 'shortcut',
        toolSteps: input.steps,
      });
      if (result.ok) {
        // Persist immediately
        const { persistRuntimeShortcuts } = await import('../core/routerIntegration');
        await persistRuntimeShortcuts();
      }
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  list_command_groups: async () => ({
    ok: true,
    data: GROUP_NAMES.map((name) => ({
      name,
      description: COMMAND_GROUPS[name]?.description || '',
      commandCount: COMMAND_GROUPS[name]?.commands?.length || 0,
    })),
    sourceMeta: [],
    warnings: [],
  }),
  get_command_group: getCommandGroup,
  get_command_by_header: getCommandByHeader,
  get_commands_by_header_batch: getCommandsByHeaderBatch,
  verify_scpi_commands: verifyScpiCommands,
  browse_scpi_commands: browseScpiCommands,
  search_tm_devices: searchTmDevices,
  retrieve_rag_chunks: retrieveRagChunks,
  search_known_failures: searchKnownFailures,
  get_template_examples: getTemplateExamples,
  get_policy: getPolicy,
  list_valid_step_types: listValidStepTypes,
  get_block_schema: getBlockSchema,
  materialize_scpi_command: materializeScpiCommand,
  materialize_scpi_commands: materializeScpiCommands,
  finalize_scpi_commands: finalizeScpiCommands,
  materialize_tm_devices_call: materializeTmDevicesCall,
  validate_action_payload: validateActionPayload,
  validate_device_context: validateDeviceContext,
  get_instrument_state: getInstrumentState,
  probe_command: probeCommand,
  send_scpi: sendScpi,
  discover_scpi: discoverScpi,
  capture_screenshot: captureScreenshot,
  get_visa_resources: getVisaResources,
  get_environment: getEnvironment,
} as const;

export type ToolName = keyof typeof TOOL_HANDLERS;

export function getToolDefinitions() {
  return [
    TEK_ROUTER_TOOL_DEFINITION,
    {
      name: 'smart_scpi_lookup',
      description:
        'Natural language SCPI command finder for Tektronix oscilloscopes. ' +
        'Ask in plain English what you want to do with the scope, get back exact SCPI commands ' +
        'with syntax, arguments, valid values, and code examples.\n\n' +
        'Examples of good queries:\n' +
        '- "how do I measure voltage on channel 1"\n' +
        '- "add eye diagram measurement"\n' +
        '- "configure I2C bus decode on bus 1"\n' +
        '- "set trigger to falling edge at 1.5V"\n' +
        '- "save screenshot to USB"\n' +
        '- "what is the sampling rate"\n' +
        '- "add jitter measurement with detailed results"\n\n' +
        'Returns: matching SCPI commands with full syntax, valid argument values, ' +
        'and Python/SCPI code examples. For broad queries, returns a conversational ' +
        'menu to narrow down options.\n\n' +
        'If this tool returns no results or the wrong commands, use browse_scpi_commands ' +
        'to iteratively explore the command database by group and keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: 'What you want to do with the oscilloscope, in plain English. ' +
              'Include the measurement type, channel, or feature you want to control.'
          },
          modelFamily: { type: 'string', description: 'Optional model family filter: MSO2, MSO4, MSO5, MSO6, MSO7, DPO5000, AFG, AWG, etc.' },
          context: { type: 'string', description: 'Additional context about the use case or instrument setup.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_scpi',
      description: 'Search SCPI commands by feature or keyword (e.g. "FastFrame", "trigger edge", "measurement frequency"). Use for normal scope SCPI work when backend is pyvisa/vxi11/tekhsi or when the user wants SCPI. Do not overfit exact submodels; the scope corpus is already split into modern MSO 2/4/5/6/7 vs legacy 5k/7k/70k families.',
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
      name: 'save_learned_workflow',
      description: 'Save a successful sequence of SCPI commands as a reusable workflow. Call this AFTER you have achieved the user\'s goal through exploration. The saved workflow will be available for instant recall next time.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name for the workflow (e.g. "Eye Diagram Jitter Setup")' },
          description: { type: 'string', description: 'What this workflow achieves' },
          triggers: {
            type: 'array', items: { type: 'string' },
            description: 'Natural language phrases that should trigger this workflow (e.g. ["setup eye diagram", "jitter measurement", "eye jitter"])'
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: 'Tool name that was called (e.g. "send_scpi")' },
                args: { type: 'object', description: 'Arguments that were passed to the tool' },
                description: { type: 'string', description: 'What this step does' },
              },
            },
            description: 'The sequence of tool calls that achieved the goal (only the successful ones)'
          },
        },
        required: ['name', 'description', 'triggers', 'steps'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_command_groups',
      description: `List all SCPI command groups with descriptions and command counts. Use this first to discover what feature areas are available, then use get_command_group to browse commands in a specific group. Known groups: ${GROUP_NAMES.join(', ')}.`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_group',
      description:
        'Get all commands in a named group with full details (header, syntax, arguments, examples). Use to browse all commands for a feature area. Returns the complete command entries, not just headers.',
      parameters: {
        type: 'object',
        properties: {
          groupName: {
            type: 'string',
            description: 'Exact group name from the known groups list.',
          },
          modelFamily: { type: 'string', description: 'Instrument model family filter, e.g. mso_5_series.' },
        },
        required: ['groupName'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_by_header',
      description: 'Exact lookup by known SCPI header (e.g. "HORizontal:FASTframe:STATE"). Prefer over search_scpi when you already know the header — faster and more precise.',
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
      name: 'get_commands_by_header_batch',
      description:
        'Batch exact lookup for multiple known SCPI headers in one call. Prefer over repeated get_command_by_header when the request needs several related headers.',
      parameters: {
        type: 'object',
        properties: {
          headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exact canonical SCPI headers to resolve in one call.',
          },
          family: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['headers'],
        additionalProperties: false,
      },
    },
    {
      name: 'verify_scpi_commands',
      description: 'Batch-verify multiple SCPI command strings. Use AFTER generating all steps to confirm every command is valid before returning ACTIONS_JSON.',
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
      name: 'browse_scpi_commands',
      description:
        'Interactive 3-level drill-down for exploring SCPI commands. ' +
        'Use when smart_scpi_lookup returns no results or you need to browse commands iteratively.\n\n' +
        'Level 1 (no args): List all command groups (Vertical, Trigger, Measurement, Bus, etc.)\n' +
        'Level 2 (group): List commands in a group, optionally filtered by keyword\n' +
        'Level 3 (header): Full command details — syntax, arguments, valid values, examples\n\n' +
        'Call sequence example:\n' +
        '1. browse_scpi_commands() → see all groups\n' +
        '2. browse_scpi_commands({group: "Trigger"}) → see trigger commands\n' +
        '3. browse_scpi_commands({group: "Trigger", filter: "edge"}) → narrow to edge trigger\n' +
        '4. browse_scpi_commands({header: "TRIGger:A:EDGE:SOUrce"}) → full details',
      parameters: {
        type: 'object',
        properties: {
          group: {
            type: 'string',
            description: 'Command group to browse (e.g. "Trigger", "Measurement", "Vertical"). Omit to list all groups.',
          },
          header: {
            type: 'string',
            description: 'Specific SCPI command header to get full details for (e.g. "TRIGger:A:EDGE:SOUrce").',
          },
          modelFamily: {
            type: 'string',
            description: 'Optional model family filter: MSO2, MSO4, MSO5, MSO6, MSO7, etc.',
          },
          filter: {
            type: 'string',
            description: 'Keyword to filter commands within a group (e.g. "edge" within Trigger group).',
          },
          limit: {
            type: 'number',
            description: 'Max commands to return (default 30, max 100).',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'search_tm_devices',
      description: 'Search tm_devices Python library method tree and docstrings. ONLY use when backend is tm_devices or when the user explicitly asks to convert SCPI to tm_devices. Do not use for normal scope SCPI tasks like screenshot, FastFrame, trigger, or basic measurements.',
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
      description: 'Retrieve docs from local knowledge base. corpus: "scpi"|"tmdevices"|"templates"|"pyvisa_tekhsi"|"app_logic"|"error_patterns". Use for architecture questions, workflow patterns, known bugs, connection examples.',
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
      description: 'Search known runtime failures and fixes. Use when user reports errors or unexpected behavior. Returns symptom/cause/fix triplets.',
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
      name: 'materialize_scpi_command',
      description: 'Build an exact concrete SCPI command string from a verified canonical command record. Use after search_scpi or get_command_by_header. Pass placeholderBindings such as {"CH<x>":"CH1","MEAS<x>":"MEAS1","{A|B}":"A"} and arguments or value for set syntax. If the user already specified a concrete instance like CH1 or B1, also pass concreteHeader so MCP can infer placeholder bindings deterministically. Copy the returned command verbatim into params.command.',
      parameters: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'Canonical SCPI header from source of truth, e.g. CH<x>:TERmination.' },
          concreteHeader: { type: 'string', description: 'Optional concrete header from the user intent, e.g. CH1:TERmination or BUS:B1:CAN:SOUrce, used to infer placeholder bindings.' },
          family: { type: 'string', description: 'Optional family filter.' },
          commandType: { type: 'string', enum: ['set', 'query'], description: 'Whether to materialize the set or query syntax.' },
          placeholderBindings: {
            type: 'object',
            description: 'Exact placeholder replacements, e.g. {"CH<x>":"CH1","MEAS<x>":"MEAS1","{A|B}":"A","<x>":"1"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          argumentBindings: {
            type: 'object',
            description: 'Optional exact replacements for argument placeholders, e.g. {"<NR3>":"50"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          arguments: {
            type: 'array',
            description: 'Optional positional values to substitute into remaining argument placeholders in syntax order.',
            items: { type: ['string', 'number', 'boolean'] },
          },
          value: {
            type: ['string', 'number', 'boolean'],
            description: 'Shorthand single positional value for simple set commands.',
          },
        },
        required: ['header'],
        additionalProperties: false,
      },
    },
    {
      name: 'materialize_scpi_commands',
      description:
        'Batch-build exact concrete SCPI command strings from verified canonical command records. Prefer over repeated materialize_scpi_command when several related commands must be instantiated in one turn.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of batch SCPI materialization requests.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string' },
                concreteHeader: { type: 'string' },
                family: { type: 'string' },
                commandType: { type: 'string', enum: ['set', 'query'] },
                placeholderBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                argumentBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                arguments: {
                  type: 'array',
                  items: { type: ['string', 'number', 'boolean'] },
                },
                value: { type: ['string', 'number', 'boolean'] },
              },
              required: ['header'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    {
      name: 'finalize_scpi_commands',
      description:
        'One-call SCPI endgame for hosted chat: batch-build exact concrete SCPI command strings from verified canonical headers and confirm they passed MCP exact verification. Prefer this over separate materialize_scpi_commands plus verify_scpi_commands for common requests.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of SCPI commands to finalize in one call.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string' },
                concreteHeader: { type: 'string' },
                family: { type: 'string' },
                commandType: { type: 'string', enum: ['set', 'query'] },
                placeholderBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                argumentBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                arguments: {
                  type: 'array',
                  items: { type: ['string', 'number', 'boolean'] },
                },
                value: { type: ['string', 'number', 'boolean'] },
              },
              required: ['header'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    {
      name: 'materialize_tm_devices_call',
      description: 'Build an exact tm_devices Python call from a verified methodPath returned by search_tm_devices. Pass placeholderBindings such as {"channel":"1"} for paths like ch[x].termination.write, plus positional or keyword arguments, then copy the returned code verbatim into tm_device_command params.code.',
      parameters: {
        type: 'object',
        properties: {
          methodPath: { type: 'string', description: 'Verified tm_devices methodPath, e.g. ch[x].termination.write.' },
          model: { type: 'string', description: 'Optional model filter.' },
          objectName: { type: 'string', description: 'Optional root object name, default "scope".' },
          placeholderBindings: {
            type: 'object',
            description: 'Placeholder replacements for methodPath, e.g. {"channel":"1"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          arguments: {
            type: 'array',
            description: 'Positional Python arguments for the call.',
            items: {},
          },
          keywordArguments: {
            type: 'object',
            description: 'Keyword Python arguments for the call.',
            additionalProperties: true,
          },
        },
        required: ['methodPath'],
        additionalProperties: false,
      },
    },
    {
      name: 'validate_action_payload',
      description: 'Validate the ACTIONS_JSON payload structure. Call this as the LAST step before outputting ACTIONS_JSON — catches missing saveAs, invalid step types, and schema errors.',
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
      description: 'Probe instrument identity/state via code_executor. Requires liveMode=true. Use outputMode="verbose" for full Python stdout/stderr/transcript. To target a different instrument, pass its VISA resource string as visaResource (e.g. "TCPIP::192.168.1.100::INSTR").',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'probe_command',
      description: 'Probe a single SCPI command on any VISA instrument via code_executor. Requires liveMode=true. Use outputMode="verbose" to return full runtime output instead of only the query result. To target a different instrument, pass its VISA resource string as visaResource (e.g. "TCPIP::192.168.1.100::INSTR").',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'SCPI command to probe.' },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'send_scpi',
      description: 'Send one or more SCPI commands to any VISA instrument via code_executor. Requires liveMode=true. Queries return responses; writes return OK or error status. To target a different instrument than the default, pass its VISA resource string as visaResource (e.g. "TCPIP::192.168.1.100::INSTR"). Check the instruments list in the workspace context for available VISA resources.',
      parameters: {
        type: 'object',
        properties: {
          commands: { type: 'array', items: { type: 'string' }, description: 'SCPI commands to send in order.' },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
          timeoutMs: { type: 'number', description: 'Optional per-command timeout in milliseconds.' },
        },
        required: ['commands'],
        additionalProperties: false,
      },
    },
    {
      name: 'capture_screenshot',
      description: 'Capture a fresh scope screenshot. The image always updates the user\'s UI. Pass analyze:true ONLY when you need to see and analyze the image yourself (e.g. diagnosing errors, reading measurements). Default: capture only (no image returned to you, saves tokens).',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
          scopeType: { type: 'string', enum: ['modern', 'legacy'] },
          modelFamily: { type: 'string' },
          deviceDriver: { type: 'string' },
          analyze: { type: 'boolean', description: 'Set true to receive the image for AI analysis. Default false (capture only, updates UI).' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_visa_resources',
      description: 'List all available VISA resources (instruments) via code_executor. Requires liveMode=true. Use this to discover which instruments are connected and their VISA resource strings. Use outputMode="verbose" for full runtime output.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_environment',
      description: 'Inspect runtime environment via code_executor. Requires liveMode=true. Use outputMode="verbose" for full runtime output.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'discover_scpi',
      description:
        'Tree-walk a live instrument to discover valid SCPI command paths. ' +
        'Given a base path like "TRIGger:A:LEVel" or "CH1:SV", systematically probes ' +
        'common suffixes and returns which ones the instrument actually responds to.\n\n' +
        'Use this when:\n' +
        '- smart_scpi_lookup or search_scpi returns no results\n' +
        '- You suspect undocumented commands exist\n' +
        '- You need to find the exact path for a feature\n' +
        '- The database is missing commands for a specific subsystem\n\n' +
        'Examples:\n' +
        '- discover_scpi({basePath: "TRIGger:A:LEVel"}) → finds TRIGger:A:LEVel:CH1, :MAGnitude, etc.\n' +
        '- discover_scpi({basePath: "SV:CH1", depth: "deep"}) → finds all Spectrum View sub-paths\n' +
        '- discover_scpi({basePath: "CH<x>:SV"}) → expands CH1-CH4 and probes all\n\n' +
        'Requires liveMode=true (must be connected to a live instrument).',
      parameters: {
        type: 'object',
        properties: {
          basePath: {
            type: 'string',
            description: 'Base SCPI path to explore. e.g. "TRIGger:A:LEVel", "SV:CH1", "CH<x>:BANdwidth". Use <x> for channel placeholders.',
          },
          depth: {
            type: 'string',
            enum: ['shallow', 'deep'],
            description: 'shallow (default): ~30 common suffixes. deep: ~70 suffixes including channel expansions and RF traces.',
          },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          modelFamily: { type: 'string' },
        },
        required: ['basePath'],
        additionalProperties: false,
      },
    },
  ];
}

export async function runTool(name: string, args: Record<string, unknown>) {
  const fn = (TOOL_HANDLERS as unknown as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[name];
  if (!fn) {
    return { ok: false, data: null, sourceMeta: [], warnings: [`Unknown tool: ${name}`] };
  }
  return fn(args);
}
