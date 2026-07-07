import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

let pool: Pool;

function normalizeDatabaseUrl(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL');
  }

  if (url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'no-verify');
  }
  return url.toString();
}

export function initDatabase(connectionString: string): Pool {
  pool = new Pool({
    connectionString: normalizeDatabaseUrl(connectionString),
    max: 20,
  });

  pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error.message);
  });

  console.log('PostgreSQL pool created');
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database has not been initialized');
  }
  return pool;
}

export async function runDatabaseInit(): Promise<void> {
  const sqlPath = path.join(__dirname, '../database_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await getPool().query(sql);
  console.log('Database schema initialized');
}
