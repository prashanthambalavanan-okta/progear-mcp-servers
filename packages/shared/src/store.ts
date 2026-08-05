import seed from './data/initial_data.json' with { type: 'json' };
import type {
  Customer,
  CustomerSummary,
  Discounts,
  InventoryItem,
  InventorySummary,
  PricingEntry,
  SeedData,
} from './types.js';

const initialData = seed as unknown as SeedData;

/**
 * In-memory data store seeded from the ported ProGear demo dataset.
 * State resets on process restart — this is a tools/data server, not a
 * system of record.
 */
class DemoStore {
  private inventory: Record<string, InventoryItem>;
  private pricing: Record<string, PricingEntry>;
  private customers: Record<string, Customer>;
  private discounts: Discounts;
  private customerSeq: number;

  constructor() {
    this.inventory = Object.fromEntries(
      Object.entries(initialData.inventory).map(([sku, item]) => [sku, { ...item, sku }]),
    );
    this.pricing = { ...initialData.pricing };
    this.customers = { ...initialData.customers };
    this.discounts = initialData.discounts;

    this.customerSeq = Object.keys(this.customers).reduce((max, id) => {
      const match = /^CUST-(\d+)$/.exec(id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  }

  private nextCustomerId(): string {
    this.customerSeq += 1;
    return `CUST-${String(this.customerSeq).padStart(3, '0')}`;
  }

  // ==================== INVENTORY ====================

  getAllInventory(): InventoryItem[] {
    return Object.values(this.inventory);
  }

  getInventoryBySku(sku: string): InventoryItem | undefined {
    return this.inventory[sku];
  }

  getInventoryByCategory(category: string): InventoryItem[] {
    const lower = category.toLowerCase();
    return this.getAllInventory().filter((item) => item.category.toLowerCase() === lower);
  }

  getInventoryByName(name: string): InventoryItem | undefined {
    const nameLower = name.toLowerCase().trim();
    const exact = this.getAllInventory().find((item) => item.name.toLowerCase() === nameLower);
    if (exact) return exact;

    const matches = this.getAllInventory().filter((item) => {
      const itemName = item.name.toLowerCase();
      return nameLower.includes(itemName) || itemName.includes(nameLower);
    });
    if (matches.length === 0) return undefined;

    matches.sort((a, b) => {
      const scoreOf = (item: InventoryItem) => nameLower.length / item.name.toLowerCase().length;
      return scoreOf(b) - scoreOf(a);
    });
    return matches[0];
  }

  searchInventory(query: string): InventoryItem[] {
    const queryLower = query.toLowerCase();
    return this.getAllInventory().filter(
      (item) =>
        item.name.toLowerCase().includes(queryLower) ||
        item.category.toLowerCase().includes(queryLower),
    );
  }

  getLowStockItems(): InventoryItem[] {
    return this.getAllInventory().filter(
      (item) => item.status === 'low' || item.quantity <= item.reorder_point,
    );
  }

  updateInventoryQuantity(
    skuOrName: string,
    quantityChange: number,
    operation: 'increase' | 'decrease' | 'set' = 'set',
  ): { sku: string; name: string; previous_quantity: number; new_quantity: number; change: number; status: string } | { error: string } {
    let sku = skuOrName;
    if (!this.inventory[sku]) {
      const byName = this.getInventoryByName(skuOrName);
      if (!byName) return { error: `Product not found: ${skuOrName}` };
      sku = byName.sku;
    }

    const item = this.inventory[sku];
    const previousQuantity = item.quantity;

    if (operation === 'increase') {
      item.quantity = previousQuantity + quantityChange;
    } else if (operation === 'decrease') {
      item.quantity = Math.max(0, previousQuantity - quantityChange);
    } else if (operation === 'set') {
      item.quantity = quantityChange;
    } else {
      return { error: `Unknown operation: ${operation}` };
    }

    item.status = item.quantity <= item.reorder_point ? 'low' : 'good';

    return {
      sku,
      name: item.name,
      previous_quantity: previousQuantity,
      new_quantity: item.quantity,
      change: item.quantity - previousQuantity,
      status: item.status,
    };
  }

  addInventoryItem(input: {
    sku: string;
    name: string;
    category: string;
    quantity: number;
    reorder_point: number;
    price: number;
    cost: number;
  }): InventoryItem | { error: string } {
    if (this.inventory[input.sku]) {
      return { error: `SKU already exists: ${input.sku}` };
    }

    const item: InventoryItem = {
      sku: input.sku,
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      reorder_point: input.reorder_point,
      status: input.quantity <= input.reorder_point ? 'low' : 'good',
    };
    this.inventory[input.sku] = item;
    this.pricing[input.sku] = {
      price: input.price,
      cost: input.cost,
      margin: Math.round(((input.price - input.cost) / input.price) * 1000) / 10,
    };

    return item;
  }

  deleteInventoryItem(sku: string): { ok: true } | { error: string } {
    if (!this.inventory[sku]) return { error: `Product not found: ${sku}` };
    delete this.inventory[sku];
    delete this.pricing[sku];
    return { ok: true };
  }

  getInventorySummary(): InventorySummary {
    const categories: InventorySummary['by_category'] = {};
    let totalItems = 0;
    let totalValue = 0;
    let lowStockCount = 0;

    for (const item of this.getAllInventory()) {
      const price = this.pricing[item.sku]?.price ?? 0;
      const category = categories[item.category] ?? { count: 0, total_quantity: 0, total_value: 0 };
      category.count += 1;
      category.total_quantity += item.quantity;
      category.total_value += item.quantity * price;
      categories[item.category] = category;

      totalItems += item.quantity;
      totalValue += item.quantity * price;
      if (item.status === 'low') lowStockCount += 1;
    }

    return {
      total_products: this.getAllInventory().length,
      total_items: totalItems,
      total_value: Math.round(totalValue * 100) / 100,
      low_stock_count: lowStockCount,
      by_category: categories,
    };
  }

  // ==================== PRICING ====================

  getAllPricing(): Array<PricingEntry & { sku: string; name: string }> {
    return Object.entries(this.pricing).map(([sku, entry]) => ({
      sku,
      name: this.inventory[sku]?.name ?? 'Unknown',
      ...entry,
    }));
  }

  getPriceBySku(sku: string): (PricingEntry & { sku: string; name: string }) | undefined {
    const entry = this.pricing[sku];
    if (!entry) return undefined;
    return { sku, name: this.inventory[sku]?.name ?? 'Unknown', ...entry };
  }

  getPricingByCategory(category: string): Array<PricingEntry & { sku: string; name: string }> {
    const lower = category.toLowerCase();
    return this.getAllInventory()
      .filter((item) => item.category.toLowerCase() === lower)
      .filter((item) => this.pricing[item.sku])
      .map((item) => ({ sku: item.sku, name: item.name, ...this.pricing[item.sku] }));
  }

  updatePrice(skuOrName: string, newPrice: number): { sku: string; name: string; old_price: number; new_price: number; margin: number } | { error: string } {
    let sku = skuOrName;
    if (!this.pricing[sku]) {
      const byName = this.getInventoryByName(skuOrName);
      if (!byName) return { error: `Product not found: ${skuOrName}` };
      sku = byName.sku;
    }
    if (!this.pricing[sku]) return { error: `Pricing not found for: ${skuOrName}` };

    const entry = this.pricing[sku];
    const oldPrice = entry.price;
    entry.price = newPrice;
    entry.margin = Math.round(((newPrice - entry.cost) / newPrice) * 1000) / 10;

    return {
      sku,
      name: this.inventory[sku]?.name ?? 'Unknown',
      old_price: oldPrice,
      new_price: newPrice,
      margin: entry.margin,
    };
  }

  // ==================== CUSTOMERS ====================

  getAllCustomers(): Customer[] {
    return Object.values(this.customers);
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customers[id];
  }

  getCustomerByName(name: string): Customer | undefined {
    const nameLower = name.toLowerCase();
    return this.getAllCustomers().find((c) => c.name.toLowerCase().includes(nameLower));
  }

  getCustomersByTier(tier: string): Customer[] {
    const lower = tier.toLowerCase();
    return this.getAllCustomers().filter((c) => c.tier.toLowerCase() === lower);
  }

  searchCustomers(query: string): Customer[] {
    const queryLower = query.toLowerCase();
    return this.getAllCustomers().filter(
      (c) =>
        c.name.toLowerCase().includes(queryLower) ||
        c.contact.toLowerCase().includes(queryLower) ||
        c.location.toLowerCase().includes(queryLower),
    );
  }

  addCustomer(input: {
    name: string;
    contact: string;
    email: string;
    tier: Customer['tier'];
    location: string;
    total_spent?: number;
  }): Customer {
    const customer: Customer = {
      id: this.nextCustomerId(),
      name: input.name,
      contact: input.contact,
      email: input.email,
      tier: input.tier,
      location: input.location,
      total_spent: input.total_spent ?? 0,
    };
    this.customers[customer.id] = customer;
    return customer;
  }

  deleteCustomer(id: string): { ok: true } | { error: string } {
    if (!this.customers[id]) return { error: `Customer not found: ${id}` };
    delete this.customers[id];
    return { ok: true };
  }

  getCustomerSummary(): CustomerSummary {
    const byTier: CustomerSummary['by_tier'] = {};
    let totalSpent = 0;

    for (const customer of this.getAllCustomers()) {
      const tier = byTier[customer.tier] ?? { count: 0, total_spent: 0 };
      tier.count += 1;
      tier.total_spent += customer.total_spent;
      byTier[customer.tier] = tier;
      totalSpent += customer.total_spent;
    }

    return {
      total_customers: this.getAllCustomers().length,
      total_revenue: totalSpent,
      by_tier: byTier,
    };
  }

  // ==================== DISCOUNTS ====================

  getDiscountStructure(): Discounts {
    return this.discounts;
  }

  getTierDiscount(tier: string): number {
    return this.discounts.tier_discounts[tier] ?? 0;
  }

  getVolumeDiscount(quantity: number): number {
    let discount = 0;
    for (const [threshold, disc] of Object.entries(this.discounts.volume_discounts).sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    )) {
      if (quantity >= Number(threshold)) discount = disc;
    }
    return discount;
  }

  calculateTotalDiscount(tier: string, quantity: number) {
    const tierDiscount = this.getTierDiscount(tier);
    const volumeDiscount = this.getVolumeDiscount(quantity);
    return {
      tier,
      tier_discount: tierDiscount,
      quantity,
      volume_discount: volumeDiscount,
      total_discount: tierDiscount + volumeDiscount,
    };
  }
}

export const demoStore = new DemoStore();
export { DemoStore };
