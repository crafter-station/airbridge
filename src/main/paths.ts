import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Turn a client-supplied relative path into an absolute one that is provably inside `root`,
 * or null if it tries to escape.
 *
 * This is the only thing standing between a share and the rest of the disk, so it rejects
 * rather than repairs: anything ambiguous is a refusal.
 */
export function resolveInside(root: string, requested: string): string | null {
  // Clients speak forward slashes regardless of platform.
  const segments = requested
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.some((segment) => segment === '..')) return null

  const target = resolve(root, ...segments)

  // A drive-relative segment like `C:` survives the `..` filter but changes the root, so the
  // containment check is done on the resolved result rather than on the input.
  return contains(root, target) ? target : null
}

/**
 * Re-check containment after following symlinks.
 *
 * `resolveInside` works on strings, so a symlink inside the share pointing at `~/.ssh` still
 * resolves to an in-share path. Sharing `~/Projects` must not mean sharing whatever it links
 * to, so every path is realpath-ed before a byte is read.
 */
export function isRealPathInside(root: string, target: string): boolean {
  try {
    return contains(realpathSync.native(root), realPathAllowingMissing(target))
  } catch {
    // Not readable at all. Callers treat that the same as "not allowed".
    return false
  }
}

/**
 * `realpath` for a path whose last segments may not exist yet.
 *
 * A plain realpath throws ENOENT, which would make "no such file" indistinguishable from
 * "outside the share" — the caller would answer 403 where it owes a 404. Uploads (M6) have
 * the same need, since their destination is missing by definition.
 *
 * Only the deepest *existing* ancestor is resolved. The missing tail is appended verbatim,
 * which is safe: a path that does not exist cannot be a symlink to somewhere else.
 */
function realPathAllowingMissing(target: string): string {
  const missing: string[] = []
  let current = target

  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause

      const parent = dirname(current)
      if (parent === current) throw cause

      missing.unshift(basename(current))
      current = parent
    }
  }
}

function contains(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (isAbsolute(rel)) return false

  // Compare path *segments*, not string prefixes: a file honestly named `..notes` produces a
  // relative path starting with `..` while sitting squarely inside the share.
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}
