import crypto from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { pool } from '../db';
import { issueAccessToken } from '../tokens';
import { assertPasskeyPlugin, resolvePasskeyConfig, type ResolvedPasskeyConfig } from '../plugin/passkeyConfig';
import { getPluginById } from '../plugin/pluginRegistry';
import type { PasskeyPluginManifest } from '../plugin/manifestSchema';
import { assertProviderReady, getProviderSetting } from '../providerSettings';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PASSKEY_ONLY_PASSWORD_SENTINEL = 'passkey:none';

type WebAuthnCredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
};

async function saveChallenge(
  challengeKey: string,
  challenge: string,
  provider: string,
  flow: 'registration' | 'authentication',
  userId: string | null
): Promise<void> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await pool.query(
    `
      INSERT INTO auth_webauthn_challenges (challenge_key, challenge, user_id, provider, flow, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (challenge_key) DO UPDATE SET
        challenge = EXCLUDED.challenge,
        user_id = EXCLUDED.user_id,
        provider = EXCLUDED.provider,
        flow = EXCLUDED.flow,
        expires_at = EXCLUDED.expires_at
    `,
    [challengeKey, challenge, userId, provider, flow, expiresAt]
  );
}

async function consumeChallenge(
  challengeKey: string,
  provider: string,
  flow: 'registration' | 'authentication'
): Promise<{ challenge: string; userId: string | null }> {
  const result = await pool.query<{
    challenge: string;
    user_id: string | null;
  }>(
    `
      DELETE FROM auth_webauthn_challenges
      WHERE challenge_key = $1 AND provider = $2 AND flow = $3 AND expires_at > NOW()
      RETURNING challenge, user_id
    `,
    [challengeKey, provider, flow]
  );
  if (!result.rowCount) {
    throw new Error('Challenge expired or invalid');
  }
  return { challenge: result.rows[0].challenge, userId: result.rows[0].user_id };
}

async function listUserCredentials(userId: string): Promise<WebAuthnCredentialRow[]> {
  const result = await pool.query<WebAuthnCredentialRow>(
    `
      SELECT id, user_id, credential_id, public_key, counter::text, transports
      FROM auth_webauthn_credentials
      WHERE user_id = $1
    `,
    [userId]
  );
  return result.rows;
}

