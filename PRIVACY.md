# SystemCleaner privacy policy

SystemCleaner reads your Mac to show you what is on it, and sends none of it anywhere.

This policy covers the SystemCleaner app, both the edition downloaded from
[system-cleaner.app](https://system-cleaner.app) and the edition on the Mac App
Store. It matches the privacy page on the website.

## What runs on your Mac

Every scan happens on the Mac you are using. Disk analysis, process sampling,
startup item discovery, extension inventory and cleanup all read the local
filesystem and local system APIs. There is no remote scanning service and no
upload step.

## What the app reads

- **Storage.** File and folder sizes under your home directory and the folders
  you open, so the disk map can be drawn.
- **Processes.** Process names, owners, CPU and memory, refreshed while a
  process view is open.
- **Startup items.** Launch agents and daemons in the standard user, system and
  daemon locations.
- **Browser extensions.** Extension manifests inside the browser profiles
  already on the Mac.
- **Update availability.** On its own, the app reads only what macOS and
  Homebrew already know about pending updates. Pantry's registry and the App
  Store are asked when you open Updates or Installed Apps.

The Mac App Store edition runs in Apple's App Sandbox and reads only the folders
you choose to give it.

## What never leaves your Mac

None of the above is transmitted, logged remotely or written to any service.
There is no telemetry, no crash reporter, no analytics and no advertising
identifier. The app needs no account, so there is nothing to attach a profile
to. SystemCleaner collects no personal data.

## When the app uses the network

SystemCleaner reaches the network in three situations, and only one of them
happens on its own:

1. **A daily check for a new version of SystemCleaner** (the downloaded edition
   only). About once a day the app fetches one small file from the latest
   release on GitHub to see whether a newer version is out. It sends nothing
   about your Mac; GitHub sees an ordinary download from your network address.
   It is on by default and you can turn it off in Settings, under General, with
   "Check for updates automatically". Nothing downloads or installs until you
   choose to. The Mac App Store edition makes no such check, because the App
   Store delivers its updates.
2. **Checking your other software for updates**, when you open Updates or
   Installed Apps. That asks Apple, the App Store, Homebrew and Pantry what is
   newer than what you have installed.
3. **Downloading a new version of SystemCleaner**, when you press Download in
   Software Update (the downloaded edition only).

Opening the app, scanning and cleaning send nothing anywhere, and none of these
requests carries information about your Mac or its contents.

## The website

[system-cleaner.app](https://system-cleaner.app) sets no tracking cookies and
runs no analytics. If you subscribe to release notes, your email address is
stored for that mailing list and used for nothing else. Every message has an
unsubscribe link.

## Verifying any of this

SystemCleaner is open source. Every scan path, every network call and every
delete operation is readable in this repository, and the cleanup code lists its
target directories explicitly rather than searching your whole disk.

## Contact

Questions about privacy: open an issue at
[github.com/stacksjs/system-cleaner/issues](https://github.com/stacksjs/system-cleaner/issues).
