import { fromMinorUnits } from './money';
import { getReportDate } from './reportDate';
import { computeNet, type SalesOrder } from './salesOrder';
import type { StoreRef } from './shopify';

/**
 * Square Orders + Payments client (REST via fetch).
 *
 * Square reports amounts in minor units already, so no decimal parsing is
 * needed. Unlike Shopify, Square *does* expose payment processing fees — they
 * live on the Payment, not the Order, so orders are joined to payments by
 * `order_id`.
 */

export const DEFAULT_SQUARE_API_VERSION = '2025-01-23';

const MAX_ATTEMPTS = 6;
const ORDER_PAGE_SIZE = 500;
const PAYMENT_PAGE_SIZE = 100;

export interface SquareCredentials {
  accessToken: string;
  locationId: string;
  environment: 'production' | 'sandbox';
  apiVersion?: string;
}

interface SquareMoney {
  amount?: number;
  currency?: string;
}

interface SquareLineItem {
  gross_sales_money?: SquareMoney;
}

interface SquareOrder {
  id: string;
  location_id?: string;
  created_at: string;
  updated_at?: string;
  state?: string;
  total_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_service_charge_money?: SquareMoney;
  line_items?: SquareLineItem[];
}

interface SquareProcessingFee {
  amount_money?: SquareMoney;
}

interface SquarePayment {
  id: string;
  order_id?: string;
  status?: string;
  processing_fee?: SquareProcessingFee[];
  refunded_money?: SquareMoney;
}

interface SquareApiError {
  category?: string;
  code?: string;
  detail?: string;
}

export class SquareError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SquareError';
  }
}

function baseUrl(credentials: SquareCredentials): string {
  return credentials.environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function squareRequest<T>(
  credentials: SquareCredentials,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const url = `${baseUrl(credentials)}${path}`;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Square-Version': credentials.apiVersion ?? DEFAULT_SQUARE_API_VERSION,
          'Content-Type': 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (error) {
      lastError = error as Error;
      await sleep(2 ** attempt * 250);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new SquareError(
        'Square rejected the access token (401/403). Check the token, its scopes (ORDERS_READ, PAYMENTS_READ) and the environment.',
        response.status,
      );
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new SquareError(`Square responded ${response.status}`, response.status);
      await sleep(2 ** attempt * 400);
      continue;
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new SquareError(`Square returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }

    const errors = (payload as { errors?: SquareApiError[] }).errors;
    if (errors?.length) {
      throw new SquareError(
        errors.map((e) => `${e.category ?? ''}/${e.code ?? ''}: ${e.detail ?? ''}`).join('; '),
        response.status,
      );
    }

    if (!response.ok) {
      throw new SquareError(`Square responded ${response.status}: ${text.slice(0, 200)}`, response.status);
    }

    return payload as T;
  }

  throw new SquareError(
    `Square request failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
}

/** Live credential check used by the store admin UI before saving. */
export async function validateSquareCredentials(
  credentials: SquareCredentials,
): Promise<{ locationName: string; currency: string }> {
  const payload = await squareRequest<{
    locations?: { id: string; name?: string; currency?: string }[];
  }>(credentials, '/v2/locations');

  const locations = payload.locations ?? [];
  const match = locations.find((l) => l.id === credentials.locationId);
  if (!match) {
    const available = locations.map((l) => `${l.id} (${l.name ?? 'unnamed'})`).join(', ');
    throw new SquareError(
      `Location "${credentials.locationId}" not found on this Square account. Available: ${available || 'none'}`,
    );
  }
  return { locationName: match.name ?? credentials.locationId, currency: match.currency ?? 'USD' };
}

export interface FetchSquareOptions {
  updatedSince?: Date;
  createdFrom?: Date;
  createdUntilExclusive?: Date;
}

/** Aggregate processing fees and refunds per order id, from the Payments API. */
async function fetchPaymentTotals(
  credentials: SquareCredentials,
  beginTime: Date,
  endTime: Date,
): Promise<Map<string, { fees: bigint; refunds: bigint }>> {
  const totals = new Map<string, { fees: bigint; refunds: bigint }>();
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      begin_time: beginTime.toISOString(),
      end_time: endTime.toISOString(),
      location_id: credentials.locationId,
      limit: String(PAYMENT_PAGE_SIZE),
      sort_order: 'ASC',
    });
    if (cursor) params.set('cursor', cursor);

    const payload = await squareRequest<{ payments?: SquarePayment[]; cursor?: string }>(
      credentials,
      `/v2/payments?${params.toString()}`,
    );

    for (const payment of payload.payments ?? []) {
      if (!payment.order_id) continue;
      const entry = totals.get(payment.order_id) ?? { fees: 0n, refunds: 0n };
      for (const fee of payment.processing_fee ?? []) {
        entry.fees += fromMinorUnits(fee.amount_money?.amount);
      }
      entry.refunds += fromMinorUnits(payment.refunded_money?.amount);
      totals.set(payment.order_id, entry);
    }

    cursor = payload.cursor;
  } while (cursor);

  return totals;
}

