import type { Request } from "express";

/**
 * Verifies the Viking ordering app's session cookie, so a manager who is
 * already logged in at vikingvaporandsmoke.com/admin never sees a second
 * login for the Shifts section.
 *
 * This is a direct port of hasValidSession/timingSafeEqual from
 * jmashley1982/viking-product-ordering's src/worker/auth.ts — same cookie
 * name, same HMAC construction, same TTL — kept intentionally identical so a
 * change on one side doesn't silently stop verifying the other's cookies.
 * ShiftList only ever reads this cookie; it never issues or clears it.
 *
 * Requires SESSION_SECRET here to be the exact same value the ordering app
 * uses to sign its cookie. If it differs, every manager is bounced back to
 * /admin — that's the one thing to double-check after deploying this.
 */

const COOKIE_NAME = "viking_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const encoder = new TextEncoder();

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison so a mismatch can't be timed character by character. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function hasValidVikingSession(req: Request): Promise<boolean> {
  const secret = process.env["SESSION_SECRET"];
  // Fail closed: an unset or too-short secret must never be treated as "let
  // everyone in" — same rule the ordering app applies to its own copy.
  if (!secret || secret.length < 16) return false;

  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return false;

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return false;

  const issuedAt = raw.slice(0, separator);
  const sig = raw.slice(separator + 1);

  const expected = await hmac(secret, issuedAt);
  if (!timingSafeEqual(sig, expected)) return false;

  const ts = Number.parseInt(issuedAt, 10);
  if (Number.isNaN(ts)) return false;
  if (Date.now() - ts > SESSION_TTL_MS) return false;

  return true;
}
