# ShiftyList

The staff shift checklist for Viking Vapor & Smoke.

An employee taps in a 4-digit code on their phone, picks their shift, and gets
that shift's task list. They tick things off as they go — each tick is saved
the instant it happens — and submit a report at the end. Managers build the
lists, read the reports, and keep a company-wide goals board, all from the
Viking dashboard they already log into.

- **Staff:** [vikingvaporandsmoke.com/staff](https://vikingvaporandsmoke.com/staff)
- **Managers:** [vikingvaporandsmoke.com/admin/shifts](https://vikingvaporandsmoke.com/admin/shifts)

Runs as a Cloudflare Worker. **Pushing to `main` deploys it.**

## Where things are

```
/artifacts/shiftlist    the app — routes, views, the Worker entry point
/lib/db                 the database schema (Drizzle) and migrations
/docs                   plans, specs, briefs
/replit.md              the full technical notes: deploy, topology, gotchas
```

Start with `replit.md`. It is the long version of everything here.

## What's done

- Staff login, shift select, checklist, notes, shift report
- Extra one-off tasks for a single day; time windows with Overdue warnings
- Company Board — the company-wide goals list, shown once a day at login
- Homebase CSV schedule import, admin reports, live shift view
- Auto-submit for any shift left unclosed by 1am
- Logins stay alive through a whole shift, and a lost login drops you back on
  the checklist you were already working, ticks intact

## What's next

Nothing queued. Jason says the word, it gets built.
