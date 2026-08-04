import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertScope, demoStore } from '@progear/shared';

const SCOPES = {
  read: 'pricing:read',
  margin: 'pricing:margin',
  discount: 'pricing:discount',
};

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function scopeError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'progear-pricing', version: '0.1.0' });

  server.tool(
    'get_price',
    'Get price, cost, and margin for a product by SKU.',
    { sku: z.string().describe('Product SKU, e.g. "BB-PRO-001"') },
    async ({ sku }) => {
      const check = assertScope(SCOPES.read);
      if (!check.ok) return scopeError(check.message);
      const price = demoStore.getPriceBySku(sku);
      if (!price) return scopeError(`Pricing not found for SKU: ${sku}`);
      return json(price);
    },
  );

  server.tool(
    'get_category_pricing',
    'Get pricing and margin for every product in a category.',
    { category: z.string().describe('Category name, e.g. "Basketballs"') },
    async ({ category }) => {
      const check = assertScope(SCOPES.margin);
      if (!check.ok) return scopeError(check.message);
      const items = demoStore.getPricingByCategory(category);
      if (items.length === 0) return scopeError(`No pricing found for category: ${category}`);
      const avgMargin = items.reduce((sum, i) => sum + i.margin, 0) / items.length;
      return json({ category, count: items.length, averageMargin: Math.round(avgMargin * 10) / 10, items });
    },
  );

  server.tool(
    'calculate_bulk_price',
    'Calculate a bulk-order price for a product given quantity and customer tier.',
    {
      sku: z.string(),
      quantity: z.number().int().positive(),
      customerTier: z.enum(['Platinum', 'Gold', 'Silver', 'Bronze']).optional(),
    },
    async ({ sku, quantity, customerTier }) => {
      const check = assertScope(SCOPES.discount);
      if (!check.ok) return scopeError(check.message);

      const price = demoStore.getPriceBySku(sku);
      if (!price) return scopeError(`Pricing not found for SKU: ${sku}`);

      const volumeDiscount = demoStore.getVolumeDiscount(quantity);
      const tierDiscount = customerTier ? demoStore.getTierDiscount(customerTier) : 0;
      const totalDiscountPercent = volumeDiscount + tierDiscount;

      const subtotal = price.price * quantity;
      const discountAmount = subtotal * (totalDiscountPercent / 100);
      const finalTotal = subtotal - discountAmount;

      return json({
        sku,
        name: price.name,
        quantity,
        basePrice: price.price,
        subtotal,
        volumeDiscount,
        tierDiscount,
        totalDiscountPercent,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalTotal: Math.round(finalTotal * 100) / 100,
        finalUnitPrice: Math.round((finalTotal / quantity) * 100) / 100,
      });
    },
  );

  server.tool(
    'get_discount_structure',
    'Get the full volume- and tier-discount schedule.',
    {},
    async () => {
      const check = assertScope(SCOPES.discount);
      if (!check.ok) return scopeError(check.message);
      return json(demoStore.getDiscountStructure());
    },
  );

  return server;
}
