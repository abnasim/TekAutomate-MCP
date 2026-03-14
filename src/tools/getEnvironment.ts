import { getEnvironmentProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
}

export async function getEnvironment(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return getEnvironmentProxy(input);
}
