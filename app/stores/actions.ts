'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { encryptToken } from '@/lib/crypto';
import {
  createStore,
  generateStoreId,
  getStore,
  setStoreActive,
  updateStore,
} from '@/lib/repo';
import { validateShopifyCredentials } from '@/lib/shopify';
import { validateSquareCredentials } from '@/lib/square';

function back(message: string, kind: 'error' | 'ok' = 'error'): never {
  redirect(`/stores?${kind}=${encodeURIComponent(message.slice(0, 300))}`);
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/**
 * Add a store. Credentials are proved against the live API *before* anything is
 * written — a store that cannot authenticate never reaches the database.
 */
export async function addStoreAction(form: FormData): Promise<void> {
  const name = field(form, 'name');
  const platform = field(form, 'platform');
  const requestedCurrency = field(form, 'currency').toUpperCase();
  const token = field(form, 'token');

  if (!name) back('Store name is required');
  if (!token) back('API token is required');
  if (platform !== 'shopify' && platform !== 'square') back('Pick a platform');
  if (requestedCurrency && !/^[A-Z]{3}$/.test(requestedCurrency)) {
    back('Currency must be a 3-letter ISO code, e.g. USD');
  }

  let shopifyDomain: string | null = null;
  let squareLocationId: string | null = null;
  let squareEnv: 'production' | 'sandbox' | null = null;
  // The platform is the authority on which currency the store trades in;
  // a typed value that disagrees would mislabel every amount we store.
  let detectedCurrency = '';

  try {
    if (platform === 'shopify') {
      shopifyDomain = field(form, 'shopifyDomain')
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
      if (!shopifyDomain) back('Shopify domain is required, e.g. my-shop.myshopify.com');
      const shop = await validateShopifyCredentials({ domain: shopifyDomain, accessToken: token });
      detectedCurrency = shop.currency.toUpperCase();
    } else {
      const env = field(form, 'squareEnv') || 'production';
      if (env !== 'production' && env !== 'sandbox') back('Square environment is invalid');
      squareEnv = env;
      // Location may be left blank — validation resolves it when the account
      // has exactly one, and otherwise names the options.
      const resolved = await validateSquareCredentials({
        accessToken: token,
        locationId: field(form, 'squareLocationId') || undefined,
        environment: squareEnv,
      });
      squareLocationId = resolved.locationId;
      detectedCurrency = resolved.currency.toUpperCase();
    }
  } catch (error) {
    back(`Credential check failed — ${(error as Error).message}`);
  }

  if (requestedCurrency && detectedCurrency && requestedCurrency !== detectedCurrency) {
    back(
      `You entered ${requestedCurrency}, but this store reports ${detectedCurrency}. ` +
        'Leave the field blank to use the reported currency.',
    );
  }
  const currency = detectedCurrency || requestedCurrency;
  if (!/^[A-Z]{3}$/.test(currency)) back('Could not determine the store currency');

  try {
    const id = await generateStoreId(name);
    await createStore({
      id,
      name,
      platform,
      currency,
      shopifyDomain,
      squareLocationId,
      squareEnv,
      tokenEncrypted: encryptToken(token),
    });
  } catch (error) {
    back(`Could not save the store — ${(error as Error).message}`);
  }

  revalidatePath('/stores');
  revalidatePath('/');
  back(`Store "${name}" added. The next scheduled sync will backfill 30 days.`, 'ok');
}

/** Rename, and optionally replace the token (re-validated before saving). */
export async function updateStoreAction(form: FormData): Promise<void> {
  const id = field(form, 'id');
  const name = field(form, 'name');
  const token = field(form, 'token');

  const store = await getStore(id);
  if (!store) back('Store not found');
  if (!name) back('Store name is required');

  let tokenEncrypted: string | undefined;
  if (token) {
    try {
      if (store.platform === 'shopify') {
        await validateShopifyCredentials({
          domain: store.shopifyDomain ?? '',
          accessToken: token,
        });
      } else {
        await validateSquareCredentials({
          accessToken: token,
          locationId: store.squareLocationId ?? '',
          environment: store.squareEnv ?? 'production',
        });
      }
    } catch (error) {
      back(`New token rejected — ${(error as Error).message}`);
    }
    tokenEncrypted = encryptToken(token);
  }

  await updateStore(id, { name, ...(tokenEncrypted ? { tokenEncrypted } : {}) });
  revalidatePath('/stores');
  revalidatePath('/');
  back(`Updated "${name}".`, 'ok');
}

export async function toggleStoreActiveAction(form: FormData): Promise<void> {
  const id = field(form, 'id');
  const active = field(form, 'active') === 'true';
  await setStoreActive(id, active);
  revalidatePath('/stores');
  revalidatePath('/');
  back(active ? 'Store reactivated.' : 'Store deactivated — syncing stopped, history kept.', 'ok');
}
