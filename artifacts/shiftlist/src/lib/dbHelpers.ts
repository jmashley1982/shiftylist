import type { PoolClient } from "pg";
import { pool } from "../db/index.js";

/**
 * Small query helpers shared by the admin routers. They started out private to
 * src/routes/admin.ts; they live here now so src/routes/companyAdmin.ts can
 * use them without importing that module (which installs its own router-wide
 * auth middleware as a side effect of being loaded).
 */

/** Run fn inside a BEGIN/COMMIT transaction; rolls back on error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Tables with a `display_order` column that the admin UI lets you reorder. */
export type OrderableTable = "shift_tasks" | "extra_day_tasks" | "company_goals";

/**
 * Renormalize a list of rows to display_order 0, 1, 2, … in a single
 * UPDATE … FROM (VALUES …) statement.
 */
export async function bulkRenormalizeOrder(
  client: PoolClient,
  table: OrderableTable,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const valuePlaceholders = ids.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(", ");
  const params: number[] = ids.flatMap((id, i) => [id, i]);
  await client.query(
    `UPDATE ${table} AS t
     SET display_order = vals.new_order
     FROM (VALUES ${valuePlaceholders}) AS vals(row_id, new_order)
     WHERE t.id = vals.row_id`,
    params
  );
}
