import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "../../shiftdb.sqlite");

const db = new Database(dbPath);

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shift_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_name TEXT NOT NULL,
    task_text TEXT NOT NULL,
    display_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    target_date TEXT NOT NULL,
    task_text TEXT NOT NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shift_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    shift_name TEXT NOT NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employee_id, date)
  );
`);

// Migration: if employees table still has shift_name column, recreate without it
const empCols = db.prepare("PRAGMA table_info(employees)").all() as Array<{ name: string }>;
if (empCols.some(c => c.name === "shift_name")) {
  db.exec(`
    BEGIN;
    CREATE TABLE employees_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL
    );
    INSERT INTO employees_migrated (id, name, code)
      SELECT id, name, code FROM employees;
    DROP TABLE employees;
    ALTER TABLE employees_migrated RENAME TO employees;
    COMMIT;
  `);
}

export interface Employee {
  id: number;
  name: string;
  code: string;
}

export interface ShiftTemplate {
  id: number;
  shift_name: string;
  task_text: string;
  display_order: number;
}

export interface ScheduledTask {
  id: number;
  employee_id: number;
  target_date: string;
  task_text: string;
  employee_name?: string;
}

export interface ShiftAssignment {
  id: number;
  employee_id: number;
  date: string;
  shift_name: string;
  employee_name?: string;
}

export default db;
