# atomEDU for Canvas (LTI 1.3)

The Worker at `https://atom-lti-api.archimedes-api1.workers.dev` is atomEDU's
Canvas LTI 1.3 tool. Canvas authenticates each launch using OpenID Connect and
a signed JWT. The Worker verifies issuer, audience, deployment, nonce,
signature, resource link, and one-time launch state. It stores course
activities and submissions in D1. Outside Canvas, atomEDU stays accountless.

## Teacher and student flow

1. In a Canvas course assignment, the teacher selects atomEDU. The Deep
   Linking picker creates an assessment or chooses one saved in that course.
   Questions support multiple choice, multi-select, true/false, fill in the
   blank, and teacher-graded free response, plus passages, images, and points.
   The signed response gives Canvas the activity ID and total points.
2. The teacher saves and publishes the assignment. Canvas launches that
   activity for each student. The verified Canvas user and course IDs identify
   the submission; the student needs no additional login.
3. Student work is stored before grading. Objective scores use AGS immediately.
   Written responses wait for teacher review. Teachers can override any
   question's points and retry a failed Canvas grade sync from the report.
4. The assignment report shows submissions and the course roster using NRPS.

Each assessment currently allows one submission per student, up to 20
questions, and resized images. Generic Proof Lab and Teachers links open the
standalone site and do not create Canvas grades.

## Using assignments without Canvas administrator access

Teachers can open `https://atom-edu.org/teachers-assignments` and create a
link-based assignment without an account. The builder returns a student link
and a private teacher report link. The student link opens a persistent
assessment where students enter their names, submit answers, and receive a
completion receipt. The teacher link shows responses, allows manual grading
and point overrides, and exports grades as CSV. Save the private link: it is
the only way to manage the assignment. Assignments and submissions expire
after 180 days; each assignment accepts up to 300 distinct names.

To use this in Canvas, create a normal assignment with **Online → Text Entry**
submission, paste the student link into its description, and ask students to
paste their receipt. Use the atomEDU report or CSV to enter scores in Canvas.
This is a link-based workflow, not an LTI installation: student names are
self-entered, Canvas identity is not verified, and gradebook/roster sync is
unavailable. A school administrator is still needed for those LTI features.
The public creation endpoint is limited to 10 assignments per client IP per
UTC day with an HMAC-hashed IP key; no raw IP is stored in D1.

## Canvas installation

Give the school's Canvas administrator these URLs:

- JSON configuration: `https://atom-lti-api.archimedes-api1.workers.dev/lti/config/canvas`
- OIDC initiation: `https://atom-lti-api.archimedes-api1.workers.dev/lti/login`
- Redirect URI: `https://atom-lti-api.archimedes-api1.workers.dev/lti/launch`
- JWKS: `https://atom-lti-api.archimedes-api1.workers.dev/lti/jwks`

The administrator creates and enables a Canvas LTI 1.3 registration from the
JSON configuration, then installs it at the desired account or course. They
must give atomEDU the resulting client ID and deployment ID, the institution's
Canvas URL, and the issuer, authorization, token, and JWKS URLs. For
Instructure-hosted Canvas the issuer is usually
`https://canvas.instructure.com`, authorization is
`https://sso.canvaslms.com/api/lti/authorize_redirect`, and JWKS is
`https://sso.canvaslms.com/api/lti/security/jwks`. The token endpoint and
service origin use the school's Canvas domain. Confirm each value from the
actual installation; self-hosted Canvas has different values.

Register verified values in D1 with `scripts/register-canvas.mjs`. Run it
without `--apply` first to validate and review, then rerun with `--apply`.
The script writes a restricted temporary SQL file and removes it afterward.
There is no public registration endpoint. Each school needs its own record.

```sh
node scripts/register-canvas.mjs \
  --issuer https://canvas.instructure.com \
  --client-id CLIENT_ID \
  --deployment-id DEPLOYMENT_ID \
  --auth-url https://sso.canvaslms.com/api/lti/authorize_redirect \
  --token-url https://SCHOOL.instructure.com/login/oauth2/token \
  --jwks-url https://sso.canvaslms.com/api/lti/security/jwks \
  --service-origin https://SCHOOL.instructure.com \
  --institution 'School name'
```

## OAuth 2.0 and keys

No separate Canvas REST API consent or client secret is needed for LTI
Advantage. For AGS and NRPS, the Worker signs a short-lived RS256 JWT with
`iss` and `sub` equal to its Canvas client ID, sends it to Canvas as a
`client_credentials` assertion, requests a specific scope, and uses the
returned bearer token only on the server.

`LTI_PRIVATE_KEY` is the PKCS#8 signing secret. `LTI_PUBLIC_JWK` is its public
JWK; its published `kid` is `LTI_KEY_ID`. During rotation, publish the old
public JWK (with its old `kid`) in optional `LTI_PREVIOUS_PUBLIC_JWK`, update
the current signing pair and key ID, deploy, then remove the previous key
after old responses are no longer accepted. Keep private keys out of Git.

## Verification and status

```sh
npm install
npm run check
npm test
npm run dry-run
```

Tests use real SQLite migrations and signed JWTs for Deep Linking, student
submission, teacher grading, OAuth assertions, score posting, invalid grades,
duplicate submissions, nonce failure, and replay. On November 25, 2026, a
real self-hosted Canvas instance completed instructor and learner launches,
Deep Linking, NRPS roster retrieval, automatic score posting, teacher review
of a written response, and gradebook updates of 5/5 and 5/6. It uses a
temporary HTTPS tunnel for local testing only.

No school Canvas installation is registered. A school administrator must
install the tool and provide its identifiers before school use can be tested.
The local test cannot cover every school's policies or settings.
