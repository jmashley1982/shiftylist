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
    code TEXT UNIQUE NOT NULL,
    shift_name TEXT NOT NULL
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
`);

export interface Employee {
  id: number;
  name: string;
  code: string;
  shift_name: string;
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
  shift_name?: string;
}

export default db;
