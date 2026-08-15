import type { ReportDate } from './reportDate';

export type Platform = 'shopify' | 'square';
export type SalesChannel = 'pos' | 'online';

/**
 * One order, normalised across platforms. All amounts are integer minor units
 * in the order's own currency — no FX conversion anywhere.
 */
export interface SalesOrder {
  storeId: string;
  storeName: string;
  platform: Platform;
  platformId: string;
  orderNumber: string | null;
  createdAt: Date;
  reportDate: ReportDate;
  currency: string;
  /** Sales channel, when the platform reports one we recognise. */
  channel: SalesChannel | null;
  /** Items total before discounts. */
  gross: bigint;
  discounts: bigint;
  tax: bigint;
  shipping: bigint;
  /** Payment processing fees. Always 0n for Shopify — the Admin API omits them. */
  fees: bigint;
  refunds: bigint;
  /** gross - discounts - refunds - fees */
  net: bigint;
  status: string | null;
}

export function computeNet(order: {
  gross: bigint;
  discounts: bigint;
  refunds: bigint;
  fees: bigint;
}): bigint {
  return order.gross - order.discounts - order.refunds - order.fees;
}
