import { demoStore } from './store.js';
import type { Order, OrderLineItem, OrderStatus, Quote } from './types.js';

/**
 * In-memory orders/quotes ledger for the sales domain. Not part of the
 * ported dataset — seeded with a few sample orders, then grows as tools
 * create/cancel orders and quotes. Resets on process restart.
 */
class OrdersStore {
  private orders: Map<string, Order> = new Map();
  private quotes: Map<string, Quote> = new Map();
  private orderSeq = 0;
  private quoteSeq = 0;

  constructor() {
    this.seed();
  }

  private nextOrderId(): string {
    this.orderSeq += 1;
    return `ORD-${String(this.orderSeq).padStart(4, '0')}`;
  }

  private nextQuoteId(): string {
    this.quoteSeq += 1;
    return `QT-${String(this.quoteSeq).padStart(4, '0')}`;
  }

  private buildLineItems(items: Array<{ sku: string; quantity: number }>): {
    lineItems: OrderLineItem[];
    subtotal: number;
    error?: string;
  } {
    let subtotal = 0;
    const lineItems: OrderLineItem[] = [];

    for (const { sku, quantity } of items) {
      const product = demoStore.getInventoryBySku(sku);
      const price = demoStore.getPriceBySku(sku);
      if (!product || !price) {
        return { lineItems: [], subtotal: 0, error: `Unknown SKU: ${sku}` };
      }
      const lineTotal = price.price * quantity;
      subtotal += lineTotal;
      lineItems.push({ sku, name: product.name, quantity, unitPrice: price.price, lineTotal });
    }

    return { lineItems, subtotal };
  }

  private seed(): void {
    const sample = [
      { customerId: 'CUST-001', sku: 'BB-PRO-001', quantity: 50, status: 'shipped' as OrderStatus },
      { customerId: 'CUST-003', sku: 'UNI-JRS-001', quantity: 200, status: 'processing' as OrderStatus },
      { customerId: 'CUST-004', sku: 'BB-YTH5-001', quantity: 100, status: 'pending' as OrderStatus },
    ];

    for (const s of sample) {
      const customer = demoStore.getCustomerById(s.customerId);
      if (!customer) {
        console.warn(`[orders] seed skipped, unknown customer: ${s.customerId}`);
        continue;
      }
      const { lineItems, subtotal, error } = this.buildLineItems([{ sku: s.sku, quantity: s.quantity }]);
      if (error) {
        console.warn(`[orders] seed skipped: ${error}`);
        continue;
      }

      const discountPercent = demoStore.calculateTotalDiscount(customer.tier, s.quantity).total_discount;
      const discountAmount = subtotal * (discountPercent / 100);
      const id = this.nextOrderId();
      this.orders.set(id, {
        id,
        customerId: customer.id,
        customerName: customer.name,
        items: lineItems,
        subtotal,
        discountPercent,
        discountAmount,
        total: subtotal - discountAmount,
        status: s.status,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ==================== ORDERS ====================

  listOrders(status?: OrderStatus): Order[] {
    const all = Array.from(this.orders.values());
    return status ? all.filter((o) => o.status === status) : all;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  createOrder(customerId: string, items: Array<{ sku: string; quantity: number }>): Order | { error: string } {
    const customer = demoStore.getCustomerById(customerId);
    if (!customer) return { error: `Customer not found: ${customerId}` };

    const { lineItems, subtotal, error } = this.buildLineItems(items);
    if (error) return { error };

    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const discountPercent = demoStore.calculateTotalDiscount(customer.tier, totalQty).total_discount;
    const discountAmount = subtotal * (discountPercent / 100);

    const order: Order = {
      id: this.nextOrderId(),
      customerId: customer.id,
      customerName: customer.name,
      items: lineItems,
      subtotal,
      discountPercent,
      discountAmount,
      total: subtotal - discountAmount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  cancelOrder(id: string): Order | { error: string } {
    const order = this.orders.get(id);
    if (!order) return { error: `Order not found: ${id}` };
    if (order.status === 'shipped' || order.status === 'delivered') {
      return { error: `Order ${id} has already ${order.status} and cannot be cancelled` };
    }
    order.status = 'cancelled';
    return order;
  }

  getPipeline() {
    const all = this.listOrders();
    const byStatus: Record<string, { count: number; value: number }> = {};
    let pipelineValue = 0;

    for (const order of all) {
      const bucket = byStatus[order.status] ?? { count: 0, value: 0 };
      bucket.count += 1;
      bucket.value += order.total;
      byStatus[order.status] = bucket;
      if (order.status !== 'cancelled' && order.status !== 'delivered') {
        pipelineValue += order.total;
      }
    }

    return { total_orders: all.length, pipeline_value: pipelineValue, by_status: byStatus };
  }

  // ==================== QUOTES ====================

  listQuotes(): Quote[] {
    return Array.from(this.quotes.values());
  }

  createQuote(customerId: string, items: Array<{ sku: string; quantity: number }>): Quote | { error: string } {
    const customer = demoStore.getCustomerById(customerId);
    if (!customer) return { error: `Customer not found: ${customerId}` };

    const { lineItems, subtotal, error } = this.buildLineItems(items);
    if (error) return { error };

    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const discountPercent = demoStore.calculateTotalDiscount(customer.tier, totalQty).total_discount;
    const discountAmount = subtotal * (discountPercent / 100);

    const now = new Date();
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const quote: Quote = {
      id: this.nextQuoteId(),
      customerId: customer.id,
      customerName: customer.name,
      customerTier: customer.tier,
      items: lineItems,
      subtotal,
      discountPercent,
      discountAmount,
      total: subtotal - discountAmount,
      createdAt: now.toISOString(),
      validUntil: validUntil.toISOString(),
    };
    this.quotes.set(quote.id, quote);
    return quote;
  }
}

export const ordersStore = new OrdersStore();
export { OrdersStore };
