import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertScope, demoStore } from '@progear/shared';

const SCOPES = {
  read: 'inventory:read',
  write: 'inventory:write',
  alert: 'inventory:alert',
};

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function scopeError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'progear-inventory', version: '0.1.0' });

  server.tool(
    'list_products',
    'List basketball-equipment products, optionally filtered by category.',
    { category: z.string().optional().describe('Category name, e.g. "Basketballs" or "Hoops"') },
    async ({ category }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const products = category ? demoStore.getInventoryByCategory(category) : demoStore.getAllInventory();
      return json({ count: products.length, products });
    },
  );

  server.tool(
    'search_inventory',
    'Search products by name or category keyword.',
    { query: z.string().describe('Search term, e.g. "jersey" or "basketball"') },
    async ({ query }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const results = demoStore.searchInventory(query);
      return json({ query, count: results.length, results });
    },
  );

  server.tool(
    'check_stock',
    'Check current stock level and reorder status for a product by SKU.',
    { sku: z.string().describe('Product SKU, e.g. "BB-PRO-001"') },
    async ({ sku }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const item = demoStore.getInventoryBySku(sku);
      if (!item) return scopeError(`Product not found: ${sku}`);
      return json(item);
    },
  );

  server.tool(
    'get_low_stock_alerts',
    'List all products at or below their reorder point.',
    {},
    async () => {
      const check = assertScope(SCOPES.alert);
      if (!check.ok) return scopeError(check.message);
      const items = demoStore.getLowStockItems();
      return json({ count: items.length, items });
    },
  );

  server.tool(
    'get_inventory_summary',
    'Get an aggregate inventory summary by category (total units, value, low-stock count).',
    {},
    async () => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      return json(demoStore.getInventorySummary());
    },
  );

  server.tool(
    'update_inventory_quantity',
    'Increase, decrease, or set the stock quantity for a product.',
    {
      sku: z.string().describe('Product SKU or exact/partial product name'),
      quantity: z.number().int().describe('Amount to apply, per `operation`'),
      operation: z.enum(['increase', 'decrease', 'set']).default('increase'),
    },
    async ({ sku, quantity, operation }) => {
      const check = assertScope(SCOPES.write);
      if (!check.ok) return scopeError(check.message);
      const result = demoStore.updateInventoryQuantity(sku, quantity, operation);
      if ('error' in result) return scopeError(result.error);
      return json(result);
    },
  );

  server.tool(
    'add_inventory_item',
    'Add a brand-new product to inventory, with its price and cost.',
    {
      sku: z.string().describe('New, unique product SKU, e.g. "BB-NEW-001"'),
      name: z.string().describe('Product name'),
      category: z.string().describe('Category, e.g. "Basketballs" or "Hoops"'),
      quantity: z.number().int().describe('Starting stock quantity'),
      reorder_point: z.number().int().describe('Quantity at or below which the item is low stock'),
      price: z.number().positive().describe('Sale price'),
      cost: z.number().positive().describe('Unit cost'),
    },
    async (input) => {
      const check = assertScope(SCOPES.write);
      if (!check.ok) return scopeError(check.message);
      const result = demoStore.addInventoryItem(input);
      if ('error' in result) return scopeError(result.error);
      return json(result);
    },
  );

  server.tool(
    'delete_inventory_item',
    'Remove a product from inventory entirely.',
    { sku: z.string().describe('Product SKU to remove') },
    async ({ sku }) => {
      const check = assertScope(SCOPES.write);
      if (!check.ok) return scopeError(check.message);
      const result = demoStore.deleteInventoryItem(sku);
      if ('error' in result) return scopeError(result.error);
      return json(result);
    },
  );

  return server;
}
