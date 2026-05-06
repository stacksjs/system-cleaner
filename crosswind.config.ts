import type { CrosswindOptions } from '@cwcss/crosswind'

/**
 * Crosswind config for SystemCleaner.
 *
 * This app's design language follows the macOS Tahoe / Sequoia dark UI:
 * Apple system colors at well-known opacities, subtle 0.5px borders, and
 * an Inter typography stack. We map those tokens into the theme so that
 * the rest of the app can drop the bespoke `.card`, `.btn`, `.badge-*`
 * classes in favour of utility classes (`bg-system-fill/3`, `text-apple-blue`,
 * `border-system-stroke/6`, etc.) which compile through crosswind.
 *
 * Adding tokens via `extend` (rather than replacing the whole `theme`)
 * keeps every Tailwind-style default available too — `flex`, `gap-2`,
 * `rounded-lg`, `text-xs`, etc. all continue to work unchanged.
 */
const config = {
  verbose: false,
  // Crosswind needs an explicit content glob — without it the scanner
  // walks 0 files and emits 0 utilities. The previous run logged
  // "Built 0 classes" precisely because of this. Include every place we
  // write JSX/STX/TS markup so server-rendered classes are picked up.
  content: [
    './app.stx',
    './layouts/**/*.stx',
    './pages/**/*.stx',
    './components/**/*.stx',
  ],
  theme: {
    extend: {
      colors: {
        // Apple system colors in their dark-mode variants. Numbers match
        // the values currently scattered across `app.stx`'s <style> block
        // so utility-class migration is a one-to-one swap, not a redesign.
        'apple-blue': '#0a84ff',
        'apple-green': '#30d158',
        'apple-orange': '#ff9f0a',
        'apple-red': '#ff453a',
        'apple-purple': '#bf5af2',
        'apple-yellow': '#ffd60a',
        'apple-teal': '#64d2ff',
        'apple-pink': '#ff375f',

        // Background layers (darkest → lightest), used as solid fills.
        'bg-base': '#0d0d0d',
        'bg-chrome': '#1c1c1e',
        'bg-content': '#1a1a1c',
        'bg-card': '#242426',
        'bg-elevated': '#2c2c2e',
        'bg-track': '#3a3a3c',

        // Text colors. `text-strong` is body text on dark; `text-mid` is
        // subtitle copy; `text-dim` is the iconography/path label tier.
        'text-strong': '#f5f5f7',
        'text-body': '#d1d1d6',
        'text-mid': '#98989d',
        'text-dim': '#6c6c70',
        'text-faint': '#48484a',
        'text-mute': '#8e8e93',
      },
      borderRadius: {
        // Tahoe-style softer corners than Tailwind's defaults.
        'tahoe-sm': '5px',
        'tahoe': '7px',
        'tahoe-md': '8px',
        'tahoe-lg': '10px',
      },
      boxShadow: {
        toast: '0 8px 32px rgba(0, 0, 0, 0.4)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'SF Pro Display', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'ui-monospace', 'monospace'],
      },
    },
  },
} satisfies Partial<CrosswindOptions>

export default config as Partial<CrosswindOptions>
