import { parseDecimalToMinor } from './money';
import { getReportDate } from './reportDate';
import { computeNet, type SalesChannel, type SalesOrder } from './salesOrder';

/**
 * Shopify Admin GraphQL client.
 *
 * Note: the Admin API does not expose payment processing fees, so `fees` is
 * always 0 for Shopify rows. Net therefore equals subtotal minus refunds.
 */

/** Current stable version. Shopify supports each release for 12 months. */
export const DEFAULT_SHOPIFY_API_VERSION = '2026-07';

const MAX_ATTEMPTS = 6;
const PAGE_SIZE = 100;

export interface ShopifyCredentials {
  /** `xxxx.myshopify.com` */
  domain: string;
  /**
   * Legacy long-lived `shpat_` token, OR — when `clientId` is set — the app's
   * client secret, which is exchanged for a short-lived token per sync.
   */
  accessToken: string;
  /**
   * Set for Dev Dashboard apps (Jan 2026 onward). Shopify stopped issuing
   * long-lived tokens for new apps; they mint one from client credentials that
   * expires in ~24 hours, so it must be re-minted rather than stored.
   */
  clientId?: string;
  apiVersion?: string;
}

export interface StoreRef {
  id: string;
  name: string;
  currency: string;
}

interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

interface ShopifyMoneyBag {
  shopMoney: ShopifyMoney;
}

interface ShopifyOrderNode {
  id: string;
  name: string | null;
  createdAt: string;
  test: boolean;
  sourceName: string | null;
  displayFinancialStatus: string | null;
  currencyCode: string;
  subtotalPriceSet: ShopifyMoneyBag | null;
  totalDiscountsSet: ShopifyMoneyBag | null;
  totalTaxSet: ShopifyMoneyBag | null;
  totalShippingPriceSet: ShopifyMoneyBag | null;
  totalRefundedSet: ShopifyMoneyBag | null;
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; restoreRate: number; maximumAvailable: number };
    };
  };
}

interface OrdersQueryData {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyOrderNode[];
  };
}

interface ShopQueryData {
  shop: { name: string; myshopifyDomain: string; currencyCode: string };
}

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

const ORDERS_QUERY = `
  query DailySalesOrders($query: String!, $cursor: String, $pageSize: Int!) {
    orders(first: $pageSize, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        test
        sourceName
        displayFinancialStatus
        currencyCode
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

const SHOP_QUERY = `
  query ShopCheck {
    shop { name myshopifyDomain currencyCode }
  }
`;

function endpoint(credentials: ShopifyCredentials): string {
  const version = credentials.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION;
  const domain = credentials.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Minted tokens live ~24h; cache them per shop+app for the process lifetime. */
const tokenCache = new Map<string, CachedToken>();

/** Refresh a little early so a token cannot expire mid-sync. */
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

async function mintAccessToken(credentials: ShopifyCredentials): Promise<string> {
  const clientId = credentials.clientId;
  if (!clientId) throw new ShopifyError('mintAccessToken called without a client id');

  const domain = credentials.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cacheKey = `${domain}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
    return cached.token;
  }

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: credentials.accessToken,
    }).toString(),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new ShopifyError(
      `Shopify refused the client credentials (${response.status}). Check the Client ID and Secret, and that the app is installed on ${domain}. ${body.slice(0, 200)}`,
      response.status,
    );
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(body) as { access_token?: string; expires_in?: number };
  } catch {
    throw new ShopifyError('Shopify returned a non-JSON token response');
  }
  if (!parsed.access_token) {
    throw new ShopifyError('Shopify returned no access_token for these client credentials');
  }

  const ttlMs = (parsed.expires_in ?? 86_399) * 1000;
  tokenCache.set(cacheKey, { token: parsed.access_token, expiresAt: Date.now() + ttlMs });
  return parsed.access_token;
}

/** Legacy stores hand us a token directly; Dev Dashboard stores mint one. */
async function resolveAccessToken(credentials: ShopifyCredentials): Promise<string> {
  return credentials.clientId ? mintAccessToken(credentials) : credentials.accessToken;
}

