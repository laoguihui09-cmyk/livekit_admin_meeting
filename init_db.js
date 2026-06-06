const { Pool } = require('pg');
const fs = require('fs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync('./database_init.sql', 'utf8');

pool.query(sql)
  .then(r => { console.log('OK'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
