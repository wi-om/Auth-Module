import crypto from 'crypto';
import { issueAccessToken } from '../tokens';
import { getPluginById } from '../plugin/pluginRegistry';
import type { OAuthPluginManifest } from '../plugin/manifestSchema';
import {
  assertProviderReady,
  BUILTIN_PASSWORD_PROVIDER,
  getProviderSetting,
  type ProviderSettingPublic,
} from '../providerSettings';
import {
  buildOAuthAuthorizeUrl,
  createPrototypeOAuthSession,
  exchangeAuthorizationCode,
  fetchOAuthUserProfile,
  getFrontendOAuthCompleteUrl,
  isOAuthPrototypeMode,
  mapProfileToUser,
  type OAuthStartResult,
} from './oauthAdapter';
import { consumeOAuthState, saveOAuthState } from './oauthStateStore';

/**
 * Auth flow orchestration: JWT issuance routes through adapter → plugin manifest (OAuth) or builtin password.
 */
export class AuthAdapter {
  async startOAuth(provider: string): Promise<OAuthStartResult & { accessToken?: string }> {
    const setting = await assertProviderReady(provider);

    if (provider === BUILTIN_PASSWORD_PROVIDER) {
      throw new Error('Password provider does not support OAuth');
    }

    const plugin = await getPluginById(provider);
    if (!plugin) {
      throw new Error(`Unknown provider plugin: ${provider}`);
    }
    if (plugin.manifest.type === 'passkey') {
      throw new Error('Passkey provider does not support OAuth');
    }

    if (isOAuthPrototypeMode()) {
      const session = createPrototypeOAuthSession(provider, setting.label);
      const accessToken = issueAccessToken({
        sub: session.user!.id,
        email: session.user!.email,
        name: session.user!.name,
        provider,
      });
      return { ...session, accessToken };
    }

    const state = crypto.randomBytes(24).toString('hex');
    saveOAuthState(state, provider);
    const redirectUrl = buildOAuthAuthorizeUrl(plugin.manifest, setting, state);
    return {
      mode: 'redirect',
      provider,
      label: setting.label,
      redirectUrl,
      state,
    };
  }

  async completeOAuthCallback(
    provider: string,
    code: string,
    state: string
  ): Promise<{ redirectUrl: string }> {
    if (!code) throw new Error('Missing authorization code');
    if (!state || !consumeOAuthState(state, provider, 'product')) {
      throw new Error('Invalid or expired OAuth state');
    }

    const setting = await assertProviderReady(provider);
    const settingWithSecret = await getProviderSetting(provider, true);
    if (!settingWithSecret?.hasClientSecret) {
      throw new Error('Provider client secret is not configured');
    }

    const plugin = await getPluginById(provider);
    if (!plugin) throw new Error(`Unknown provider plugin: ${provider}`);
    if (plugin.manifest.type !== 'oauth') {
      throw new Error('Provider is not an OAuth plugin');
    }
    const oauthManifest: OAuthPluginManifest = plugin.manifest;

    const clientSecret = settingWithSecret.clientSecretMasked;
    const idpAccessToken = await exchangeAuthorizationCode(oauthManifest, setting, clientSecret, code);

    const profile = await fetchOAuthUserProfile(oauthManifest, idpAccessToken);
    const user = mapProfileToUser(oauthManifest, provider, setting.label, profile);

    const accessToken = issueAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      provider,
    });

    const complete = new URL(getFrontendOAuthCompleteUrl());
    complete.searchParams.set('accessToken', accessToken);
    complete.searchParams.set('provider', provider);
    complete.searchParams.set('email', user.email);
    complete.searchParams.set('name', user.name);
    complete.searchParams.set('userId', user.id);

    return { redirectUrl: complete.toString() };
  }

  issueTokenForPasswordUser(user: {
    id: string;
    login_email: string;
    display_name: string;
  }): { accessToken: string; user: { id: string; email: string; name: string } } {
    const accessToken = issueAccessToken({
      sub: user.id,
      email: user.login_email,
      name: user.display_name,
      provider: BUILTIN_PASSWORD_PROVIDER,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.login_email,
        name: user.display_name,
      },
    };
  }
}

export const authAdapter = new AuthAdapter();

export type { ProviderSettingPublic };
