import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * The plan §8 auth verification, against a REAL secured Signal K server (the open stack can't prove
 * this): every mutating plugin route answers 401 unauthenticated, read-only routes stay open, and a
 * signed-in session (the JAUTHENTICATION cookie from /signalk/v1/auth/login) passes. Runs only when
 * the opt-in `secured` compose profile is up and SECURED_URL points at it — the default lane skips.
 */

const SECURED = process.env.SECURED_URL ?? '';

test.skip(
  SECURED === '',
  'secured stack not running (set SECURED_URL, e.g. http://localhost:3001)',
);

const P = '/plugins/sk-video';

/** Every mutating route family, one representative each. Auth runs before existence checks, so an
 *  unknown camera/bundle id still exercises the gate. */
const MUTATING: Array<{ method: 'post' | 'put' | 'delete'; path: string; data?: unknown }> = [
  { method: 'post', path: `${P}/mob`, data: {} },
  { method: 'post', path: `${P}/cameras/ghost/record`, data: { active: true } },
  { method: 'post', path: `${P}/cameras/ghost/snapshot` },
  { method: 'post', path: `${P}/cameras/ghost/ptz`, data: { pan: 0.1 } },
  { method: 'post', path: `${P}/cameras/ghost/ptz/stop` },
  { method: 'post', path: `${P}/cameras/ghost/imaging/preset`, data: { preset: 'auto' } },
  { method: 'post', path: `${P}/cameras/ghost/calibration`, data: {} },
  { method: 'post', path: `${P}/cameras/ghost/slew-to-cue` },
  { method: 'post', path: `${P}/cameras/ghost/rescan` },
  { method: 'post', path: `${P}/incidents`, data: {} },
  { method: 'delete', path: `${P}/incidents/ghost` },
  { method: 'post', path: `${P}/notifications/ack`, data: { key: 'mob' } },
  { method: 'post', path: `${P}/cameras/ghost/credentials`, data: { password: 'x' } },
  { method: 'post', path: `${P}/videos` },
  { method: 'post', path: `${P}/push/subscribe`, data: {} },
  { method: 'delete', path: `${P}/videos/ghost` },
  { method: 'put', path: `${P}/operational-config`, data: {} },
];

async function freshContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: SECURED });
}

test('every mutating route 401s for an unauthenticated caller', async () => {
  const ctx = await freshContext();
  for (const route of MUTATING) {
    const res = await ctx[route.method](route.path, route.data ? { data: route.data } : {});
    expect(res.status(), `${route.method.toUpperCase()} ${route.path}`).toBe(401);
  }
  await ctx.dispose();
});

test('the server guards ALL plugin routes when secured; reads open up once signed in', async () => {
  // Real signalk-server behavior: with security on, anonymous readonly covers only the /signalk/*
  // APIs — everything under /plugins/* requires a login at the SERVER, before our own gates run.
  // The plugin's per-route gating is defense-in-depth for mutations, not the only wall.
  const ctx = await freshContext();
  for (const path of [`${P}/status`, `${P}/mob`, `${P}/session`, `${P}/events/log`]) {
    expect((await ctx.get(path)).status(), `anonymous GET ${path}`).toBe(401);
  }
  expect((await ctx.get('/signalk/v1/api/vessels/self')).status()).toBe(200); // readonly API stays open

  const login = await ctx.post('/signalk/v1/auth/login', {
    data: { username: 'admin', password: 'e2e-password' },
  });
  expect(login.ok()).toBeTruthy();
  for (const path of [`${P}/status`, `${P}/mob`, `${P}/session`, `${P}/events/log`]) {
    const res = await ctx.get(path);
    expect([200, 503], `signed-in GET ${path} -> ${res.status()}`).toContain(res.status());
  }
  const session = await ctx.get(`${P}/session`).then((r) => r.json());
  expect(session).toMatchObject({ securityEnabled: true, authenticated: true });
  await ctx.dispose();
});

test('a signed-in session passes the gate (cookie from /signalk/v1/auth/login)', async () => {
  const ctx = await freshContext();
  const login = await ctx.post('/signalk/v1/auth/login', {
    data: { username: 'admin', password: 'e2e-password' },
  });
  expect(login.ok(), `login -> ${login.status()}`).toBeTruthy();

  const session = await ctx.get(`${P}/session`).then((r) => r.json());
  // The admin login is a real, writable principal — the enriched contract the web app gates on.
  expect(session).toMatchObject({
    securityEnabled: true,
    authenticated: true,
    readOnly: false,
    loggedIn: true,
    canWrite: true,
    anonymous: false,
  });

  // A representative mutating call now succeeds (and is cleaned up).
  const arm = await ctx.post(`${P}/mob`, { data: {} });
  expect(arm.status(), 'authenticated POST /mob').toBe(200);
  const disarm = await ctx.post(`${P}/mob`, { data: { active: false } });
  expect(disarm.status()).toBe(200);
  await ctx.dispose();
});

test('a non-admin user is denied the whole plugin surface — SK Video is admin-only when secured', async () => {
  // GROUND TRUTH (verified against signalk-server): `app.use('/plugins', adminAuthenticationMiddleware)`
  // gates ALL of /plugins/* behind ADMIN. A logged-in read-only (or read-write) user can't reach SK
  // Video's app or API at all — even reads. So the webapp's read-only mode (state 8) is UNREACHABLE
  // with default security: the only users who can load SK Video on a secured server are admins
  // (canWrite:true). Read-only stays a designed-but-dormant state, waiting on a server capability that
  // serves the plugin's read routes to non-admins (the "backend refinement" the design spec named).
  const ctx = await freshContext();
  const login = await ctx.post('/signalk/v1/auth/login', {
    data: { username: 'viewer', password: 'e2e-password' },
  });
  expect(login.ok(), `readonly login -> ${login.status()}`).toBeTruthy();

  for (const path of [`${P}/session`, `${P}/status`, `${P}/app/`]) {
    expect((await ctx.get(path)).status(), `readonly GET ${path}`).toBe(401);
  }
  // …while the general Signal K data API still serves a read-only login (allow_readonly).
  expect(
    (await ctx.get('/signalk/v1/api/vessels/self')).status(),
    'readonly GET vessels/self',
  ).toBe(200);
  await ctx.dispose();
});
