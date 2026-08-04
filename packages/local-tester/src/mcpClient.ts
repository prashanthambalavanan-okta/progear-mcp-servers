import { randomUUID } from 'node:crypto';

/** Minimal client for one JSON-RPC call against a Streamable-HTTP MCP endpoint. */
export async function callMcpTool(opts: {
  mcpUrl: string;
  accessToken: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(opts.mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name: opts.toolName, arguments: opts.toolArguments },
    }),
  });

  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`MCP call failed (${res.status}): ${text}`);
  }

  if (contentType.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) throw new Error(`No data line in SSE response: ${text}`);
    return JSON.parse(dataLine.slice('data:'.length).trim());
  }

  return JSON.parse(text);
}
