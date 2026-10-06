import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const globalDb = globalThis as unknown as { pool?: Pool };
export const pool =
  globalDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
if (process.env.NODE_ENV !== "production") globalDb.pool = pool;
export const db = drizzle(pool);
