import { buildMcpApp } from '@progear/shared';
import { buildServer } from './tools.js';

const app = buildMcpApp({ serviceName: 'progear-mcp-inventory', buildServer });
const port = Number(process.env.PORT ?? process.env.MCP_SERVER_PORT ?? 3001);

app.listen(port, () => {
  console.log(`ProGear Inventory MCP server listening on port ${port}`);
});
