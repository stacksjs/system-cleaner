---
title: Privacy
---

# Privacy

Clears browsing history, cookies, downloads, sessions, and the traces macOS
keeps — with a keep-list so a clear does not sign you out of everything.

## The keep-list

Clearing every cookie signs you out of every site you use, which is why the box
goes permanently unticked and the feature may as well not exist.

Add the handful of sites you never want to log into again under **Stay signed in
to**. Matching is by suffix, so `github.com` also keeps `gist.github.com`. The
card at the top of the screen shows how many real cookies the list would
preserve, so you can see it working before you press anything.

Cookies are removed a row at a time from the browser's own database rather than
by deleting the file, which is what makes keeping any of them possible.

## Open browsers are skipped

Chromium and Firefox hold their databases open with a write-ahead log. Deleting
one under a running browser does not clear history — it corrupts the profile,
and the damage appears at the next launch, long after anyone would connect it to
this app.

So a browser that is open has its rows listed, disabled, with the reason. Quit
it and press **Rescan**.

## What each row costs you

Every row is marked either **rebuilt** or **you lose state**:

- **rebuilt** — caches, history, download lists, service workers. The browser
  regenerates these as you use it and nothing is gone for good.
- **you lose state** — cookies, open tabs, local storage, form autofill. These
  are the ones that sign you out or close what you had open.

**Select Safe** ticks only the first kind. **Select All** takes both.

## Row-level, not file-level

Chromium keeps history, downloads, and typed search terms in one `History`
database. Clearing a download list by deleting that file would take the other
two with it, so those rows delete their own tables and then `VACUUM` — which is
the step that actually returns the space to the filesystem.

## Safari and passwords

Safari stores cookies in a single binary file rather than a database, so it is
the one browser where the keep-list cannot apply: clearing Safari cookies clears
all of them.

Passwords are never touched by anything on this screen. They live in the
Keychain, which the app does not read.

## What macOS keeps

Three rows at the bottom are not a browser's:

- **Recent items** — the recent documents, applications, and servers lists
- **Download log** — the record macOS keeps of every file downloaded and the URL
  it came from, going back years
- **Shell history** — every command typed into a terminal, including any that
  had a secret in it
