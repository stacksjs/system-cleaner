---
title: Installation
---

# Installation

## The app

Download the `.dmg` from the [latest release][releases], open it, and drag
SystemCleaner to Applications.

On first launch macOS asks for the access the app needs — Desktop, Documents,
and Downloads for scanning, and Finder automation so deletions go to the Trash
rather than being permanent. Each prompt explains what it is for. Granting Full
Disk Access in **System Settings → Privacy & Security** lets the app see
`~/Library` caches and login items, which is where most reclaimable space is.

Nothing leaves the machine. The app runs its own server on `127.0.0.1` and
stores its history in `~/Library/Application Support/SystemCleaner/`.

## The CLI

The release also carries a standalone `system-cleaner` binary:

```bash
curl -L -o system-cleaner.zip \
  https://github.com/stacksjs/system-cleaner/releases/latest/download/system-cleaner-darwin-arm64.zip
unzip system-cleaner.zip
sudo mv system-cleaner-darwin-arm64 /usr/local/bin/system-cleaner
system-cleaner --help
```

Apple silicon only. The CLI reads `~/Library`, `/Applications`, and `df` output,
so there is nothing for a Linux or Windows build to do.

## From source

```bash
git clone https://github.com/stacksjs/system-cleaner
cd system-cleaner
bun install
./buddy migrate      # creates database/stacks.sqlite from app/Models
bun run dev          # the app, in a native window
```

To produce the bundle yourself, see [Desktop App](/guide/desktop-app).

[releases]: https://github.com/stacksjs/system-cleaner/releases/latest
