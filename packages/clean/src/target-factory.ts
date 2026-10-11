import type { CleanTarget } from './types'

/**
 * The shape of a clean target, and the icon vocabulary, in one place.
 *
 * Extracted so the macOS and Windows tables can both build targets without
 * either importing the other — the two tables and the platform selector would
 * otherwise form a cycle.
 */

/**
 * One Framework7 glyph per category.
 *
 * Targets used to carry a per-entry emoji, which put 61 different multi-color
 * glyphs into a list the rest of the app renders as single-tint icons. The row
 * already names the target and its category, so the icon only has to say which
 * kind of thing this is.
 */
const CATEGORY_ICONS: Record<CleanTarget['category'], string> = {
  cache: 'i-f7-archivebox-fill',
  log: 'i-f7-doc-text-fill',
  browser: 'i-f7-globe',
  developer: 'i-f7-chevron-left-slash-chevron-right',
  homebrew: 'i-f7-cube-box-fill',
  application: 'i-f7-app-fill',
  system: 'i-f7-desktopcomputer',
  trash: 'i-f7-trash-fill',
  // Emitted by the disk analyzer for build output it finds inside projects.
  'project-artifact': 'i-f7-hammer-fill',
}

/** Iconify class for a clean-target category. */
export function iconForCategory(category: CleanTarget['category']): string {
  return CATEGORY_ICONS[category] ?? 'i-f7-archivebox-fill'
}

/** A target a rebuild or a re-download replaces. */
export function t(
  id: string,
  name: string,
  p: string,
  category: CleanTarget['category'],
  description: string,
  contentsOnly = true,
  requiresSudo = false,
  skipPatterns?: string[],
): CleanTarget {
  return { id, name, path: p, icon: iconForCategory(category), category, description, contentsOnly, requiresSudo, risk: 'safe', skipPatterns }
}

/**
 * A target holding content the machine cannot get back on its own — session
 * transcripts, downloaded models, VM boxes. Same shape as `t()`, marked so the
 * UI can keep it out of "Select All" and label it.
 */
export function c(
  id: string,
  name: string,
  p: string,
  category: CleanTarget['category'],
  description: string,
  contentsOnly = true,
): CleanTarget {
  return { ...t(id, name, p, category, description, contentsOnly), risk: 'caution' }
}
