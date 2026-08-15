import { AppShell } from '@/app/components/AppShell';
import { EmptyState } from '@/app/components/EmptyState';
import { StoreDot } from '@/app/components/StoreDot';
import { decryptToken, maskToken } from '@/lib/crypto';
import { listStores, listSyncState } from '@/lib/repo';
import { buildStoreColorMap, relativeTime } from '@/lib/ui';

import { addStoreAction, toggleStoreActiveAction, updateStoreAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Stores · Daily Sales Verification' };

interface PageProps {
  searchParams: Promise<{ error?: string; ok?: string }>;
}

/** Never expose the token itself — decrypt server-side purely to show last 4. */
function maskStoredToken(ciphertext: string): string {
  try {
    return maskToken(decryptToken(ciphertext));
  } catch {
    return 'unreadable';
  }
}

export default async function StoresPage({ searchParams }: PageProps) {
  const { error, ok } = await searchParams;

  let stores: Awaited<ReturnType<typeof listStores>> = [];
  let syncStates: Awaited<ReturnType<typeof listSyncState>> = [];
  let loadError: string | null = null;

  try {
    [stores, syncStates] = await Promise.all([listStores(), listSyncState()]);
  } catch (e) {
    loadError = (e as Error).message;
  }

  const colors = buildStoreColorMap(stores.map((s) => s.id));
  const syncById = new Map(syncStates.map((s) => [s.storeId, s]));

  return (
    <AppShell active="stores">
      <h1 className="text-lg font-semibold tracking-tight">Stores</h1>
      <p className="muted mt-0.5 text-xs">
        Added at runtime and stored in the database — nothing is hardcoded, and no redeploy is
        needed. Tokens are encrypted at rest and only ever decrypted server-side.
      </p>

      {error ? (
        <div
          className="card mt-4 px-4 py-3 text-sm"
          style={{ borderColor: 'var(--critical)', color: 'var(--critical)' }}
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {ok ? (
        <div
          className="card mt-4 px-4 py-3 text-sm"
          style={{ borderColor: 'var(--good)', color: 'var(--good-text)' }}
          role="status"
        >
          {ok}
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-4">
          <EmptyState
            tone="critical"
            title="Could not read the database"
            body={
              <>
                <p>{loadError}</p>
                <p className="mt-2">
                  Check <code>DATABASE_URL</code> on the deployment and that migrations have run.
                </p>
              </>
            }
          />
        </div>
      ) : (
        <>
          {/* Existing stores ------------------------------------------- */}
          <section className="mt-5">
            {stores.length === 0 ? (
              <EmptyState
                title="No stores yet"
                body="Add your first Shopify or Square store below. Credentials are verified against the live API before anything is saved."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {stores.map((store) => {
                  const sync = syncById.get(store.id);
                  const failed = sync?.lastStatus === 'error';
                  return (
                    <div key={store.id} className="card px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StoreDot color={colors.get(store.id) ?? 'var(--ink-muted)'} />
                        <span className="text-sm font-medium">{store.name}</span>
                        <span className="chip">{store.platform}</span>
                        <span className="chip">{store.currency}</span>
                        {!store.active ? (
                          <span className="chip" style={{ color: 'var(--serious)' }}>
                            inactive
                          </span>
                        ) : null}
                      </div>

                      <dl className="muted mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt>Endpoint</dt>
                        <dd className="num truncate" style={{ color: 'var(--ink-secondary)' }}>
                          {store.platform === 'shopify'
                            ? store.shopifyDomain
                            : `${store.squareLocationId} (${store.squareEnv})`}
                        </dd>
                        <dt>Token</dt>
                        <dd className="num" style={{ color: 'var(--ink-secondary)' }}>
                          {maskStoredToken(store.tokenEncrypted)}
                        </dd>
                        <dt>Last sync</dt>
                        <dd style={{ color: failed ? 'var(--critical)' : 'var(--ink-secondary)' }}>
                          {relativeTime(sync?.lastSyncedAt ?? null)}
                          {failed ? ` — ${sync?.lastError ?? 'error'}` : ''}
                        </dd>
                      </dl>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <form action={toggleStoreActiveAction}>
                          <input type="hidden" name="id" value={store.id} />
                          <input type="hidden" name="active" value={store.active ? 'false' : 'true'} />
                          <button type="submit" className={`btn ${store.active ? 'btn-danger' : ''}`}>
                            {store.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </form>

                        <details className="w-full">
                          <summary className="btn cursor-pointer" style={{ width: 'fit-content' }}>
                            Edit
                          </summary>
                          <form action={updateStoreAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                            <input type="hidden" name="id" value={store.id} />
                            <div>
                              <label className="label" htmlFor={`name-${store.id}`}>
                                Name
                              </label>
                              <input
                                id={`name-${store.id}`}
                                name="name"
                                defaultValue={store.name}
                                className="input"
                                required
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor={`token-${store.id}`}>
                                Replace token (leave blank to keep)
                              </label>
                              <input
                                id={`token-${store.id}`}
                                name="token"
                                type="password"
                                autoComplete="off"
                                placeholder="•••••"
                                className="input"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <button type="submit" className="btn btn-primary">
                                Save changes
                              </button>
                            </div>
                          </form>
                        </details>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add store -------------------------------------------------- */}
          <section className="mt-6">
            <h2 className="stat-label mb-2">Add a store</h2>
            <form action={addStoreAction} className="card platform-form px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="name">
                    Store name
                  </label>
                  <input id="name" name="name" className="input" required placeholder="Main Store" />
                </div>
                <div>
                  <label className="label" htmlFor="currency">
                    Currency (ISO)
                  </label>
                  <input
                    id="currency"
                    name="currency"
                    className="input"
                    required
                    maxLength={3}
                    placeholder="INR"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
                <div>
                  <span className="label">Platform</span>
                  <div className="flex gap-2">
                    <label className="chip cursor-pointer">
                      <input
                        type="radio"
                        name="platform"
                        value="shopify"
                        id="platform-shopify"
                        defaultChecked
                      />
                      Shopify
                    </label>
                    <label className="chip cursor-pointer">
                      <input type="radio" name="platform" value="square" id="platform-square" />
                      Square
                    </label>
                  </div>
                </div>
              </div>

              <div className="shopify-only mt-3">
                <label className="label" htmlFor="shopifyDomain">
                  Shopify domain
                </label>
                <input
                  id="shopifyDomain"
                  name="shopifyDomain"
                  className="input"
                  placeholder="my-shop.myshopify.com"
                />
              </div>

              <div className="square-only mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="squareLocationId">
                    Square location ID
                  </label>
                  <input id="squareLocationId" name="squareLocationId" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="squareEnv">
                    Environment
                  </label>
                  <select id="squareEnv" name="squareEnv" className="input" defaultValue="production">
                    <option value="production">production</option>
                    <option value="sandbox">sandbox</option>
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="label" htmlFor="token">
                  API access token
                </label>
                <input
                  id="token"
                  name="token"
                  type="password"
                  autoComplete="off"
                  className="input"
                  required
                />
                <p className="muted mt-1 text-xs">
                  Verified against the live API before saving, then encrypted with AES-256-GCM.
                  Shopify needs <code>read_orders</code>; Square needs{' '}
                  <code>ORDERS_READ</code> and <code>PAYMENTS_READ</code>.
                </p>
              </div>

              <div className="mt-4">
                <button type="submit" className="btn btn-primary">
                  Verify &amp; add store
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </AppShell>
  );
}
