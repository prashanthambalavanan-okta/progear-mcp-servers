import express from 'express';
import { buildMcpApp, type AuthOptions } from '@progear/shared';
import { buildServer as buildInventoryServer } from '@progear/mcp-inventory/tools';
import { buildServer as buildCustomerServer } from '@progear/mcp-customer/tools';
import { buildServer as buildSalesServer } from '@progear/mcp-sales/tools';
import { buildServer as buildPricingServer } from '@progear/mcp-pricing/tools';

const domain = process.env.OKTA_DOMAIN;
const allowInsecure = process.env.ALLOW_INSECURE === 'true';

function authFor(prefix: string): AuthOptions {
  return {
    domain,
    authServerId: process.env[`OKTA_${prefix}_AUTH_SERVER_ID`],
    audience: process.env[`OKTA_${prefix}_AUDIENCE`],
    allowInsecure,
  };
}

const domains = [
  { path: '/inventory', serviceName: 'progear-mcp-inventory', buildServer: buildInventoryServer, auth: authFor('INVENTORY') },
  { path: '/customer', serviceName: 'progear-mcp-customer', buildServer: buildCustomerServer, auth: authFor('CUSTOMER') },
  { path: '/sales', serviceName: 'progear-mcp-sales', buildServer: buildSalesServer, auth: authFor('SALES') },
  { path: '/pricing', serviceName: 'progear-mcp-pricing', buildServer: buildPricingServer, auth: authFor('PRICING') },
];

const app = express();

for (const d of domains) {
  if (!d.auth.audience && !allowInsecure) {
    console.warn(`[gateway] OKTA_${d.serviceName.split('-')[2].toUpperCase()}_AUDIENCE not set — ${d.path}/mcp will reject every request until it is`);
  }
  app.use(d.path, buildMcpApp({ serviceName: d.serviceName, buildServer: d.buildServer, auth: d.auth }));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'progear-mcp-gateway', mounts: domains.map((d) => `${d.path}/mcp`) });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`ProGear MCP gateway listening on port ${port}`);
  for (const d of domains) console.log(`  ${d.path}/mcp -> ${d.serviceName}`);
});
