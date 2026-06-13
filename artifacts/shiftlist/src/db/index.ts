import { db } from "@workspace/db";

export const pool = db.$client;
