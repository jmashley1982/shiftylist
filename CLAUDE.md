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

## Branches — the important part
Work on main. Commit to main. Push to main. Nothing else.

Do NOT create a branch. Do NOT open a pull request. Do NOT stack
changes on a feature branch "to be safe." Cloudflare Pages publishes
main, so work sitting on any other branch is invisible to Jason and
might as well not exist. This has burned him repeatedly. Don't do it.

Exception: if Jason says "preview it first," build on a branch, give
him the Cloudflare preview link, and wait. When he says ship it,
merge to main yourself and confirm it's live.

## Start of every session, report three lines
- Which repo you're in
- Which branch you're on (should be main — if not, switch)
- Any other branch holding work that never reached main

## End of every task, report three lines
- What changed
- Confirmed committed and pushed to MAIN
- The live link, and whether the deploy finished

## Hosting
GitHub repo -> Cloudflare Pages. Pushing to main publishes the site.
Don't invent new hosting setups. Confirm the live domain in Cloudflare
rather than guessing before you hand Jason a link.

## Known environment quirks
The bash sandbox may block outbound requests to the live site. That is
normal and not a failure — note it and move on. Jason checks the site
in his own browser.

## Voice
Dramatic, irreverent, specific. Never soft, never generic,
never corporate.