async function getCredentialById(credentialId: string): Promise<WebAuthnCredentialRow | null> {
  const result = await pool.query<WebAuthnCredentialRow>(
    `
      SELECT id, user_id, credential_id, public_key, counter::text, transports
      FROM auth_webauthn_credentials
      WHERE credential_id = $1
      LIMIT 1
    `,
    [credentialId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function assertPasskeyProvider(provider: string): Promise<{
  manifest: PasskeyPluginManifest;
  config: ResolvedPasskeyConfig;
}> {
  await assertProviderReady(provider);
  const plugin = await getPluginById(provider);
  if (!plugin || plugin.manifest.type !== 'passkey') {
    throw new Error(`Unknown passkey provider: ${provider}`);
  }
  const setting = await getProviderSetting(provider, false);
  const manifest = assertPasskeyPlugin(plugin.manifest);
  const config = resolvePasskeyConfig(manifest, setting?.extraConfig || {}, undefined);
  return { manifest, config };
}

function assertOrigin(config: ResolvedPasskeyConfig, requestOrigin?: string): ResolvedPasskeyConfig {
  if (!requestOrigin) return config;
  if (!config.origins.includes(requestOrigin)) {
    throw new Error(`Origin "${requestOrigin}" is not allowed for WebAuthn`);
  }
  return { ...config, origin: requestOrigin };
}

export async function passkeyLoginOptions(
  provider: string,
  input: { email?: string; origin?: string }
): Promise<{ options: Awaited<ReturnType<typeof generateAuthenticationOptions>>; sessionId: string }> {
  const { config: baseConfig } = await assertPasskeyProvider(provider);
  const config = assertOrigin(baseConfig, input.origin?.trim());

  let userId: string | null = null;
  const email = input.email?.trim().toLowerCase();

  if (email) {
    const userResult = await pool.query<{ id: string }>(
      `SELECT id FROM auth_users WHERE login_email = $1 AND is_active = TRUE LIMIT 1`,
      [email]
    );
    if (!userResult.rowCount) {
      throw new Error('No account found for this email');
    }
    const userIdValue = userResult.rows[0].id;
    userId = userIdValue;
    const creds = await listUserCredentials(userIdValue);
    if (!creds.length) {
      throw new Error('No passkey registered for this account');
    }
  }

  const allowCredentials = userId
    ? (await listUserCredentials(userId)).map((c) => ({
        id: c.credential_id,
        transports: c.transports as AuthenticatorTransportFuture[],
      }))
    : undefined;

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: config.userVerification,
    allowCredentials,
  });

  const sessionId = crypto.randomBytes(16).toString('hex');
  await saveChallenge(sessionId, options.challenge, provider, 'authentication', userId);

  return { options, sessionId };
}

export async function passkeyLoginVerify(
  provider: string,
  input: {
    sessionId: string;
    credential: AuthenticationResponseJSON;
    origin?: string;
  }
): Promise<{ accessToken: string; user: { id: string; email: string; name: string } }> {
  const { config: baseConfig } = await assertPasskeyProvider(provider);
  const config = assertOrigin(baseConfig, input.origin?.trim());

  const { challenge, userId: challengeUserId } = await consumeChallenge(
    input.sessionId,
    provider,
    'authentication'
  );

  const stored = await getCredentialById(input.credential.id);
  if (!stored) {
    throw new Error('Unknown passkey credential');
  }
  if (challengeUserId && challengeUserId !== stored.user_id) {
    throw new Error('Credential does not match session');
  }

  const verification = await verifyAuthenticationResponse({
    response: input.credential,
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(stored.public_key),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new Error('Passkey verification failed');
  }

  await pool.query(
    `UPDATE auth_webauthn_credentials SET counter = $1 WHERE id = $2`,
    [verification.authenticationInfo.newCounter, stored.id]
  );

  const userResult = await pool.query<{ id: string; login_email: string; display_name: string }>(
    `SELECT id, login_email, display_name FROM auth_users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [stored.user_id]
  );
  if (!userResult.rowCount) {
    throw new Error('User not found');
  }
  const user = userResult.rows[0];
  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.login_email,
    name: user.display_name,
    provider,
  });

  return {
    accessToken,
    user: { id: user.id, email: user.login_email, name: user.display_name },
  };
}

export async function passkeyRegisterOptions(
  provider: string,
  input: { email?: string; name?: string; origin?: string; userId?: string }
): Promise<{ options: Awaited<ReturnType<typeof generateRegistrationOptions>>; sessionId: string }> {
  const { manifest, config: baseConfig } = await assertPasskeyProvider(provider);
  const config = assertOrigin(baseConfig, input.origin?.trim());

  let userId = input.userId?.trim();
  let email = input.email?.trim().toLowerCase();
  let displayName = input.name?.trim();

  if (userId) {
    const userResult = await pool.query<{ id: string; login_email: string; display_name: string }>(
      `SELECT id, login_email, display_name FROM auth_users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [userId]
    );
    if (!userResult.rowCount) throw new Error('User not found');
    email = userResult.rows[0].login_email;
    displayName = userResult.rows[0].display_name;
  } else {
    if (!email || !displayName) {
      throw new Error('email and name are required to register a passkey');
    }
    const existing = await pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM auth_users WHERE login_email = $1 LIMIT 1`,
      [email]
    );
    if (existing.rowCount) {
      userId = existing.rows[0].id;
      displayName = existing.rows[0].display_name;
    } else {
      userId = crypto.randomUUID();
      await pool.query(
        `
          INSERT INTO auth_users (id, login_email, password_hash, display_name, is_active)
          VALUES ($1, $2, $3, $4, TRUE)
        `,
        [userId, email, PASSKEY_ONLY_PASSWORD_SENTINEL, displayName]
      );
    }
  }

  const existingCreds = await listUserCredentials(userId!);
  const excludeCredentials = existingCreds.map((c) => ({
    id: c.credential_id,
    transports: c.transports as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: email!,
    userDisplayName: displayName!,
    userID: new TextEncoder().encode(userId!),
    attestationType:
      config.attestationType === 'indirect' ? 'direct' : config.attestationType === 'direct' ? 'direct' : 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: config.requireResidentKey ? 'required' : 'preferred',
      userVerification: config.userVerification,
      ...(manifest.passkey.authenticatorAttachment
        ? { authenticatorAttachment: manifest.passkey.authenticatorAttachment }
        : {}),
    },
  });

  const sessionId = crypto.randomBytes(16).toString('hex');
  await saveChallenge(sessionId, options.challenge, provider, 'registration', userId!);

  return { options, sessionId };
}

export async function passkeyRegisterVerify(
  provider: string,
  input: {
    sessionId: string;
    credential: RegistrationResponseJSON;
    origin?: string;
  }
): Promise<{ accessToken?: string; user: { id: string; email: string; name: string }; registered: boolean }> {
  const { config: baseConfig } = await assertPasskeyProvider(provider);
  const config = assertOrigin(baseConfig, input.origin?.trim());

  const { challenge, userId } = await consumeChallenge(input.sessionId, provider, 'registration');
  if (!userId) {
    throw new Error('Registration session invalid');
  }

  const verification = await verifyRegistrationResponse({
    response: input.credential,
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: config.userVerification === 'required',
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialId = input.credential.id;

  const dup = await getCredentialById(credentialId);
  if (dup) {
    throw new Error('This passkey is already registered');
  }

  await pool.query(
    `
      INSERT INTO auth_webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      crypto.randomUUID(),
      userId,
      credentialId,
      Buffer.from(credential.publicKey),
      credential.counter,
      input.credential.response.transports || [],
      credentialDeviceType,
      credentialBackedUp,
    ]
  );

  const userResult = await pool.query<{ id: string; login_email: string; display_name: string }>(
    `SELECT id, login_email, display_name FROM auth_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = userResult.rows[0];

  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.login_email,
    name: user.display_name,
    provider,
  });

  return {
    registered: true,
    accessToken,
    user: { id: user.id, email: user.login_email, name: user.display_name },
  };
}
