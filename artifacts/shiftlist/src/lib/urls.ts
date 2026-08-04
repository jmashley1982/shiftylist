/**
 * Centralizes the two path prefixes this Worker answers on —
 * vikingvaporandsmoke.com/staff* and vikingvaporandsmoke.com/admin/shifts* —
 * so every redirect, link, form action and fetch() call is built from one
 * place instead of a literal that's easy to miss when a prefix changes.
 *
 * A missed prefix doesn't 404: the Viking storefront Worker owns every other
 * path on this zone and runs with `not_found_handling:
 * "single-page-application"`, so an unmatched request silently renders the
 * marketing homepage with HTTP 200 instead of failing loudly.
 */
export const STAFF_BASE = "/staff";
export const ADMIN_BASE = "/admin/shifts";

/** The Viking ordering app's login — reached when there is no valid session. */
export const VIKING_LOGIN = "/admin";

function join(base: string, path: string): string {
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function staffUrl(path = ""): string {
  return join(STAFF_BASE, path);
}

export function adminUrl(path = ""): string {
  return join(ADMIN_BASE, path);
}
