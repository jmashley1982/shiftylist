# How to work in this repo

Owner: Jason. Not a coder. Does not use a terminal. Gives ideas.

## The loop
1. Jason gives an idea.
2. You give a short plan in plain English. No jargon.
3. He says yes or no.
4. If yes: build it, push to main, give him the live link.

You handle every technical action yourself — files, commits, pushes,
deploys. Never tell him to run a command or open a terminal. If you
can't do something, say so in your FIRST message and name the fix.

## Branches
Work on main. Commit to main. Push to main. Nothing else.
Do NOT create a branch. Do NOT open a pull request. Work on any other
branch is invisible to Jason and might as well not exist.

Exception: if Jason says "preview it first," build on a branch, give
him the Cloudflare preview link, wait. On "ship it," merge to main
yourself and confirm it's live.

## File structure — identical in every one of Jason's repos
```
/                  CLAUDE.md, README.md, index.html
/docs              plans, specs, briefs, design bibles
/assets/images     photos, logos, graphics
/assets/fonts      typefaces
/src               code, if there's a build step
/archive           superseded versions — moved here, never deleted
```
Naming: lowercase-with-hyphens. No spaces, no capitals in filenames.
Dates as 2026-08-16 so they sort.

If files here don't match this yet, do NOT bulk-move them — a moved
asset breaks whatever points at it. Move them a few at a time, as you
touch them, and verify the site after each batch.

## README.md
Every repo keeps a README.md at root: what this project is, what's
done, what's next. Read it before starting. Update it when you finish.
If it's missing, write one.

## Session reports
Start — three lines: which repo, which branch, any branch holding work
that never reached main.
End — three lines: what changed, confirmed pushed to MAIN, the live
link and whether the deploy finished.

## Hosting
GitHub repo -> Cloudflare Pages. Pushing to main publishes. Don't
invent new hosting. Confirm the live domain in Cloudflare rather than
guessing before handing Jason a link.

## Known quirks
The bash sandbox may block requests to the live site. Normal, not a
failure — note it and move on. Jason checks in his own browser.

## Voice
Dramatic, irreverent, specific. Never soft, never generic,
never corporate.
