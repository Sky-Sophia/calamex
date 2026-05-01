import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpClient } from '@strands-agents/sdk';
import { z } from 'zod';

export interface IMcpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export interface IMcpClientBundle {
  clients: McpClient[];
  configs: IMcpServerConfig[];
  errors: string[];
  disconnectAll: () => Promise<void>;
}

export interface IMcpRuntimeStatus {
  configuredServers: number;
  serverNames: string[];
  errors: string[];
}

const mcpServerConfigSchema = z.object({
  name: z.string().min(1).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().min(1).nullable().optional(),
  disabled: z.boolean().default(false),
});

const mcpServersArraySchema = z.array(mcpServerConfigSchema);

const mcpServersObjectSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema),
});

const toConfig = (
  fallbackName: string,
  value: z.infer<typeof mcpServerConfigSchema>,
): IMcpServerConfig | null => {
  if (value.disabled) {
    return null;
  }

  return {
    name: value.name?.trim() || fallbackName,
    command: value.command,
    args: value.args,
    env: value.env,
    cwd: value.cwd ?? null,
  };
};

const normalizeParsedConfig = (value: unknown): IMcpServerConfig[] => {
  const arrayResult = mcpServersArraySchema.safeParse(value);
  if (arrayResult.success) {
    return arrayResult.data
      .map((item, index) => toConfig(item.name ?? `mcp-${index + 1}`, item))
      .filter((item): item is IMcpServerConfig => item !== null);
  }

  const objectResult = mcpServersObjectSchema.safeParse(value);
  if (objectResult.success) {
    return Object.entries(objectResult.data.mcpServers)
      .map(([name, item]) => toConfig(name, item))
      .filter((item): item is IMcpServerConfig => item !== null);
  }

  throw new Error('AGENT_MCP_SERVERS_JSON 必须是 MCP server 数组，或 { "mcpServers": { ... } } 结构。');
};

export const loadMcpServerConfigsFromEnv = (): {
  configs: IMcpServerConfig[];
  errors: string[];
} => {
  const rawConfig = process.env.AGENT_MCP_SERVERS_JSON?.trim();

  if (!rawConfig) {
    return {
      configs: [],
      errors: [],
    };
  }

  try {
    return {
      configs: normalizeParsedConfig(JSON.parse(rawConfig)),
      errors: [],
    };
  } catch (error) {
    return {
      configs: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
};

export const createMcpClientBundle = (): IMcpClientBundle => {
  const { configs, errors } = loadMcpServerConfigsFromEnv();
  const clients: McpClient[] = [];
  const safeBaseEnv = getDefaultEnvironment();

  for (const config of configs) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...safeBaseEnv,
        ...config.env,
      },
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: 'pipe',
    });

    clients.push(new McpClient({
      applicationName: 'xiaojianc-agent-sidecar',
      applicationVersion: '0.1.0',
      transport,
      disableMcpInstrumentation: true,
    }));
  }

  return {
    clients,
    configs,
    errors,
    disconnectAll: async (): Promise<void> => {
      await Promise.allSettled(clients.map((client) => client.disconnect()));
    },
  };
};

export const getMcpRuntimeStatus = (): IMcpRuntimeStatus => {
  const { configs, errors } = loadMcpServerConfigsFromEnv();

  return {
    configuredServers: configs.length,
    serverNames: configs.map((config) => config.name),
    errors,
  };
};
