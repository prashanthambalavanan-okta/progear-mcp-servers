import type { Request } from 'express';
import { publicBaseUrl } from '@progear/shared';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** Standalone defaults. Mounted inside the gateway, both come from the request. */
  redirectUri: process.env.REDIRECT_URI ?? `http://localhost:${Number(process.env.PORT ?? 4000)}/callback`,
  gatewayBaseUrl: (process.env.MCP_GATEWAY_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),

  oktaDomain: () => required('OKTA_DOMAIN').replace(/\/$/, ''),
  clientId: () => required('OKTA_CLIENT_ID'),
  clientSecret: () => required('OKTA_CLIENT_SECRET'),
  /** Optional — if unset, ID-JAG step 1 goes to the org-level token endpoint (https://{domain}/oauth2/v1/token). */
  mainAuthServerId: () => process.env.OKTA_MAIN_AUTH_SERVER_ID || undefined,
  /**
   * Issuer the human login runs against. `OKTA_ISSUER` wins — set it to a full
   * issuer URL, either the org issuer (`https://{domain}`) or a Custom
   * Authorization Server's (`https://{domain}/oauth2/{ausId}`), and /authorize
   * and /token are derived from it. Otherwise it falls back to
   * `OKTA_MAIN_AUTH_SERVER_ID`, then to the org issuer, so leaving it unset
   * behaves exactly as before.
   *
   * Note the ID-JAG exchange still runs at the org (or main) authorization
   * server — Okta issues ID-JAGs there, not at a per-resource Custom AS. Point
   * OKTA_ISSUER at a Custom AS and the login token may not be accepted as the
   * exchange's subject token; keep both on the same AS if you hit that.
   */
  loginIssuer: (): string => {
    const explicit = process.env.OKTA_ISSUER?.replace(/\/$/, '');
    if (explicit) return explicit;
    const domain = required('OKTA_DOMAIN').replace(/\/$/, '');
    const mainAuthServerId = process.env.OKTA_MAIN_AUTH_SERVER_ID;
    return mainAuthServerId ? `${domain}/oauth2/${mainAuthServerId}` : domain;
  },

  agentId: () => required('OKTA_AI_AGENT_ID'),
  agentPrivateJwk: () => JSON.parse(required('OKTA_AI_AGENT_PRIVATE_KEY')),
  /**
   * RFC 8707 resource indicator sent with the human login — the *agent's*
   * resource URL. It audience-binds the access token the user gets back to the
   * agent that will run the ID-JAG exchange on their behalf, so that token's
   * `aud` is the agent rather than Okta's own API. Optional: when unset the
   * `resource` parameter is left off /authorize and /token entirely.
   */
  agentAudience: () => process.env.OKTA_AI_AGENT_AUDIENCE || undefined,
  /**
   * Which of the user's login tokens is presented as the ID-JAG subject token.
   * Okta accepts either urn:...:token-type:id_token or :access_token. Defaults
   * to the access token once it is audience-bound to the agent (above), else
   * the ID token. Set OKTA_ID_JAG_SUBJECT_TOKEN to force one.
   */
  idJagSubjectTokenType: (): 'id_token' | 'access_token' => {
    const override = process.env.OKTA_ID_JAG_SUBJECT_TOKEN;
    if (override === 'id_token' || override === 'access_token') return override;
    return process.env.OKTA_AI_AGENT_AUDIENCE ? 'access_token' : 'id_token';
  },
};

/**
 * An OAuth endpoint on an issuer. A Custom Authorization Server's issuer already
 * carries `/oauth2/{ausId}`, so its endpoints hang straight off it; the org
 * issuer is the bare domain, whose endpoints live under `/oauth2/v1`.
 */
export function issuerEndpoint(issuer: string, endpoint: 'authorize' | 'token'): string {
  return issuer.includes('/oauth2/') ? `${issuer}/v1/${endpoint}` : `${issuer}/oauth2/v1/${endpoint}`;
}

