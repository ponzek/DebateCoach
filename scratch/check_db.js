import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function check() {
  try {
    const rows = await sql`SELECT participant_id, topic, condition, saved_at FROM sessions ORDER BY saved_at DESC LIMIT 10`;
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error(e);
  }
}

check();
