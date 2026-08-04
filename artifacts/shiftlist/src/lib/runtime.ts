/** True when running on the Cloudflare Workers runtime rather than Node. */
export function isWorkers(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}
