import express from 'express';
import { config } from './config';
import { corsMiddleware } from './cors';
import { router } from './routes';
import { productAuthRouter } from './productAuthRoutes';
import { setupRouter } from './setupRoutes';
import { pepperFingerprint } from './loginDebug';
import { mountSetupUi, setupUiDistExists } from './setupUiStatic';
import { reloadRuntimeFromSetup } from './runtimeSync';
import { removeSetupResumeIfAdminReady } from './setupResumeAuth';

// Bootstraps the service in a predictable order: load from product -> HTTP server.
async function bootstrap(): Promise<void> {
  await removeSetupResumeIfAdminReady();
  await reloadRuntimeFromSetup();

  const app = express();
  app.use(corsMiddleware());
  // API accepts/returns JSON payloads for all prototype endpoints.
  app.use(express.json());
  mountSetupUi(app);
  app.use('/setup/api', setupRouter);
  app.use('/auth/product', productAuthRouter);
  app.get('/', (_req, res) => res.redirect('/setup'));
  app.use(router);

  // Centralized error formatter for route-level failures.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Auth prototype running on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(
      `[auth] peppers user=${pepperFingerprint(config.userPepper)} admin=${pepperFingerprint(config.adminPepper)} jwt=${config.jwtSecretForProduct ? 'set' : 'missing'}`
    );
    if (setupUiDistExists()) {
      // eslint-disable-next-line no-console
      console.log(`Setup UI: http://localhost:${config.port}/setup`);
    } else {
      // eslint-disable-next-line no-console
      console.log('Setup UI not built — run: npm run build:setup-ui');
    }
  });
}

// Fail fast on startup errors so orchestration can restart the process.
bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start auth prototype:', error);
  process.exit(1);
});
