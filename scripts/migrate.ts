/**
 * Apply pending Drizzle migrations.
 *
 *   DATABASE_URL=... npm run db:migrate
 *
 * Safe to re-run: drizzle records applied migrations in `__drizzle_migrations`.
 */
import 'dotenv/config';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
  process.exit(1);
}

const db = drizzle(neon(connectionString));

await migrate(db, { migrationsFolder: './db/migrations' });
console.log('Migrations applied.');
