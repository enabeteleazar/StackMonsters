import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    await pool.query(
      'INSERT INTO maintenance_subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email]
    );

    return res.status(200).json({ success: true, message: 'Email registered successfully' });
  } catch (error) {
    console.error('Neon Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
