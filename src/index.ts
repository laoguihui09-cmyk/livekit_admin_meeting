import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initDatabase, getPool } from './database';
import { readIntEnv, requireEnv } from './env';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const databaseUrl = requireEnv('DATABASE_URL');
let dbReady = false;

try {
  initDatabase(databaseUrl);
  dbReady = true;
  console.log('PostgreSQL pool created');

  getPool()
    .query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        room_name TEXT NOT NULL,
        sender_identity TEXT NOT NULL,
        sender_name TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_name);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
    `)
    .then(() => console.log('chat_messages table ready'))
    .catch((error: Error) => console.error('Failed to create chat_messages table:', error.message));
} catch (error) {
  console.error('PostgreSQL initialization failed:', (error as Error).message);
}

const JWT_SECRET = process.env.ADMIN_CONSOLE_JWT_SECRET?.trim() || requireEnv('API_SECRET');
const ADMIN_USER = requireEnv('ADMIN_CONSOLE_USERNAME');
const ADMIN_PASS = requireEnv('ADMIN_CONSOLE_PASSWORD');

function generateCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      jwt.verify(auth.slice(7), JWT_SECRET);
      next();
      return;
    } catch {
      // Return unauthorized below.
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/console/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ ok: true, token, username });
    return;
  }

  res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/console/auth/me', requireAdmin, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/console/codes/stats', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM invite_codes');
    const now = Date.now();
    let inUse = 0;
    let expired = 0;

    for (const row of rows) {
      if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
        expired += 1;
      } else if (row.room_name) {
        inUse += 1;
      }
    }

    res.json({
      total: rows.length,
      available: rows.length - inUse - expired,
      assigned: rows.filter((row: any) => row.assigned_to || row.assigned_name).length,
      in_use: inUse,
      expired,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/console/codes', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT 500');
    const now = Date.now();
    const codes = rows.map((row: any) => {
      const isExpired = row.expires_at && new Date(row.expires_at).getTime() <= now;
      const isInUse = !!row.room_name && !isExpired;
      return {
        code: row.code,
        status: isExpired ? 'expired' : isInUse ? 'in_use' : 'available',
        in_use: isInUse,
        expires_at: row.expires_at,
        bound_room: row.room_name,
        created_at: row.created_at,
        activated_at: row.activated_at,
        max_participants: row.max_participants,
        assigned_to: row.assigned_to,
        assigned_name: row.assigned_name || '',
        note: row.note || '',
      };
    });
    res.json({ codes });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/console/codes/create', requireAdmin, async (req: Request, res: Response) => {
  try {
    const count = Math.max(1, Number(req.body.count) || 1);
    const expireMinutes = Math.max(1, Number(req.body.expire_minutes) || 60);
    const ttlSeconds = expireMinutes * 60;
    const maxParticipants = Math.max(1, Number(req.body.max_participants) || 2);
    const assignedTo = req.body.assigned_to ? Number(req.body.assigned_to) : null;
    const assignedName = typeof req.body.assigned_name === 'string' ? req.body.assigned_name.trim() : '';
    const note = typeof req.body.note === 'string' ? req.body.note : '';

    const codes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const code = generateCode();
      await getPool().query(
        `INSERT INTO invite_codes (code, ttl_seconds, max_participants, assigned_to, assigned_name, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [code, ttlSeconds, maxParticipants, assignedTo, assignedName, note],
      );
      codes.push(code);
    }

    res.json({ ok: true, created: codes.length, codes });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/console/codes/:code/release', requireAdmin, async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    await getPool().query('UPDATE invite_codes SET room_name = NULL WHERE code = $1', [code]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/console/codes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const codes = Array.isArray(req.body.codes) ? req.body.codes : [];
    if (codes.length === 0) {
      res.status(400).json({ error: 'Missing codes array' });
      return;
    }

    const normalizedCodes = codes.map((code: string) => code.toUpperCase());
    const { rowCount } = await getPool().query('DELETE FROM invite_codes WHERE code = ANY($1)', [
      normalizedCodes,
    ]);
    res.json({ ok: true, deleted: rowCount || 0, failed: [] });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/console/cleanup', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rowCount } = await getPool().query('DELETE FROM invite_codes WHERE expires_at < NOW()');
    res.json({ ok: true, expired_sessions: rowCount || 0 });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/console/api-urls', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query("SELECT key, value FROM app_config WHERE key IN ('api_url', 'api_url_main')");
    const config: any = { currentUrl: '', mainUrl: '', apiSecret: JWT_SECRET, backups: [] };
    for (const row of rows) {
      if (row.key === 'api_url') config.currentUrl = row.value;
      if (row.key === 'api_url_main') config.mainUrl = row.value;
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/console/api-urls/main', requireAdmin, async (req: Request, res: Response) => {
  try {
    const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
    await getPool().query(
      "INSERT INTO app_config (key, value) VALUES ('api_url', $1), ('api_url_main', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [url],
    );
    res.json({ ok: true, currentUrl: url, mainUrl: url });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/console/settings', requireAdmin, async (_req: Request, res: Response) => {
  res.json({ settings: [], apiUrlBackups: [] });
});

