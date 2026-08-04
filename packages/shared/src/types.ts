export interface InventoryItem {
  name: string;
  sku: string;
  category: string;
  quantity: number;
  status: 'good' | 'low';
  reorder_point: number;
}

export interface PricingEntry {
  price: number;
  cost: number;
  margin: number;
}

export interface Customer {
  id: string;
  name: string;
  contact: string;
  email: string;
  tier: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
  total_spent: number;
  location: string;
}

export interface Discounts {
  tier_discounts: Record<string, number>;
  volume_discounts: Record<string, number>;
}

export interface SeedData {
  inventory: Record<string, Omit<InventoryItem, 'sku'>>;
  pricing: Record<string, PricingEntry>;
  customers: Record<string, Customer>;
  discounts: Discounts;
}

export interface InventorySummary {
  total_products: number;
  total_items: number;
  total_value: number;
  low_stock_count: number;
  by_category: Record<string, { count: number; total_quantity: number; total_value: number }>;
}

export interface CustomerSummary {
  total_customers: number;
  total_revenue: number;
  by_tier: Record<string, { count: number; total_spent: number }>;
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderLineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  items: OrderLineItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
}

export interface Quote {
  id: string;
  customerId: string;
  customerName: string;
  customerTier: string;
  items: OrderLineItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  createdAt: string;
  validUntil: string;
}
