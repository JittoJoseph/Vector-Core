import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const sql = postgres(process.env.SUPABASE_DATABASE_URL!, { max: 1 });
  await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_quality jsonb`;
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'trades' AND column_name = 'entry_quality'`;
  console.log("entry_quality column present:", n === 1);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
