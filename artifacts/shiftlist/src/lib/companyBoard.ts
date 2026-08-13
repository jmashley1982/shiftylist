import { pool } from "../db/index.js";
import { getTodayStr } from "../utils/dateHelpers.js";

/**
 * The Company Board — one company-wide to-do list, separate from the per-shift
 * checklists. Management owns it; staff read it. Shared by the staff view
 * (src/routes/staff.ts) and the manager editor (src/routes/companyAdmin.ts) so
 * the grouping and sort order are defined exactly once.
 */

export const STATUSES = ["in_progress", "not_started", "done"] as const;
export type GoalStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<GoalStatus, string> = {
  in_progress: "In progress",
  not_started: "Not started",
  done: "Done",
};

/** Sort weight — in-progress work leads, finished work sinks to the bottom. */
const STATUS_RANK: Record<GoalStatus, number> = {
  in_progress: 0,
  not_started: 1,
  done: 2,
};

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * Goals with no category are shown under this heading rather than being
 * hidden, so a manager can add an item without first inventing a category.
 */
export const UNCATEGORIZED_NAME = "General";

/**
 * Like ensureScheduleTables(), these tables are created on first use rather
 * than by a migration: the app deploys with `wrangler deploy`, which runs no
 * migration step against production. lib/db/migrations/004_company_board.sql
 * is the record of the schema, not the thing that applies it.
 *
 * Memoized per-isolate — CREATE TABLE IF NOT EXISTS is cheap, but there's no
 * reason to run it on every request in the same isolate's lifetime.
 */
let ensured = false;

