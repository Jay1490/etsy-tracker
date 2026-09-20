import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
let ready = false;

async function init() {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS entries (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    from_account INT,
    to_account INT,
    amount NUMERIC(12,2) NOT NULL,
    date DATE NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM accounts`;
  if (n === 0) {
    await sql`INSERT INTO accounts (name) VALUES ('Bank 1'), ('Bank 2'), ('Bank 3')`;
  }
  ready = true;
}

export default async function handler(req, res) {
  if (!process.env.APP_PASSWORD || !process.env.DATABASE_URL) {
    return res.status(500).json({ error: 'APP_PASSWORD or DATABASE_URL is not set in Vercel.' });
  }
  if (req.headers['x-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  try {
    await init();

    if (req.method === 'GET') {
      const accounts = await sql`SELECT id, name FROM accounts ORDER BY id`;
      const entries = await sql`
        SELECT id, type, from_account, to_account, amount::float AS amount,
               to_char(date, 'YYYY-MM-DD') AS date, note
        FROM entries ORDER BY date DESC, id DESC`;
      return res.status(200).json({ accounts, entries });
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.action === 'rename') {
        const name = String(b.name || '').trim().slice(0, 40);
        if (!name) return res.status(400).json({ error: 'Name is empty' });
        await sql`UPDATE accounts SET name = ${name} WHERE id = ${Number(b.id)}`;
        return res.status(200).json({ ok: true });
      }

      const type = b.type;
      const amount = Number(b.amount);
      const date = String(b.date || '');
      const note = String(b.note || '').trim().slice(0, 200) || null;
      const from = b.from_account ? Number(b.from_account) : null;
      const to = b.to_account ? Number(b.to_account) : null;

      if (!['income', 'transfer', 'production'].includes(type)) return res.status(400).json({ error: 'Bad type' });
      if (!(amount > 0)) return res.status(400).json({ error: 'Amount must be more than 0' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date' });
      if (type === 'income' && !to) return res.status(400).json({ error: 'Choose the account' });
      if (type === 'production' && !from) return res.status(400).json({ error: 'Choose the account' });
      if (type === 'transfer' && (!from || !to || from === to)) return res.status(400).json({ error: 'Choose two different accounts' });

      if (b.action === 'update') {
        const id = Number(b.id);
        if (!id) return res.status(400).json({ error: 'Bad id' });
        await sql`UPDATE entries SET type = ${type},
                    from_account = ${type === 'income' ? null : from},
                    to_account = ${type === 'production' ? null : to},
                    amount = ${amount}, date = ${date}, note = ${note}
                  WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      await sql`INSERT INTO entries (type, from_account, to_account, amount, date, note)
                VALUES (${type}, ${type === 'income' ? null : from}, ${type === 'production' ? null : to}, ${amount}, ${date}, ${note})`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'Bad id' });
      await sql`DELETE FROM entries WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}