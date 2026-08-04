import ejs from "ejs";
import { VIEWS } from "../generated/views.js";

/**
 * Renders EJS from templates baked into the bundle rather than read from disk.
 *
 * Express normally resolves a view by stat-ing the filesystem, which does not
 * exist on Cloudflare Workers. `BundledView` replaces that lookup — it is
 * installed with `app.set("view", BundledView)` — and `include()` calls are
 * served from the same in-memory map via ejs's `includer` hook.
 *
 * scripts/gen-views.mjs rewrites every include to a root-absolute path, which
 * makes ejs resolve it by path arithmetic against `root: "/"` instead of
 * probing node:fs.
 */

type Renderable = (data: ejs.Data) => string;

const compiled = new Map<string, Renderable>();

/** "/admin/reports.ejs" or "admin/reports" → the VIEWS key "admin/reports.ejs" */
function toKey(viewPath: string): string {
  const normalised = viewPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalised.endsWith(".ejs") ? normalised : `${normalised}.ejs`;
}

const includer: ejs.Options["includer"] = (originalPath, parsedPath) => {
  const key = toKey(parsedPath ?? originalPath);
  const template = VIEWS[key];

  if (template === undefined) {
    throw new Error(
      `Included template "${key}" (from "${originalPath}") is not in the bundle. ` +
        "Re-run `pnpm --filter @workspace/shiftlist run gen:views`.",
    );
  }

  // Only `template` is returned: ejs has already resolved `parsedPath` to the
  // absolute virtual path and uses it as the included template's filename.
  return { template };
};

function compile(key: string): Renderable {
  const cached = compiled.get(key);
  if (cached) return cached;

  const source = VIEWS[key];
  if (source === undefined) {
    throw new Error(`Template "${key}" is not in the bundle.`);
  }

  const fn = ejs.compile(source, {
    filename: `/${key}`, // virtual — used for error messages and include resolution
    root: "/",
    views: [],
    includer,
    // `include()` resolves through ejs's own cache at render time. Seeding it
    // below is what stops a partial being compiled mid-request, which Workers
    // reject — see warmViews().
    cache: true,
    async: false,
  }) as Renderable;

  compiled.set(key, fn);
  ejs.cache.set(`/${key}`, fn);
  return fn;
}

/**
 * Compiles every template up front. This is not an optimisation — it is
 * required on Workers.
 *
 * EJS builds a render function with `new Function(...)`, and Workers only
 * permit code generation from strings during startup (global scope). A
 * template compiled lazily inside a request fails with
 * "EvalError: Code generation from strings disallowed for this context".
 *
 * This covers partials as well: `include()` compiles its target the first time
 * the *parent* runs, so every template — partials included — is compiled here
 * and registered in ejs's cache under the same virtual path `include()`
 * resolves to.
 *
 * Call this at module scope in the Workers entry point.
 */
export function warmViews(): void {
  for (const key of Object.keys(VIEWS)) {
    compile(key);
  }
}

/** Custom Express `view` implementation — see `app.set("view", ...)`. */
export class BundledView {
  public name: string;
  public path: string;

  private key: string;

  constructor(name: string) {
    this.name = name;
    this.key = toKey(name);

    // Express treats a falsy `path` as "view not found" and raises its own
    // "Failed to lookup view" error, which is the behaviour callers expect.
    this.path = VIEWS[this.key] === undefined ? "" : `/${this.key}`;
  }

  render(options: ejs.Data, callback: (err: Error | null, html?: string) => void): void {
    try {
      callback(null, compile(this.key)(options));
    } catch (err) {
      callback(err as Error);
    }
  }
}
