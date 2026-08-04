import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertScope, ordersStore } from '@progear/shared';

const SCOPES = {
  read: 'sales:read',
  quote: 'sales:quote',
  order: 'sales:order',
};

const lineItemSchema = z.object({
  sku: z.string().describe('Product SKU, e.g. "BB-PRO-001"'),
  quantity: z.number().int().positive(),
});

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function scopeError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'progear-sales', version: '0.1.0' });

  server.tool(
    'list_orders',
    'List orders, optionally filtered by status.',
    { status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional() },
    async ({ status }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const orders = ordersStore.listOrders(status);
      return json({ count: orders.length, orders });
    },
  );

  server.tool(
    'get_order',
    'Get a single order by ID.',
    { orderId: z.string() },
    async ({ orderId }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const order = ordersStore.getOrder(orderId);
      if (!order) return scopeError(`Order not found: ${orderId}`);
      return json(order);
    },
  );

  server.tool(
    'get_pipeline',
    'Get an aggregate view of order value and count by status.',
    {},
    async () => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      return json(ordersStore.getPipeline());
    },
  );

  server.tool(
    'create_quote',
    'Create a priced quote for a customer, applying tier + volume discounts.',
    { customerId: z.string(), items: z.array(lineItemSchema).min(1) },
    async ({ customerId, items }) => {
      const check = assertScope(SCOPES.quote);
      if (!check.ok) return scopeError(check.message);
      const quote = ordersStore.createQuote(customerId, items);
      if ('error' in quote) return scopeError(quote.error);
      return json(quote);
    },
  );

  server.tool(
    'create_order',
    'Create a new order for a customer, applying tier + volume discounts.',
    { customerId: z.string(), items: z.array(lineItemSchema).min(1) },
    async ({ customerId, items }) => {
      const check = assertScope(SCOPES.order);
      if (!check.ok) return scopeError(check.message);
      const order = ordersStore.createOrder(customerId, items);
      if ('error' in order) return scopeError(order.error);
      return json(order);
    },
  );

  server.tool(
    'cancel_order',
    'Cancel an existing order (not allowed once shipped or delivered).',
    { orderId: z.string() },
    async ({ orderId }) => {
      const check = assertScope(SCOPES.order);
      if (!check.ok) return scopeError(check.message);
      const result = ordersStore.cancelOrder(orderId);
      if ('error' in result) return scopeError(result.error);
      return json(result);
    },
  );

  return server;
}
