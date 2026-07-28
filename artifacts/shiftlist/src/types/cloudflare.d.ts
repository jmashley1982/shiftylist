/**
 * Minimal ambient declarations for the Workers-only virtual modules, so
 * `tsc --noEmit` passes without requiring wrangler's generated types.
 */

declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: unknown, env?: unknown, ctx?: unknown): Promise<Response>;
  };
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
