import express from 'express';
import { buildMcpApp, mountProtectedResourceMetadata, type AuthOptions } from '@progear/shared';
import { createTesterApp } from '@progear/local-tester/app';
import { buildServer as buildInventoryServer } from '@progear/mcp-inventory/tools';
import { buildServer as buildCustomerServer } from '@progear/mcp-customer/tools';
import { buildServer as buildSalesServer } from '@progear/mcp-sales/tools';
import { buildServer as buildPricingServer } from '@progear/mcp-pricing/tools';

const oktaDomain = process.env.OKTA_DOMAIN?.replace(/\/$/, '');
const allowInsecure = process.env.ALLOW_INSECURE === 'true';
// The demo UI shares this process and origin with the MCP endpoints, which
// keeps it to one deployment. Set ENABLE_TESTER_UI=false to serve MCP only —
// worth doing if this process is ever exposed to agents you don't control,
// since the UI holds the ID-JAG signing key.
const enableTesterUi = process.env.ENABLE_TESTER_UI !== 'false';

const domains = [
  {
    path: '/inventory',
    prefix: 'INVENTORY',
    serviceName: 'progear-mcp-inventory',
    resourceName: 'ProGear Inventory MCP',
    scopes: ['inventory:read', 'inventory:write', 'inventory:alert'],
    buildServer: buildInventoryServer,
  },
  {
    path: '/customer',
    prefix: 'CUSTOMER',
    serviceName: 'progear-mcp-customer',
    resourceName: 'ProGear Customer MCP',
    scopes: ['customer:read', 'customer:lookup', 'customer:history', 'customer:write'],
    buildServer: buildCustomerServer,
  },
  {
    path: '/sales',
    prefix: 'SALES',
    serviceName: 'progear-mcp-sales',
    resourceName: 'ProGear Sales MCP',
    scopes: ['sales:read', 'sales:quote', 'sales:order'],
    buildServer: buildSalesServer,
  },
  {
    path: '/pricing',
    prefix: 'PRICING',
    serviceName: 'progear-mcp-pricing',
    resourceName: 'ProGear Pricing MCP',
    scopes: ['pricing:read', 'pricing:margin', 'pricing:discount'],
    buildServer: buildPricingServer,
  },
];

/** Each domain has its own Okta Custom Authorization Server. */
function issuerFor(prefix: string): string | undefined {
  const authServerId = process.env[`OKTA_${prefix}_AUTH_SERVER_ID`];
  if (!oktaDomain || !authServerId) return undefined;
  return `${oktaDomain}/oauth2/${authServerId}`;
}

function authFor(prefix: string, resourcePath: string): AuthOptions {
  return {
    issuer: issuerFor(prefix),
    audience: process.env[`OKTA_${prefix}_AUDIENCE`],
    resourcePath,
    allowInsecure,
  };
}

const app = express();

// Render terminates TLS in front of us, so the metadata documents can only
// advertise https:// URLs if we trust X-Forwarded-Proto. Mounted sub-apps
// inherit this setting from the root app.
app.set('trust proxy', true);

// Discovery must live at the root: clients fetch
// /.well-known/oauth-protected-resource/inventory/mcp, not
// /inventory/.well-known/... — so this cannot go inside buildMcpApp.
mountProtectedResourceMetadata(
  app,
  domains.map((d) => ({
    resourcePath: `${d.path}/mcp`,
    issuer: issuerFor(d.prefix),
    scopes: d.scopes,
    resourceName: d.resourceName,
  })),
);

for (const d of domains) {
  const auth = authFor(d.prefix, `${d.path}/mcp`);
  if (!auth.audience && !allowInsecure) {
    console.warn(`[gateway] OKTA_${d.prefix}_AUDIENCE not set — ${d.path}/mcp will reject every request until it is`);
  }
  if (!auth.issuer && !allowInsecure) {
    console.warn(`[gateway] OKTA_DOMAIN / OKTA_${d.prefix}_AUTH_SERVER_ID not set — ${d.path}/mcp cannot advertise its authorization server`);
  }
  app.use(d.path, buildMcpApp({ serviceName: d.serviceName, buildServer: d.buildServer, auth }));
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'progear-mcp-gateway',
    testerUi: enableTesterUi ? '/' : null,
    mounts: domains.map((d) => ({
      mcp: `${d.path}/mcp`,
      resourceMetadata: `/.well-known/oauth-protected-resource${d.path}/mcp`,
      authorizationServer: issuerFor(d.prefix) ?? null,
    })),
  });
});

// Mounted last so it can own '/' without shadowing /health, the MCP endpoints,
// or the discovery documents. Its OAuth redirect URI and MCP base URL are
// derived from the request, so no extra URL config is needed here.
if (enableTesterUi) {
  if (!process.env.OKTA_CLIENT_ID || !process.env.OKTA_AI_AGENT_ID) {
    console.warn('[gateway] tester UI is on but OKTA_CLIENT_ID / OKTA_AI_AGENT_ID are not set — sign-in will fail');
  }
  app.use(createTesterApp({ sameOriginGateway: true }));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`ProGear MCP gateway listening on port ${port}`);
  for (const d of domains) console.log(`  ${d.path}/mcp -> ${d.serviceName}`);
  if (enableTesterUi) console.log('  /            -> tester UI');
});
