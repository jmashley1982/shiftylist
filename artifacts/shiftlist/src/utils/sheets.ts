import { logger } from "../lib/logger.js";

interface TaskEntry {
  text: string;
  completed: boolean;
  completionTime: string | null;
}

interface ShiftSubmission {
  timestamp: string;
  userCode: string;
  employeeName: string;
  shift: string;
  date: string;
  tasks: TaskEntry[];
}

function getAuth() {
  const clientEmail = process.env["GOOGLE_SHEETS_CLIENT_EMAIL"];
  const privateKey = process.env["GOOGLE_SHEETS_PRIVATE_KEY"];
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Sheets credentials not configured. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY."
    );
  }
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
}

export async function appendToSheet(submission: ShiftSubmission): Promise<void> {
  const spreadsheetId = process.env["SPREADSHEET_ID"];
  if (!spreadsheetId) {
    logger.warn("SPREADSHEET_ID not set — skipping Google Sheets submission");
    return;
  }
  try {
    const { google } = await import("googleapis");
    const { clientEmail, privateKey } = getAuth();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const taskSummary = submission.tasks
      .map((t) => `${t.completed ? "✓" : "✗"} ${t.text}${t.completionTime ? ` (${t.completionTime})` : ""}`)
      .join(" | ");
    const values = [[
      submission.timestamp,
      submission.userCode,
      submission.employeeName,
      submission.shift,
      submission.date,
      taskSummary,
    ]];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Submissions!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } catch (err) {
    logger.error({ err }, "Failed to append to Google Sheets");
    throw err;
  }
}

export async function getSubmissionsLast30Days(): Promise<string[][]> {
  const spreadsheetId = process.env["SPREADSHEET_ID"];
  if (!spreadsheetId) {
    logger.warn("SPREADSHEET_ID not set — returning empty submissions");
    return [];
  }
  try {
    const { google } = await import("googleapis");
    const { clientEmail, privateKey } = getAuth();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Submissions!A:F",
    });
    const rows = (response.data.values ?? []) as string[][];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return rows.slice(1).filter((row) => {
      try {
        return new Date(row[0]) >= thirtyDaysAgo;
      } catch {
        return false;
      }
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch from Google Sheets");
    return [];
  }
}
