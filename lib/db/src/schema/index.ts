import { pgTable, serial, text, integer, boolean, unique, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });

// Reusable master task list
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });

// Shift types (Open, Mid, Close, …)
export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });

// Tasks assigned to each shift template (reusable, ordered)
export const shiftTasks = pgTable("shift_tasks", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").default(0).notNull(),
  timeStart: text("time_start"),
  timeEnd: text("time_end"),
}, (table) => [
  unique().on(table.shiftId, table.taskId),
]);

export const insertShiftTaskSchema = createInsertSchema(shiftTasks).omit({ id: true });

// Extra tasks added for a specific date + shift (additive only, do not replace the standing list)
export const extraDayTasks = pgTable("extra_day_tasks", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  taskName: text("task_name").notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  timeStart: text("time_start"),
  timeEnd: text("time_end"),
});

export const insertExtraDayTaskSchema = createInsertSchema(extraDayTasks).omit({ id: true });

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type Shift = typeof shifts.$inferSelect;
export type InsertShift = typeof shifts.$inferInsert;

export type ShiftTask = typeof shiftTasks.$inferSelect;
export type InsertShiftTask = typeof shiftTasks.$inferInsert;

export type ExtraDayTask = typeof extraDayTasks.$inferSelect;
export type InsertExtraDayTask = typeof extraDayTasks.$inferInsert;

// Shift submission reports (replaces Google Sheets; deleted after 30 days)
export const submissions = pgTable("submissions", {
  id: serial("id").primaryKey(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  shiftName: text("shift_name").notNull(),
  date: text("date").notNull(),
  taskSummary: text("task_summary").notNull(),
  notes: text("notes").notNull().default(""),
  autoSubmitted: boolean("auto_submitted").notNull().default(false),
});

export type Submission = typeof submissions.$inferSelect;
export type InsertSubmission = typeof submissions.$inferInsert;

// Per-day shared task completion state (keyed on date + shift + task name; presence = done)
export const taskCompletions = pgTable("task_completions", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  taskName: text("task_name").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  completedByName: text("completed_by_name").notNull(),
  completedByCode: text("completed_by_code").notNull(),
  lateReason: text("late_reason"),
}, (table) => [
  unique().on(table.date, table.shiftId, table.taskName),
]);

export type TaskCompletion = typeof taskCompletions.$inferSelect;
export type InsertTaskCompletion = typeof taskCompletions.$inferInsert;

// Active staff sessions: set when a shift is selected, cleared on submission
export const activeSessions = pgTable("active_sessions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  shiftName: text("shift_name").notNull(),
  date: text("date").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.employeeId, table.date),
]);

export type ActiveSession = typeof activeSessions.$inferSelect;

// Login sessions (express-session store). Workers isolates are short-lived, so
// sessions cannot live in process memory — see artifacts/shiftlist/src/lib/sessionStore.ts
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true, precision: 6 }).notNull(),
}, (table) => [
  index("idx_sessions_expire").on(table.expire),
]);

export type SessionRow = typeof sessions.$inferSelect;

// Schedule imported from a Homebase CSV export — who is supposed to work
// which shift, as opposed to task_completions/submissions which track what
// actually happened. See artifacts/shiftlist/src/lib/scheduleTables.ts.
export const scheduledShifts = pgTable("scheduled_shifts", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  employeeId: integer("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  startTime: text("start_time").notNull(),
  endTime: text("end_time"),
  source: text("source").notNull().default("homebase_csv"),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.date, table.employeeId, table.startTime),
]);

export type ScheduledShift = typeof scheduledShifts.$inferSelect;
export type InsertScheduledShift = typeof scheduledShifts.$inferInsert;

// ── Company Board ───────────────────────────────────────────────────────────
// A single company-wide to-do list, separate from the per-shift checklists
// above: months-long business goals owned by management, read-only to staff.
// Created lazily at request time too — see
// artifacts/shiftlist/src/lib/companyBoard.ts.

// Themes a goal is filed under (Store, Online, Hiring, …). Manager-ordered.
export const companyCategories = pgTable("company_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayOrder: integer("display_order").default(0).notNull(),
});

export type CompanyCategory = typeof companyCategories.$inferSelect;
export type InsertCompanyCategory = typeof companyCategories.$inferInsert;

// One item on the company-wide list. `categoryId` is nullable so a goal can
// be added before anyone has bothered to create a category — those render
// under a synthetic "General" heading.
export const companyGoals = pgTable("company_goals", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => companyCategories.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  status: text("status").notNull().default("not_started"), // not_started | in_progress | done
  owner: text("owner").notNull().default(""),
  targetDate: text("target_date"), // 'YYYY-MM-DD', optional
  displayOrder: integer("display_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type CompanyGoal = typeof companyGoals.$inferSelect;
export type InsertCompanyGoal = typeof companyGoals.$inferInsert;

// Dated progress notes appended to a goal — the "here's what's happening
// behind the scenes" history staff read.
export const companyGoalUpdates = pgTable("company_goal_updates", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => companyGoals.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  author: text("author").notNull().default("Management"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("company_goal_updates_goal_idx").on(table.goalId, table.createdAt),
]);

export type CompanyGoalUpdate = typeof companyGoalUpdates.$inferSelect;
export type InsertCompanyGoalUpdate = typeof companyGoalUpdates.$inferInsert;

// Maps a shift's start time range to one of this store's shift types, used
// to classify imported Homebase rows into Open/Mid/Close (etc).
export const shiftTimeRules = pgTable("shift_time_rules", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().unique().references(() => shifts.id, { onDelete: "cascade" }),
  startFrom: text("start_from").notNull(),
  startUntil: text("start_until").notNull(),
});

export type ShiftTimeRule = typeof shiftTimeRules.$inferSelect;
export type InsertShiftTimeRule = typeof shiftTimeRules.$inferInsert;
