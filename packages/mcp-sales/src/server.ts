import { buildMcpApp } from '@progear/shared';
import { buildServer } from './tools.js';

const app = buildMcpApp({ serviceName: 'progear-mcp-sales', buildServer });
const port = Number(process.env.PORT ?? process.env.MCP_SERVER_PORT ?? 3003);

app.listen(port, () => {
  console.log(`ProGear Sales MCP server listening on port ${port}`);
});
