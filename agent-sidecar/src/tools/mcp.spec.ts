import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { getMcpRuntimeStatus, loadMcpServerConfigsFromEnv } from './mcp.js';

const MCP_ENV_KEY = 'AGENT_MCP_SERVERS_JSON';
const originalMcpEnv = process.env[MCP_ENV_KEY];

const restoreOriginalEnv = (): void => {
  if (originalMcpEnv === undefined) {
    delete process.env[MCP_ENV_KEY];
    return;
  }

  process.env[MCP_ENV_KEY] = originalMcpEnv;
};

const setMcpEnv = (value: unknown): void => {
  process.env[MCP_ENV_KEY] = JSON.stringify(value);
};

describe('MCP sidecar config', () => {
  beforeEach(() => {
    delete process.env[MCP_ENV_KEY];
  });

  after(() => {
    restoreOriginalEnv();
  });

  it('returns an empty config when no MCP servers are configured', () => {
    assert.deepEqual(loadMcpServerConfigsFromEnv(), {
      configs: [],
      errors: [],
    });
  });

  it('loads array-form stdio server configs from AGENT_MCP_SERVERS_JSON', () => {
    setMcpEnv([
      {
        name: 'workspace-files',
        command: 'node',
        args: ['D:/mcp/filesystem-server.js'],
        env: {
          WORKSPACE_ROOT: 'D:/com.xiaojianc/my_desktop_app',
        },
        cwd: 'D:/com.xiaojianc/my_desktop_app',
      },
    ]);

    assert.deepEqual(loadMcpServerConfigsFromEnv(), {
      configs: [
        {
          name: 'workspace-files',
          command: 'node',
          args: ['D:/mcp/filesystem-server.js'],
          env: {
            WORKSPACE_ROOT: 'D:/com.xiaojianc/my_desktop_app',
          },
          cwd: 'D:/com.xiaojianc/my_desktop_app',
        },
      ],
      errors: [],
    });
  });

  it('loads Cursor-style mcpServers configs and skips disabled servers', () => {
    setMcpEnv({
      mcpServers: {
        filesystem: {
          command: 'node',
          args: ['D:/mcp/filesystem-server.js'],
          cwd: 'D:/com.xiaojianc/my_desktop_app',
        },
        search: {
          command: 'node',
          args: ['D:/mcp/web-search.js'],
          disabled: true,
        },
        customName: {
          name: 'renamed-server',
          command: 'npx',
          args: ['@modelcontextprotocol/server-example'],
          env: {
            SAMPLE_FLAG: '1',
          },
        },
      },
    });

    const loaded = loadMcpServerConfigsFromEnv();

    assert.deepEqual(loaded, {
      configs: [
        {
          name: 'filesystem',
          command: 'node',
          args: ['D:/mcp/filesystem-server.js'],
          env: {},
          cwd: 'D:/com.xiaojianc/my_desktop_app',
        },
        {
          name: 'renamed-server',
          command: 'npx',
          args: ['@modelcontextprotocol/server-example'],
          env: {
            SAMPLE_FLAG: '1',
          },
          cwd: null,
        },
      ],
      errors: [],
    });
  });

  it('reports invalid JSON without creating fake configs', () => {
    process.env[MCP_ENV_KEY] = '{not-json';

    const loaded = loadMcpServerConfigsFromEnv();

    assert.deepEqual(loaded.configs, []);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? '', /JSON|Expected|position/u);
  });

  it('exposes MCP health status for the Tauri health contract', () => {
    setMcpEnv({
      mcpServers: {
        filesystem: {
          command: 'node',
          args: ['D:/mcp/filesystem-server.js'],
        },
      },
    });

    assert.deepEqual(getMcpRuntimeStatus(), {
      configuredServers: 1,
      serverNames: ['filesystem'],
      errors: [],
    });
  });
});
