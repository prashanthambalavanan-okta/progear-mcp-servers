function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  redirectUri: process.env.REDIRECT_URI ?? `http://localhost:${Number(process.env.PORT ?? 4000)}/callback`,
  gatewayBaseUrl: (process.env.MCP_GATEWAY_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),

  oktaDomain: () => required('OKTA_DOMAIN').replace(/\/$/, ''),
  clientId: () => required('OKTA_CLIENT_ID'),
  clientSecret: () => required('OKTA_CLIENT_SECRET'),
  /** Optional — if unset, ID-JAG step 1 goes to the org-level token endpoint (https://{domain}/oauth2/v1/token). */
  mainAuthServerId: () => process.env.OKTA_MAIN_AUTH_SERVER_ID || undefined,

  agentId: () => required('OKTA_AI_AGENT_ID'),
  agentPrivateJwk: () => JSON.parse(required('OKTA_AI_AGENT_PRIVATE_KEY')),
};

export interface DomainConfig {
  key: 'inventory' | 'customer' | 'sales' | 'pricing';
  label: string;
  scopes: string[];
  authServerIdEnv: string;
  audienceEnv: string;
  /** One representative read-only tool call used to demonstrate the exchange end-to-end. */
  demoTool: { name: string; arguments: Record<string, unknown> };
}

export const DOMAINS: DomainConfig[] = [
  {
    key: 'inventory',
    label: 'Inventory',
    scopes: ['inventory:read', 'inventory:write', 'inventory:alert'],
    authServerIdEnv: 'OKTA_INVENTORY_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_INVENTORY_AUDIENCE',
    demoTool: { name: 'check_stock', arguments: { sku: 'BB-PRO-001' } },
  },
  {
    key: 'customer',
    label: 'Customer',
    scopes: ['customer:read', 'customer:lookup', 'customer:history'],
    authServerIdEnv: 'OKTA_CUSTOMER_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_CUSTOMER_AUDIENCE',
    demoTool: { name: 'search_customers', arguments: { query: 'State' } },
  },
  {
    key: 'sales',
    label: 'Sales',
    scopes: ['sales:read', 'sales:quote', 'sales:order'],
    authServerIdEnv: 'OKTA_SALES_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_SALES_AUDIENCE',
    demoTool: { name: 'list_orders', arguments: {} },
  },
  {
    key: 'pricing',
    label: 'Pricing',
    scopes: ['pricing:read', 'pricing:margin', 'pricing:discount'],
    authServerIdEnv: 'OKTA_PRICING_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_PRICING_AUDIENCE',
    demoTool: { name: 'get_price', arguments: { sku: 'BB-PRO-001' } },
  },
];

export function domainAuthServerId(domain: DomainConfig): string {
  return required(domain.authServerIdEnv);
}

export function domainAudience(domain: DomainConfig): string {
  return required(domain.audienceEnv);
}
