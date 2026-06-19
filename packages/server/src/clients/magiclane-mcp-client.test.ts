import { describe, expect, it } from 'vitest';

import { resolveServerOptions } from './magiclane-mcp-client.js';

describe('resolveServerOptions', () => {
  it('uses HTTP transport when a URL is configured, with a bearer header when keyed', () => {
    expect(resolveServerOptions({ url: 'https://mcp.example.com', apiKey: 'key' })).toEqual({
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer key' },
    });
  });

  it('omits the bearer header for an unauthenticated HTTP service', () => {
    expect(resolveServerOptions({ url: 'https://mcp.example.com' })).toEqual({
      transport: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('falls back to npx-spawning the published package when only a key is set', () => {
    expect(resolveServerOptions({ apiKey: 'key' })).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '-p', '@magiclane/mcp-server', 'magiclane-mcp'],
      env: { MAGICLANE_API_KEY: 'key' },
    });
  });

  it('throws when neither a URL nor an API key is available', () => {
    expect(() => resolveServerOptions({})).toThrow(/MAGICLANE_API_KEY or MAGICLANE_MCP_URL/);
  });
});
