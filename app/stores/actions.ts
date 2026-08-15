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
  const currency = field(form, 'currency').toUpperCase();
  const token = field(form, 'token');

  if (!name) back('Store name is required');
  if (!token) back('API token is required');
  if (platform !== 'shopify' && platform !== 'square') back('Pick a platform');
  if (!/^[A-Z]{3}$/.test(currency)) back('Currency must be a 3-letter ISO code, e.g. INR');

  let shopifyDomain: string | null = null;
  let squareLocationId: string | null = null;
  let squareEnv: 'production' | 'sandbox' | null = null;

  try {
    if (platform === 'shopify') {
      shopifyDomain = field(form, 'shopifyDomain')
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
      if (!shopifyDomain) back('Shopify domain is required, e.g. my-shop.myshopify.com');
      await validateShopifyCredentials({ domain: shopifyDomain, accessToken: token });
    } else {
      squareLocationId = field(form, 'squareLocationId');
      const env = field(form, 'squareEnv') || 'production';
      if (!squareLocationId) back('Square location ID is required');
      if (env !== 'production' && env !== 'sandbox') back('Square environment is invalid');
      squareEnv = env;
      await validateSquareCredentials({
        accessToken: token,
        locationId: squareLocationId,
        environment: squareEnv,
      });
    }
  } catch (error) {
    back(`Credential check failed — ${(error as Error).message}`);
  }

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
