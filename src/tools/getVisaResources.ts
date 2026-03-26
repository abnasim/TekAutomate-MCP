import { getVisaResourcesProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

export async function getVisaResources(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return getVisaResourcesProxy(input);
}
