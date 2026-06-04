import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import express from 'express';

const SETUP_UI_DIST = path.resolve(__dirname, '../setup-ui/dist');

export function setupUiDistExists(): boolean {
  return fs.existsSync(path.join(SETUP_UI_DIST, 'index.html'));
}

/** Serve React setup UI at /setup (API lives at /setup/api — see index.ts). */
export function mountSetupUi(app: Express): void {
  if (!setupUiDistExists()) {
    return;
  }

  const indexPath = path.join(SETUP_UI_DIST, 'index.html');
  const sendIndex = (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  };

  app.get(/^\/setup\/?$/, sendIndex);
  app.use('/setup', express.static(SETUP_UI_DIST, { index: false }));
}
