# Cloudflare build settings

What to type into **Workers & Pages → shiftylist → Settings → Build** when the
GitHub connection has to be rebuilt. Written down because it has been lost
once already: Jason's GitHub account name changed, Cloudflare's link went
stale, and pushes to `main` silently stopped deploying for a day.

| Field | Value |
|---|---|
| Git account | `jmashley1982` |
| Repository | `jmashley1982/shiftylist` |
| Production branch | `main` |
| Builds for non-production branches | on |
| Build command | `pnpm install --frozen-lockfile && pnpm run gen:views` |
| Deploy command | `npx wrangler deploy` |
| Version command | `npx wrangler versions upload` |
| Root directory (under **Advanced settings**) | `/artifacts/shiftlist` |

Root directory is the one that hides — it sits behind **Advanced settings** in
the connect dialog, and the build fails confusingly without it, because the
Worker is a package inside a pnpm workspace rather than the repo root.

## When the repository list comes up empty

"No matches found" in the repository dropdown is never about Cloudflare. It
means GitHub is not showing Cloudflare any repositories:
<https://github.com/settings/installations> → **Cloudflare Workers and Pages**
→ Configure → give it access to `shiftylist` (or all repositories). If it is
not listed there at all, the app was removed and has to be installed again
from the Git account dropdown in Cloudflare's connect dialog.

## Deploying without any of this

The connection above only automates deploys. A deploy can always be run by
hand from a checkout of `main` with a Cloudflare API token in the
environment:

```
CLOUDFLARE_API_TOKEN=… pnpm --filter @workspace/shiftlist run cf:deploy
```

The token needs the **Edit Cloudflare Workers** template. That is how the app
was shipped on 2026-08-18 while the GitHub link was broken.