/**
 * Where Okta should send the user back to. An explicit REDIRECT_URI always
 * wins — it has to match the Okta app registration character for character.
 * Otherwise, when the UI is served by the gateway itself the callback is on
 * that same origin, so derive it from the request (this is what makes the
 * single-service deployment need no URL configuration at all).
 */
export function resolveRedirectUri(req: Request, sameOriginGateway: boolean): string {
  if (process.env.REDIRECT_URI) return process.env.REDIRECT_URI;
  return sameOriginGateway ? `${publicBaseUrl(req)}/callback` : config.redirectUri;
}

/** Origin the MCP endpoints are on — same as the UI's when mounted in the gateway. */
export function resolveGatewayBaseUrl(req: Request, sameOriginGateway: boolean): string {
  if (process.env.MCP_GATEWAY_BASE_URL) return config.gatewayBaseUrl;
  return sameOriginGateway ? publicBaseUrl(req) : config.gatewayBaseUrl;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Display-only — the exchange always requests the domain's full scope set, not just this one. */
  scope: string;
  mutates: boolean;
  defaultArguments: Record<string, unknown>;
}

export interface DomainConfig {
  key: 'inventory' | 'customer' | 'sales' | 'pricing';
  label: string;
  scopes: string[];
  authServerIdEnv: string;
  audienceEnv: string;
  tools: ToolSpec[];
}

