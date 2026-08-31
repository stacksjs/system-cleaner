/**
 * Colour utilities that only ever reach the DOM through a `:class` binding.
 *
 * The dashboard's process table colours each row from its CPU number —
 * `cpuBarClass(proc.cpu)` answers `bg-apple-red` — and that decision lives in
 * `public/dashboard-xdata.js`, which no template mentions. Crosswind's scanner
 * therefore never saw the class and purged it, so every bar rendered with no
 * background at all: transparent, over its own dark track, at the correct
 * width. Which made all of them look identical, and none of them look like a
 * measurement — a 99% process and a 5% one drew the same bar.
 *
 * Adding `public/**` to the content globs does not fix it; the scanner reads
 * markup, not the string a function returns. Safelisting is the mechanism this
 * repo already uses for the same problem with icons — see
 * [[runtime-icons]] — and `tests/runtime-icons.test.ts` fails if a class
 * appears in `public/*.js` without being listed here.
 */
export const RUNTIME_COLOR_CLASSES: string[] = [
  // Process CPU bars and their percentage labels (dashboard-xdata.js)
  'bg-apple-red',
  'bg-apple-orange',
  'bg-apple-green',
  'text-apple-red',
  'text-apple-orange',
]
