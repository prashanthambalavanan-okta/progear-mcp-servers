import { buildMcpApp } from '@progear/shared';
import { buildServer } from './tools.js';

const app = buildMcpApp({ serviceName: 'progear-mcp-customer', buildServer });
const port = Number(process.env.PORT ?? process.env.MCP_SERVER_PORT ?? 3002);

app.listen(port, () => {
  console.log(`ProGear Customer MCP server listening on port ${port}`);
});