export const DOMAINS: DomainConfig[] = [
  {
    key: 'inventory',
    label: 'Inventory',
    scopes: ['inventory:read', 'inventory:write', 'inventory:alert'],
    authServerIdEnv: 'OKTA_INVENTORY_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_INVENTORY_AUDIENCE',
    tools: [
      {
        name: 'list_products',
        description: 'List products, optionally filtered by category.',
        scope: 'inventory:read',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'search_inventory',
        description: 'Search inventory by name or category keyword.',
        scope: 'inventory:read',
        mutates: false,
        defaultArguments: { query: 'basketball' },
      },
      {
        name: 'check_stock',
        description: 'Get the stock level and reorder status for a SKU.',
        scope: 'inventory:read',
        mutates: false,
        defaultArguments: { sku: 'BB-PRO-001' },
      },
      {
        name: 'get_low_stock_alerts',
        description: 'List items at or below their reorder point.',
        scope: 'inventory:alert',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'get_inventory_summary',
        description: 'Aggregate inventory summary by category.',
        scope: 'inventory:read',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'update_inventory_quantity',
        description: 'Increase, decrease, or set the stock quantity for a SKU.',
        scope: 'inventory:write',
        mutates: true,
        defaultArguments: { sku: 'BB-PRO-001', quantity: 1, operation: 'increase' },
      },
      {
        name: 'add_inventory_item',
        description: 'Add a brand-new product to inventory, with its price and cost.',
        scope: 'inventory:write',
        mutates: true,
        defaultArguments: {
          sku: 'BB-NEW-001',
          name: 'Test Basketball',
          category: 'Basketballs',
          quantity: 100,
          reorder_point: 20,
          price: 29.99,
          cost: 15,
        },
      },
      {
        name: 'delete_inventory_item',
        description: 'Remove a product from inventory entirely.',
        scope: 'inventory:write',
        mutates: true,
        defaultArguments: { sku: 'BB-NEW-001' },
      },
    ],
  },
  {
    key: 'customer',
    label: 'Customer',
    scopes: ['customer:read', 'customer:lookup', 'customer:history', 'customer:write'],
    authServerIdEnv: 'OKTA_CUSTOMER_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_CUSTOMER_AUDIENCE',
    tools: [
      {
        name: 'get_customer',
        description: 'Get a customer account by ID.',
        scope: 'customer:read',
        mutates: false,
        defaultArguments: { customerId: 'CUST-001' },
      },
      {
        name: 'search_customers',
        description: 'Search customers by name, contact, or location.',
        scope: 'customer:lookup',
        mutates: false,
        defaultArguments: { query: 'State' },
      },
      {
        name: 'get_customers_by_tier',
        description: 'List customers in a loyalty tier.',
        scope: 'customer:lookup',
        mutates: false,
        defaultArguments: { tier: 'Gold' },
      },
      {
        name: 'get_top_customers',
        description: 'List the top customers by lifetime spend.',
        scope: 'customer:history',
        mutates: false,
        defaultArguments: { limit: 10 },
      },
      {
        name: 'get_customer_summary',
        description: 'Aggregate customer summary by tier.',
        scope: 'customer:history',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'add_customer',
        description: 'Add a new customer account.',
        scope: 'customer:write',
        mutates: true,
        defaultArguments: {
          name: 'Test Customer',
          contact: 'Jane Doe',
          email: 'jane@example.com',
          tier: 'Silver',
          location: 'Columbus, OH',
          total_spent: 0,
        },
      },
      {
        name: 'delete_customer',
        description: 'Remove a customer account.',
        scope: 'customer:write',
        mutates: true,
        defaultArguments: { customerId: 'CUST-035' },
      },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    scopes: ['sales:read', 'sales:quote', 'sales:order'],
    authServerIdEnv: 'OKTA_SALES_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_SALES_AUDIENCE',
    tools: [
      {
        name: 'list_orders',
        description: 'List orders, optionally filtered by status.',
        scope: 'sales:read',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'get_order',
        description: 'Get a single order by ID.',
        scope: 'sales:read',
        mutates: false,
        defaultArguments: { orderId: 'ORD-001' },
      },
      {
        name: 'get_pipeline',
        description: 'Aggregate order value and count by status.',
        scope: 'sales:read',
        mutates: false,
        defaultArguments: {},
      },
      {
        name: 'create_quote',
        description: 'Generate a priced quote with tier and volume discounts.',
        scope: 'sales:quote',
        mutates: true,
        defaultArguments: { customerId: 'CUST-001', items: [{ sku: 'BB-PRO-001', quantity: 1 }] },
      },
      {
        name: 'create_order',
        description: 'Create a new order with tier and volume discounts applied.',
        scope: 'sales:order',
        mutates: true,
        defaultArguments: { customerId: 'CUST-001', items: [{ sku: 'BB-PRO-001', quantity: 1 }] },
      },
      {
        name: 'cancel_order',
        description: 'Cancel an order (blocked if already shipped or delivered).',
        scope: 'sales:order',
        mutates: true,
        defaultArguments: { orderId: 'ORD-001' },
      },
    ],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    scopes: ['pricing:read', 'pricing:margin', 'pricing:discount'],
    authServerIdEnv: 'OKTA_PRICING_AUTH_SERVER_ID',
    audienceEnv: 'OKTA_PRICING_AUDIENCE',
    tools: [
      {
        name: 'get_price',
        description: 'Get price, cost, and margin for a SKU.',
        scope: 'pricing:read',
        mutates: false,
        defaultArguments: { sku: 'BB-PRO-001' },
      },
      {
        name: 'get_category_pricing',
        description: 'Get pricing and margin for all products in a category.',
        scope: 'pricing:margin',
        mutates: false,
        defaultArguments: { category: 'Apparel' },
      },
      {
        name: 'calculate_bulk_price',
        description: 'Compute bulk price with volume and tier discounts.',
        scope: 'pricing:discount',
        mutates: false,
        defaultArguments: { sku: 'BB-PRO-001', quantity: 10, customerTier: 'Gold' },
      },
      {
        name: 'get_discount_structure',
        description: 'Get the full volume and tier discount schedule.',
        scope: 'pricing:discount',
        mutates: false,
        defaultArguments: {},
      },
    ],
  },
];

export function domainAuthServerId(domain: DomainConfig): string {
  return required(domain.authServerIdEnv);
}

export function domainAudience(domain: DomainConfig): string {
  return required(domain.audienceEnv);
}