export async function ensureCompanyTables(): Promise<void> {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_categories (
      id            serial PRIMARY KEY,
      name          text NOT NULL UNIQUE,
      display_order integer NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_goals (
      id            serial PRIMARY KEY,
      category_id   integer REFERENCES company_categories(id) ON DELETE SET NULL,
      title         text NOT NULL,
      detail        text NOT NULL DEFAULT '',
      status        text NOT NULL DEFAULT 'not_started',
      owner         text NOT NULL DEFAULT '',
      target_date   text,
      display_order integer NOT NULL DEFAULT 0,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      completed_at  timestamptz
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_goal_updates (
      id         serial PRIMARY KEY,
      goal_id    integer NOT NULL REFERENCES company_goals(id) ON DELETE CASCADE,
      note       text NOT NULL,
      author     text NOT NULL DEFAULT 'Management',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS company_goal_updates_goal_idx
      ON company_goal_updates (goal_id, created_at)
  `);

  ensured = true;
}

export interface GoalUpdate {
  id: number;
  note: string;
  author: string;
  createdAt: Date;
}

export interface Goal {
  id: number;
  categoryId: number | null;
  title: string;
  detail: string;
  status: GoalStatus;
  owner: string;
  targetDate: string | null;
  displayOrder: number;
  completedAt: Date | null;
  /** Target date is in the past and the goal isn't finished. */
  overdue: boolean;
  /** Newest first. */
  updates: GoalUpdate[];
}

export interface CategoryGroup {
  /** null for the synthetic "General" group. */
  id: number | null;
  name: string;
  goals: Goal[];
}

export interface BoardTotals {
  done: number;
  inProgress: number;
  notStarted: number;
  total: number;
  /** Percentage of goals finished, 0–100. */
  donePct: number;
  /** Percentage in flight — stacked after donePct on the progress bar. */
  inProgressPct: number;
}

export interface Board {
  categories: CategoryGroup[];
  totals: BoardTotals;
}

interface CategoryRow {
  id: number;
  name: string;
  display_order: number;
}

interface GoalRow {
  id: number;
  category_id: number | null;
  title: string;
  detail: string;
  status: string;
  owner: string;
  target_date: string | null;
  display_order: number;
  completed_at: Date | string | null;
}

interface UpdateRow {
  id: number;
  goal_id: number;
  note: string;
  author: string;
  created_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export interface LoadBoardOptions {
  /**
   * "status" (the default) leads each category with in-progress work and
   * sinks finished goals — what staff should see.
   *
   * "order" is the manager's own arrangement, ignoring status. The editor
   * uses it because that is what its ▲/▼ buttons manipulate: sorting by
   * status there would make a goal refuse to move past a status boundary.
   */
  sortBy?: "status" | "order";
}

/**
 * Load the whole board in three queries and join in memory — the list is
 * measured in dozens of rows, so a per-goal updates query would be N+1 for no
 * benefit.
 */
export async function loadBoard(options: LoadBoardOptions = {}): Promise<Board> {
  await ensureCompanyTables();

  const [catRes, goalRes, updateRes] = await Promise.all([
    pool.query<CategoryRow>(
      "SELECT id, name, display_order FROM company_categories ORDER BY display_order, name"
    ),
    pool.query<GoalRow>(`
      SELECT id, category_id, title, detail, status, owner, target_date, display_order, completed_at
      FROM company_goals
      ORDER BY display_order, id
    `),
    pool.query<UpdateRow>(`
      SELECT id, goal_id, note, author, created_at
      FROM company_goal_updates
      ORDER BY created_at DESC, id DESC
    `),
  ]);

  const updatesByGoal = new Map<number, GoalUpdate[]>();
  for (const row of updateRes.rows) {
    const list = updatesByGoal.get(row.goal_id);
    const update: GoalUpdate = {
      id: row.id,
      note: row.note,
      author: row.author,
      createdAt: toDate(row.created_at),
    };
    if (list) list.push(update);
    else updatesByGoal.set(row.goal_id, [update]);
  }

  const today = getTodayStr();

  const goals: Goal[] = goalRes.rows.map((row) => {
    const status: GoalStatus = isGoalStatus(row.status) ? row.status : "not_started";
    return {
      id: row.id,
      categoryId: row.category_id,
      title: row.title,
      detail: row.detail,
      status,
      owner: row.owner,
      targetDate: row.target_date,
      displayOrder: row.display_order,
      completedAt: row.completed_at ? toDate(row.completed_at) : null,
      // String comparison is safe and timezone-free for YYYY-MM-DD.
      overdue: status !== "done" && row.target_date !== null && row.target_date < today,
      updates: updatesByGoal.get(row.id) ?? [],
    };
  });

  const groups: CategoryGroup[] = catRes.rows.map((c) => ({
    id: c.id,
    name: c.name,
    goals: [],
  }));
  const groupById = new Map<number, CategoryGroup>(groups.map((g) => [g.id as number, g]));

  const uncategorized: CategoryGroup = { id: null, name: UNCATEGORIZED_NAME, goals: [] };

  for (const goal of goals) {
    const group = goal.categoryId === null ? uncategorized : groupById.get(goal.categoryId);
    // A goal pointing at a category that no longer exists still has to land
    // somewhere — better in General than silently dropped from the board.
    (group ?? uncategorized).goals.push(goal);
  }

  const compare = options.sortBy === "order" ? compareByOrder : compareGoals;
  for (const group of groups) group.goals.sort(compare);
  uncategorized.goals.sort(compare);

  // General sits last, and only when it has something in it.
  const categories = uncategorized.goals.length > 0 ? [...groups, uncategorized] : groups;

  const done = goals.filter((g) => g.status === "done").length;
  const inProgress = goals.filter((g) => g.status === "in_progress").length;
  const total = goals.length;

  return {
    categories,
    totals: {
      done,
      inProgress,
      notStarted: total - done - inProgress,
      total,
      donePct: total ? Math.round((done / total) * 100) : 0,
      inProgressPct: total ? Math.round((inProgress / total) * 100) : 0,
    },
  };
}

function compareGoals(a: Goal, b: Goal): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  return compareByOrder(a, b);
}

function compareByOrder(a: Goal, b: Goal): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.id - b.id;
}

/** True when there is anything worth showing staff after they log in. */
export async function boardHasGoals(): Promise<boolean> {
  await ensureCompanyTables();
  const res = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM company_goals"
  );
  return (res.rows[0]?.count ?? 0) > 0;
}
