export interface ToolSourceMeta {
  file: string;
  commandId?: string;
  section?: string;
  score?: number;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data: T;
  sourceMeta: ToolSourceMeta[];
  warnings: string[];
}

export interface McpChatRequest {
  userMessage: string;
  outputMode: 'steps_json' | 'blockly_xml';
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  flowContext: {
    backend: string;
    host: string;
    port?: number;
    connectionType: string;
    modelFamily: string;
    firmware?: string;
    steps: Array<Record<string, unknown>>;
    selectedStepId: string | null;
    executionSource: 'steps' | 'blockly';
  };
  runContext: {
    runStatus: 'idle' | 'running' | 'done' | 'error' | 'connecting';
    logTail: string;
    auditOutput: string;
    exitCode: number | null;
    duration?: string;
  };
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
  };
}

export interface McpChatError {
  type: 'validation_error' | 'tool_error' | 'provider_error';
  message: string;
  details?: string[];
}