/** Fetch and normalise Square orders, joined to their payments for fees. */
export async function fetchSquareOrders(
  store: StoreRef,
  credentials: SquareCredentials,
  options: FetchSquareOptions,
): Promise<SalesOrder[]> {
  const useUpdatedAt = Boolean(options.updatedSince);
  const start = options.updatedSince ?? options.createdFrom;
  const end = options.createdUntilExclusive ?? new Date();
  if (!start) throw new SquareError('fetchSquareOrders requires updatedSince or createdFrom');

  const dateTimeFilter = useUpdatedAt
    ? { updated_at: { start_at: start.toISOString(), end_at: end.toISOString() } }
    : { created_at: { start_at: start.toISOString(), end_at: end.toISOString() } };

  // Processing fees settle asynchronously, so widen the payments window a
  // little on both sides to catch fees attached after the order closed.
  const paymentTotals = await fetchPaymentTotals(
    credentials,
    new Date(start.getTime() - 6 * 3_600_000),
    new Date(end.getTime() + 6 * 3_600_000),
  );

  const orders: SalesOrder[] = [];
  let cursor: string | undefined;

  do {
    const payload = await squareRequest<{ orders?: SquareOrder[]; cursor?: string }>(
      credentials,
      '/v2/orders/search',
      {
        method: 'POST',
        body: {
          location_ids: [credentials.locationId],
          limit: ORDER_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
          query: {
            filter: {
              date_time_filter: dateTimeFilter,
              state_filter: { states: ['COMPLETED', 'OPEN'] },
            },
            sort: {
              sort_field: useUpdatedAt ? 'UPDATED_AT' : 'CREATED_AT',
              sort_order: 'ASC',
            },
          },
        },
      },
    );

    for (const order of payload.orders ?? []) {
      const currency = order.total_money?.currency ?? store.currency;
      const createdAt = new Date(order.created_at);

      const lineItemGross = (order.line_items ?? []).reduce(
        (sum, item) => sum + fromMinorUnits(item.gross_sales_money?.amount),
        0n,
      );
      const discounts = fromMinorUnits(order.total_discount_money?.amount);
      const tax = fromMinorUnits(order.total_tax_money?.amount);
      const shipping = fromMinorUnits(order.total_service_charge_money?.amount);

      // Prefer line-item gross (genuinely pre-discount); fall back to deriving
      // it from the order total for orders without itemisation.
      const gross =
        lineItemGross > 0n
          ? lineItemGross
          : fromMinorUnits(order.total_money?.amount) - tax - shipping + discounts;

      const payments = paymentTotals.get(order.id) ?? { fees: 0n, refunds: 0n };

      orders.push({
        storeId: store.id,
        storeName: store.name,
        platform: 'square',
        platformId: order.id,
        orderNumber: order.id.slice(0, 8),
        createdAt,
        reportDate: getReportDate(createdAt),
        currency,
        gross,
        discounts,
        tax,
        shipping,
        fees: payments.fees,
        refunds: payments.refunds,
        net: computeNet({ gross, discounts, refunds: payments.refunds, fees: payments.fees }),
        status: order.state ?? null,
      });
    }

    cursor = payload.cursor;
  } while (cursor);

  return orders;
}