/** Execute a GraphQL request, retrying on throttling and transient 5xx. */
async function shopifyGraphql<T>(
  credentials: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQLResponse<T>> {
  let lastError: Error | undefined;
  const accessToken = await resolveAccessToken(credentials);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint(credentials), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      lastError = error as Error;
      await sleep(2 ** attempt * 250);
      continue;
    }

    // Distinguish the failure modes: they need different fixes from the user.
    if (response.status === 401) {
      throw new ShopifyError(
        credentials.clientId
          ? 'Shopify rejected the minted token (401). Re-check the Client ID and Secret, and that the app is still installed.'
          : 'Shopify rejected the access token (401) — it is invalid, expired, or revoked. Reconnect the store.',
        401,
      );
    }
    if (response.status === 403) {
      throw new ShopifyError(
        'Shopify denied the request (403) — the app is missing a required scope. Add read_orders (plus the Shopify Payments scopes) on the app version, then reinstall the app so the new scopes take effect.',
        403,
      );
    }
    if (response.status === 402) {
      throw new ShopifyError(
        "This shop's plan does not include access to this API (402).",
        402,
      );
    }
    if (response.status === 423) {
      throw new ShopifyError(
        'This Shopify shop is locked or unavailable (423) — the store itself is frozen, not the credentials.',
        423,
      );
    }
    if (response.status === 404) {
      throw new ShopifyError(
        `Shopify returned 404 for ${credentials.domain} — check the shop domain and API version.`,
        404,
      );
    }

    // 429 and 5xx are retryable.
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      lastError = new ShopifyError(`Shopify responded ${response.status}`, response.status);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250);
      continue;
    }

    if (!response.ok) {
      throw new ShopifyError(
        `Shopify responded ${response.status}: ${(await response.text()).slice(0, 300)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as GraphQLResponse<T>;

    const throttled = payload.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled) {
      // Cost-based limiter: wait for the leaky bucket to refill.
      const status = payload.extensions?.cost?.throttleStatus;
      const waitMs = status && status.restoreRate > 0
        ? Math.min(10_000, ((status.maximumAvailable - status.currentlyAvailable) / status.restoreRate) * 1000)
        : 2 ** attempt * 500;
      await sleep(Math.max(500, waitMs));
      continue;
    }

    if (payload.errors?.length) {
      // Missing scopes usually arrive as a 200 with ACCESS_DENIED, and the
      // message names the scope required — pass it through verbatim.
      const denied = payload.errors.find((e) => e.extensions?.code === 'ACCESS_DENIED');
      if (denied) {
        throw new ShopifyError(
          `Shopify denied access — ${denied.message} Add the scope on the app version, then reinstall the app.`,
        );
      }
      throw new ShopifyError(payload.errors.map((e) => e.message).join('; '));
    }

    return payload;
  }

  throw new ShopifyError(
    `Shopify request failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'throttled'}`,
  );
}

/** Live credential check used by the store admin UI before saving. */
export async function validateShopifyCredentials(
  credentials: ShopifyCredentials,
): Promise<{ name: string; domain: string; currency: string }> {
  const payload = await shopifyGraphql<ShopQueryData>(credentials, SHOP_QUERY);
  const shop = payload.data?.shop;
  if (!shop) throw new ShopifyError('Shopify did not return shop details');
  return { name: shop.name, domain: shop.myshopifyDomain, currency: shop.currencyCode };
}

/**
 * Map Shopify's `sourceName` onto a channel. Anything we do not recognise is
 * left null rather than guessed — an unknown channel should read as unknown,
 * not be silently filed under "online".
 */
function toChannel(sourceName: string | null): SalesChannel | null {
  if (!sourceName) return null;
  const value = sourceName.toLowerCase();
  if (value === 'pos' || value.includes('point_of_sale') || value.includes('point of sale')) {
    return 'pos';
  }
  if (value === 'web' || value === 'online_store' || value === 'shopify_draft_order') {
    return 'online';
  }
  return null;
}

function money(bag: ShopifyMoneyBag | null, fallbackCurrency: string): bigint {
  if (!bag?.shopMoney) return 0n;
  return parseDecimalToMinor(bag.shopMoney.amount, bag.shopMoney.currencyCode || fallbackCurrency);
}

export interface FetchShopifyOptions {
  /** Incremental sync: everything touched since this instant. */
  updatedSince?: Date;
  /** Backfill: half-open created_at window. */
  createdFrom?: Date;
  createdUntilExclusive?: Date;
}

function buildQuery(options: FetchShopifyOptions): string {
  const clauses: string[] = [];
  if (options.updatedSince) clauses.push(`updated_at:>='${options.updatedSince.toISOString()}'`);
  if (options.createdFrom) clauses.push(`created_at:>='${options.createdFrom.toISOString()}'`);
  if (options.createdUntilExclusive) {
    clauses.push(`created_at:<'${options.createdUntilExclusive.toISOString()}'`);
  }
  return clauses.join(' AND ');
}

/** Fetch and normalise orders. Test orders are excluded. */
export async function fetchShopifyOrders(
  store: StoreRef,
  credentials: ShopifyCredentials,
  options: FetchShopifyOptions,
): Promise<SalesOrder[]> {
  const query = buildQuery(options);
  const orders: SalesOrder[] = [];
  let cursor: string | null = null;

  do {
    const payload: GraphQLResponse<OrdersQueryData> = await shopifyGraphql<OrdersQueryData>(
      credentials,
      ORDERS_QUERY,
      { query, cursor, pageSize: PAGE_SIZE },
    );

    const page = payload.data?.orders;
    if (!page) throw new ShopifyError('Shopify returned no orders payload');

    for (const node of page.nodes) {
      if (node.test) continue; // never let test orders into a revenue report

      const currency = node.currencyCode || store.currency;
      const createdAt = new Date(node.createdAt);

      // subtotalPriceSet is *after* discounts, so add them back to get a true
      // pre-discount gross.
      const subtotal = money(node.subtotalPriceSet, currency);
      const discounts = money(node.totalDiscountsSet, currency);
      const gross = subtotal + discounts;
      const refunds = money(node.totalRefundedSet, currency);
      const fees = 0n; // not exposed by the Admin API

      orders.push({
        storeId: store.id,
        storeName: store.name,
        platform: 'shopify',
        platformId: node.id,
        orderNumber: node.name,
        createdAt,
        reportDate: getReportDate(createdAt),
        currency,
        channel: toChannel(node.sourceName),
        gross,
        discounts,
        tax: money(node.totalTaxSet, currency),
        shipping: money(node.totalShippingPriceSet, currency),
        fees,
        refunds,
        net: computeNet({ gross, discounts, refunds, fees }),
        status: node.displayFinancialStatus,
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return orders;
}
