import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import express from 'express';

function resolveSetupUiDist(): string | null {
  const candidates = [
    path.resolve(__dirname, '../setup-ui/dist'),
    // Older deploy packages copied dist contents directly into setup-ui/
    path.resolve(__dirname, '../setup-ui'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function setupUiDistExists(): boolean {
  return resolveSetupUiDist() !== null;
}

/** Serve React setup UI at /setup (API lives at /setup/api — see index.ts). */
export function mountSetupUi(app: Express): void {
  const setupUiDist = resolveSetupUiDist();
  if (!setupUiDist) {
    return;
  }

  const indexPath = path.join(setupUiDist, 'index.html');
  const sendIndex = (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  };

  app.get(/^\/setup\/?$/, sendIndex);
  app.use('/setup', express.static(setupUiDist, { index: false }));
}
