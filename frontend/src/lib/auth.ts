import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

/** Dev-only: skip Cognito entirely. NODE_ENV is inlined by Next, so a production build can never bypass. */
export function authBypassed(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AUTH_MODE === 'none';
}

let manager: UserManager | undefined;

/** Cognito Hosted UI, authorization code + PKCE. Tokens live in sessionStorage. */
export function getUserManager(): UserManager {
  manager ??= new UserManager({
    authority: process.env.NEXT_PUBLIC_COGNITO_AUTHORITY ?? '',
    client_id: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
    redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'openid email',
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  return manager;
}

/** Returns an access token, starting the login redirect when there is no valid session. */
export async function getAccessToken(): Promise<string | null> {
  const um = getUserManager();
  const user = await um.getUser();
  if (user && !user.expired) return user.access_token;
  await um.signinRedirect();
  return null;
}
