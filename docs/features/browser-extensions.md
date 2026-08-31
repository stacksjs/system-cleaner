---
title: Browser Extensions
---

# Browser Extensions

Every browser add-on you have installed, across every browser and every profile,
in one inventory.

## What it reads

| Browser | Source |
|---|---|
| Chrome, Edge, Brave, Arc | Each profile's `Extensions` directory and the `manifest.json` of the newest version |
| Firefox | Each profile's `extensions.json` |

Chromium profiles are enumerated properly, so `Default` and every `Profile N`
are covered rather than just the first one. Extensions whose manifest uses
`__MSG_*__` placeholders for their name and description are resolved through the
extension's own `_locales/en/messages.json`, so the list shows real names
instead of the raw token.

## Permissions

Each row shows how many permissions the extension declares — its API permissions
plus its host permissions added together.

That count is a prompt to look, not a verdict. A password manager legitimately
asks for a great deal; a "dark mode" extension asking for the same thing is
worth a second look. Extensions declaring more than five are highlighted.

## Size

Each extension is measured on disk — the whole `Extensions/<id>` directory for
Chromium, the `.xpi` for Firefox. Sizes arrive in a second pass, because walking
every version directory of every extension across every profile takes seconds
and the list is worth reading before the numbers land.

**Rescan** bypasses the cache. The list is held for a minute and the sizes for
five, which is right for moving between screens and wrong for the one control
whose entire purpose is to go and look again.

## Removing one

There are two ways, and both are on the row, because which one you want depends
on where the extension came from.

**Remove** deletes the extension's files. It is immediate, it frees the space,
and for anything sideloaded or loaded unpacked it is the end of the matter.

**In browser** opens the browser's own extensions page. It is the slower path
and the only complete one.

### Why "Remove" is not always enough

Chromium registers its extensions in a file whose entries carry an HMAC, added
specifically so that programs other than the browser cannot edit the registry.
SystemCleaner does not touch it: rewriting it would make Chrome detect tampering
and reset settings, which is a worse outcome than the one being fixed.

The consequence is stated rather than hidden. An extension that came from the
Chrome Web Store is marked **syncable**, and if that browser is signed in to
sync, it can be reinstalled at the next launch. Removing it in the browser is
what revokes the sync entry. Extensions with any other kind of id — sideloaded,
unpacked, or a Firefox add-on — have nothing to sync from, so deleting them is
final. The confirmation says which case you are in before you agree to it.

Firefox is simpler: the `.xpi` is deleted and the add-on's entry is pruned from
`extensions.json`, so nothing is left showing as broken. A registry that cannot
be read or parsed is left exactly as it was — Firefox recovers from a missing
file on its own, and a half-written registry would cost the profile.

### Open browsers are skipped

Same rule as the [privacy clean](./privacy.md): deleting an extension out from
under a running browser corrupts the profile rather than uninstalling anything,
and the damage surfaces at the next launch. A browser that is open has its
extensions listed, with removal disabled and the reason on screen. **In browser**
still works — quitting is only required for the on-disk delete.

## Finding what you did not know about

The other half of what this screen is for: the extension an installer added
once, or one synced in from a machine you no longer use, that you would never
have thought to go looking for.
