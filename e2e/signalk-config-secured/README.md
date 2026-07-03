# Secured-variant Signal K config (e2e fixture)

Config dir for the opt-in `signalk-secured` compose service — the same server image with security **enabled**, so the auth e2e (`tests/auth.e2e.spec.ts`) can prove every mutating plugin route 401s unauthenticated and works once signed in. The open stack deliberately can't test that.

Synthetic fixture credentials — this is a throwaway local/CI harness, not a secret:

- user `admin`, password `e2e-password` (the bcrypt hash in `security.json`)
- `secretKey` is a random fixture value with no meaning outside this harness

Start it with `docker compose --profile secured up -d --build signalk-secured`, then run the spec with `SECURED_URL=http://localhost:3001 npx playwright test tests/auth.e2e.spec.ts`.