app.get('/health', (_req: Request, res: Response) => res.json({ ok: true, db: dbReady }));
app.get('/health/ping', (_req: Request, res: Response) => res.json({ ok: true, db: dbReady }));

app.post('/api/chat/save', async (req: Request, res: Response) => {
  try {
    const { room_name, sender_identity, sender_name, content } = req.body;
    if (!room_name || !sender_identity || !content) {
      res.status(400).json({ error: 'Missing room_name, sender_identity, or content' });
      return;
    }

    await getPool().query(
      'INSERT INTO chat_messages (room_name, sender_identity, sender_name, content) VALUES ($1, $2, $3, $4)',
      [room_name, sender_identity, sender_name || '', content],
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/chat/save-batch', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as { messages?: any[] };
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Missing messages array' });
      return;
    }

    let saved = 0;
    for (const message of messages) {
      if (!message.room_name || !message.sender_identity || !message.content) continue;
      await getPool().query(
        'INSERT INTO chat_messages (room_name, sender_identity, sender_name, content) VALUES ($1, $2, $3, $4)',
        [message.room_name, message.sender_identity, message.sender_name || '', message.content],
      );
      saved += 1;
    }
    res.json({ ok: true, saved });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/console/chat/messages', requireAdmin, async (req: Request, res: Response) => {
  try {
    const room = typeof req.query.room === 'string' ? req.query.room : '';
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const offset = Number(req.query.offset) || 0;
    const params: any[] = [];
    let query = 'SELECT * FROM chat_messages';

    if (room) {
      params.push(room);
      query += ' WHERE room_name = $1';
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await getPool().query(query, params);
    const countQuery = room
      ? { text: 'SELECT COUNT(*) FROM chat_messages WHERE room_name = $1', values: [room] }
      : { text: 'SELECT COUNT(*) FROM chat_messages', values: [] };
    const { rows: countRows } = await getPool().query(countQuery.text, countQuery.values);

    res.json({ messages: rows.reverse(), total: Number(countRows[0].count) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/console/chat/rooms', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query(
      'SELECT room_name, COUNT(*) as msg_count, MIN(created_at) as first_msg, MAX(created_at) as last_msg FROM chat_messages GROUP BY room_name ORDER BY MAX(created_at) DESC',
    );
    res.json({ rooms: rows });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/config', async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query("SELECT value FROM app_config WHERE key = 'api_url'");
    res.json({ api_url: rows[0]?.value || '', backup_urls: [] });
  } catch {
    res.json({ api_url: '', backup_urls: [] });
  }
});

const publicDir = path.resolve(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/console/') || req.path.startsWith('/health')) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/console/')) {
    res.status(404).json({ error: 'API route not found' });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const port = readIntEnv('PORT', 3000);
app.listen(port, () => console.log(`Admin server started: http://localhost:${port}`));
process.on('SIGTERM', () => process.exit(0));
