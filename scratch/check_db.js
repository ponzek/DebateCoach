import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function check() {
  const sql = neon(process.env.DATABASE_URL);
  
  console.log('--- Analyzing Neon Database ---');
  
  // 1. List Tables
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log('Tables found:', tables.map(t => t.table_name).join(', '));
  
  // 2. Analyze 'sessions' table columns
  if (tables.some(t => t.table_name === 'sessions')) {
    const columns = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sessions'`;
    console.log('\nSessions table columns:');
    columns.forEach(c => console.log(` - ${c.column_name} (${c.data_type})`));
    
    // 3. Row count
    const count = await sql`SELECT COUNT(*) FROM sessions`;
    console.log(`\nTotal rows in 'sessions': ${count[0].count}`);
    
    // 4. Sample a few rows to see if IDs match dashboard
    const samples = await sql`SELECT participant_id, condition, saved_at FROM sessions ORDER BY saved_at DESC LIMIT 5`;
    console.log('\nLatest 5 entries in DB:');
    samples.forEach(s => console.log(` - ${s.participant_id} [${s.condition}] at ${s.saved_at}`));
  } else {
    console.log('\nERROR: sessions table not found!');
  }

  // 5. Check 'participants' and 'participant_counter'
  const pCount = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('participants', 'participant_counter')`;
  for (const table of pCount) {
    const count = await sql`SELECT COUNT(*) FROM ${sql(table.table_name)}`; // use direct string if needed or dynamic
    // Wait, the worker tool might not like dynamic table names easily with the tagged template
    // but neon serverless usually handles it.
    console.log(`Table '${table.table_name}' count: ${count[0].count}`);
  }
}

check().catch(console.error);
