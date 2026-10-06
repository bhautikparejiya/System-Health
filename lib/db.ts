import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { env } from "./env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Runner = (text: string, params: unknown[]) => Promise<Row[]>;

const g = globalThis as unknown as { __dbRunner?: Promise<Runner> };

function loadSchema(): string {
  return readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

async function createRunner(): Promise<Runner> {
  if (env.databaseUrl) {
    const sql = neon(env.databaseUrl);
    // Apply the (idempotent) schema once per cold start, in a single round trip.
    await sql.transaction(splitStatements(loadSchema()).map((s) => sql.query(s)));
    return (text, params) => sql.query(text, params) as Promise<Row[]>;
  }
  // Local development: embedded Postgres (WASM) persisted to ./.data/pglite
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.exec(loadSchema());
  return async (text, params) => (await db.query<Row>(text, params)).rows;
}

/** Run a parameterised query and return its rows. */
export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!g.__dbRunner) {
    g.__dbRunner = createRunner().catch((e) => {
      g.__dbRunner = undefined;
      throw e;
    });
  }
  const run = await g.__dbRunner;
  return (await run(text, params)) as T[];
}

export async function q1<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

/** Increment a daily counter (UTC day). */
export async function bump(locationId: string, metric: string, by = 1, at = new Date()): Promise<void> {
  await q(
    `insert into daily_counters (location_id, day, metric, count) values ($1, $2::date, $3, $4)
     on conflict (location_id, day, metric) do update set count = daily_counters.count + excluded.count`,
    [locationId, at.toISOString().slice(0, 10), metric, by],
  );
}

/** Sum of a counter per day for the last `days` UTC days (including today). Returns oldest → newest. */
export async function counterSeries(locationId: string, metric: string, days: number, now = new Date()): Promise<number[]> {
  const start = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await q<{ day: string | Date; count: number }>(
    `select day, count from daily_counters where location_id = $1 and metric = $2 and day >= $3::date`,
    [locationId, metric, start],
  );
  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)]));
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(byDay.get(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)) ?? 0);
  }
  return out;
}
