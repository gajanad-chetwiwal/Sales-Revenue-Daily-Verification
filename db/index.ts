import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

function createDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}

let cached: Database | undefined;

/**
 * Lazily-created Drizzle client.
 *
 * Lazy on purpose: `next build` must succeed without DATABASE_URL set, and
 * pages that never touch the database should never require it.
 */
export function getDb(): Database {
  if (!cached) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    cached = createDb(connectionString);
  }
  return cached;
}

export { schema };
export * from './schema';
