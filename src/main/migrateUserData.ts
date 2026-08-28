/**
 * One-time userData migration for the "Realtime Doctor" -> "RightHand" rebrand.
 *
 * The productName change moves Electron's userData directory
 * (macOS: ~/Library/Application Support/<name>, Windows: %APPDATA%/<name>),
 * so a 0.8.0 user upgrading would boot into an empty profile.
 *
 * This module runs as an import side effect and MUST be imported before any
 * module that touches userData (electron-store in ./store.ts creates its file
 * at module evaluation time). Keep it as the first import in main/index.ts.
 */
import { app } from 'electron';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OLD_USER_DATA_NAME = 'Realtime Doctor';
const MARKER_FILE = '.migrated-from-realtime-doctor';
/** electron-store `name` in ./store.ts -- its presence means the profile is already usable. */
const STORE_FILE = 'realtime-doctor.json';

function migrateUserData(): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;

  const newDir = app.getPath('userData');
  const oldDir = join(dirname(newDir), OLD_USER_DATA_NAME);
  if (oldDir === newDir) return;

  const marker = join(newDir, MARKER_FILE);
  if (existsSync(marker)) return;
  if (!existsSync(oldDir)) return;
  // Already carrying a profile of its own: nothing to import.
  if (existsSync(join(newDir, STORE_FILE))) {
    writeFileSync(marker, new Date().toISOString());
    return;
  }

  // `force: false` keeps anything already written to the new dir; the old dir is
  // left untouched as a backup.
  cpSync(oldDir, newDir, { recursive: true, force: false, errorOnExist: false });
  writeFileSync(marker, new Date().toISOString());
  console.log(`[migrate] copied userData from "${oldDir}" to "${newDir}"`);
}

try {
  migrateUserData();
} catch (err) {
  // Non-fatal: continue with a fresh profile rather than blocking startup.
  console.error('[migrate] userData migration failed, continuing with fresh profile:', err);
}
