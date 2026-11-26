# atomEDU LTI 1.3 tool

This Worker provides a Canvas LTI 1.3 login, signed launch, instructor Deep Linking,
and server-side AGS/NRPS requests. The site remains accountless outside LTI.
The launch returns an activity picker or resource page directly so Canvas's
assignment selection iframe does not depend on third-party cookies.

The integration needs a Canvas administrator to install the tool and register
the institution's issuer, client ID, deployment ID, and service origin. A local
self-hosted Canvas test installation is registered; no school installation is.

## Deployment

1. Create the D1 database and put its ID in `wrangler.jsonc`.
2. Apply `migrations/0001_initial.sql` to the remote database.
3. Generate an RSA key pair for RS256. Store the PKCS#8 private PEM in the
   `LTI_PRIVATE_KEY` Worker secret. Store only the public JWK JSON in the
   `LTI_PUBLIC_JWK` Worker secret. The configured `LTI_KEY_ID` is the JWK `kid`.
4. Deploy the Worker. Keep the Worker URL stable; changing it breaks registered
   redirect and launch URLs.
5. Give the Canvas administrator `/lti/config/canvas` as the JSON configuration
   URL and `/lti/launch` as the redirect URI.

## Canvas registration

After the administrator has created and enabled the LTI key and installed it,
record the returned client ID and deployment ID. For Canvas production hosted by
Instructure, the issuer is `https://canvas.instructure.com`, the authorization
URL is `https://sso.canvaslms.com/api/lti/authorize_redirect`, and the JWKS URL
is `https://sso.canvaslms.com/api/lti/security/jwks`. The token URL and service
origin depend on the institution's Canvas domain. Confirm these exact values
with the administrator; do not infer the school domain from the issuer.

Use a prepared SQL command with bound values or a restricted internal admin
tool. Do not expose a public registration endpoint. Enable the platform and
deployment only after the values are verified. A registration requires rows
in `platforms` and `deployments`.

## Verification

```sh
npm install
npm run check
npm test
npm run dry-run
```

The automated tests simulate a signed Canvas launch, nonce failure, replay
failure, and an iframe Deep Linking response without browser cookies. A real
self-hosted Canvas installation also completed an HTTPS Resource Link launch
and a Deep Linking return on November 25, 2026. Its temporary tunnel URL is
for local testing only and must not be used as a school installation URL.

## Current limits

- Deep Linking currently creates a generic Proof Lab or Teachers resource. It
  does not select a particular teacher-made activity.
- The resource page opens the existing accountless site. Activity completion
  is not attached to the Canvas learner identity, so grades are not posted
  automatically. The AGS score route is a server-side integration primitive.
- NRPS reads the roster but does not yet show it in the teacher interface.
- An instructor Resource Link launch and Deep Linking return have been tested
  against self-hosted Canvas. A learner launch, roster query, and gradebook
  update remain to be tested end to end before claiming production
  interoperability with a school installation.
