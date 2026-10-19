import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

/** New prompts use OpenH3 names; pending tool calls from old chats still work. */
export function registerProductTool<Args extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: Args,
  callback: ToolCallback<Args>
): void {
  server.tool(name, description, schema, callback);
  if (name.startsWith('openh3_')) {
    server.tool(name.replace(/^openh3_/, 'aionui_'), description, schema, callback);
  }
}
