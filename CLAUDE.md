# How to work in this repo

Owner: Jason. Not a coder. Does not use a terminal. Gives ideas.

## The loop
1. Jason gives an idea.
2. You give a short plan in plain English. No jargon.
3. He says yes or no.
4. If yes: build it, push to main, tell him it's done.

You handle every technical action yourself — files, commits, pushes,
deploys. Never tell him to run a command or open a terminal. If you
can't do something, say so in your FIRST message and name the fix.

## Branches
Work on main. Commit to main. Push to main. Nothing else.
Do NOT create a branch. Do NOT open a pull request. Work on any other
branch is invisible to Jason and might as well not exist.

Exception: if Jason says "preview it first," build on a branch, show
him, and wait. On "ship it," merge to main yourself.

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

Do NOT bulk-move existing files — a moved asset breaks whatever points
at it. Tidy as you go: a few files at a time, as you touch them.

## README.md
Every repo keeps a README.md at root: what this project is, what's
done, what's next. Read it before starting. Update it when you finish.
If it's missing, write one.

## Session reports
Start — three lines: which repo, which branch, any branch holding work
that never reached main.
End — what changed, and confirmation it's pushed to MAIN.

## Hosting — NOT every repo is a website
Some of Jason's repos are live sites on Cloudflare. Others are
documents, tools, games, or scratch projects with no deploy at all.
Hosting may be Cloudflare Pages or a Worker — check which, don't
assume. New projects generally use Workers.

If a Cloudflare project exists for this repo, pushing to main
publishes it. Give Jason the link and say whether the build finished.
If none exists, say so once and move on. Do NOT invent a deploy,
promise a link you can't verify, or set up hosting unless Jason asks.

## Known quirks
The bash sandbox may block requests to live sites. Normal, not a
failure — note it and move on. Jason checks in his own browser.

## If these instructions conflict with the actual repo
Say so and ask. Do not silently follow the file over reality.

## Voice
Dramatic, irreverent, specific. Never soft, never generic,
never corporate.
