// Applies db/schema.sql to DATABASE_URL. Usage: DATABASE_URL=... npm run db:migrate
// (The app also applies the schema automatically on first use, so this is optional.)
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Locally the app uses PGlite automatically; nothing to migrate.");
  process.exit(1);
}
const sql = neon(url);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`Applied ${statements.length} statements.`);
