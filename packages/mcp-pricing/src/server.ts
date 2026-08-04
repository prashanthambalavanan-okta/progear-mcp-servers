import { buildMcpApp } from '@progear/shared';
import { buildServer } from './tools.js';

const app = buildMcpApp({ serviceName: 'progear-mcp-pricing', buildServer });
const port = Number(process.env.PORT ?? process.env.MCP_SERVER_PORT ?? 3004);

app.listen(port, () => {
  console.log(`ProGear Pricing MCP server listening on port ${port}`);
});
