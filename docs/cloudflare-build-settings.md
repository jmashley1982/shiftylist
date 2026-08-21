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

"No matches found" in the repository dropdown is not necessarily about
Cloudflare at all. It happened once, on 2026-08-18, and the cause was three
steps upstream: GitHub had placed a restriction on the account, which hides
it from public view. A hidden account shows no repositories to any connected
app, so Cloudflare's dropdown came back empty and every reconnect link 404'd
— the dashboard was sending the browser to an account GitHub would not admit
existed.

The tell, and the fastest way to check it again: open
<https://api.github.com/users/jmashley1982> in a browser. A working account
returns JSON. A restricted one returns "Not Found" while still working
normally for the signed-in owner. If that 404s, no amount of clicking in
either dashboard will help — it is a GitHub support ticket, and everything
reconnects on its own once the restriction lifts. Which is exactly what
happened: GitHub cleared it on 2026-08-21 and every Worker's Git connection
came back without anyone touching a setting.

If the account is visible and the list is still empty, then it really is the
app: <https://github.com/settings/installations> → **Cloudflare Workers and
Pages** → Configure → give it access to `shiftylist` (or all repositories).

## Deploying without any of this

The connection above only automates deploys. A deploy can always be run by
hand from a checkout of `main` with a Cloudflare API token in the
environment:

```
CLOUDFLARE_API_TOKEN=… pnpm --filter @workspace/shiftlist run cf:deploy
```

The token needs the **Edit Cloudflare Workers** template. That is how the app
was shipped on 2026-08-18 while the GitHub link was broken.
