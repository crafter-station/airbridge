import { app } from 'electron'
import { join } from 'node:path'

/** Where `resources/` ends up at runtime. In dev the main bundle sits in `out/main`, so the
 *  project root is two levels up; when packaged, electron-builder copies it to resourcesPath. */
export function resourcePath(...segments: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return join(root, ...segments)
}
