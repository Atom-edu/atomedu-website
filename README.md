# atomEDU

atomEDU is a free, browser-based education product centered on **showing mathematical reasoning**. The public site is at [atom-edu.org](https://atom-edu.org/). It has two main experiences: **atomEDU Proof Lab** for students exploring and checking math, and **atomEDU for Teachers** for live rooms, assessments, and homework. The math engine is our own deterministic, rule-based code; MathLive and KaTeX provide input and typesetting, not mathematical decisions. Do not describe the product as an AI wrapper or imply that every possible problem is verified.

## What the product does

- **Proof Lab** (`/proof-lab`): Solve supported expressions and equations, check a student's steps and reconstruct supported Ghost steps, generate seeded practice by topic and difficulty, and explore 2D and 3D graphs. The solver runs in the browser without an LLM or remote answer API. Exact results and numerical graphing have different verification claims.
- **For Teachers** (`/teachers`): Create an **Orbit Room**, a live question-by-question activity with join code, timed answers, reveals, scoring, leaderboard, and teacher report. Create timed, password-protected assessments with a live teacher console and grading reports. Create persistent shareable homework assignments with a private teacher report link and CSV export. The standalone teacher flows do not require accounts; short-lived classroom sessions expire.
- **Students** (`/students/join` and activity links): Join a room with its code and name, or open an assessment/assignment link. The student and teacher views are separate.
- **Other site features**: Graph art contest and judging, public Live stream and manager, contact form and private acknowledgement inbox, learning and product explanation pages.
- **Canvas LTI 1.3** (`lti-api/`): A deployed LTI tool implements OIDC launch, Deep Linking, roster access, and grade posting. It passed a self-hosted Canvas test, but **no school Canvas installation is registered**. Link-based homework can be used in Canvas today with manual receipt/grade entry; that is not an LTI connection. See [the LTI setup and limits](./lti-api/README.md).

## Design system

The site has a restrained, editorial look: clear hierarchy, generous space, thin rules, flat sections, small functional controls, and real math content. Public pages use warm cream and clay. Proof Lab uses a compact dark header and a white work surface. Teachers uses that same header geometry and centered `atomEDU` wordmark, a white work surface, and blue for its product identity. Avoid generic floating card grids, card lift animations, heavy shadows, oversized headers, and decorative UI that makes an education tool look like a template.

| Role | Token / value | Where it appears |
| --- | --- | --- |
| Main ink and app header | `#1f2a36` | Text, dark 56px Proof Lab/Teachers header |
| Secondary ink | `#3a4654` | Supporting text |
| Public page cream | `#f6f5f2` | Main site background |
| Raised cream | `#fffdf9` | Public page light surfaces |
| Work surface | `#ffffff` | Proof Lab and Teachers workspace |
| Public warm accent / clay | `#bf5a2e` | Links, labels, Proof Lab controls |
| Deep clay | `#a2461f` | Warm hover and emphasis |
| Proof Lab header label | `#f0a782` | `Proof Lab` beside centered wordmark |
| Teacher blue | `#2d6ed0` | Teacher actions, active states |
| Deep teacher blue | `#205ba8` | Teacher links and emphasis |
| Teacher header label | `#78aef0` | `for Teachers` beside centered wordmark |
| Public rules | `#d8d2c8` | Lines and divisions on cream |
| Teacher rules | `#dce2e8` | Lines and divisions on white |
| Teacher secondary surface / blue wash | `#f8fafb` / `#eef4fb` | Recessed panels and blue emphasis |
| Teacher success / wash | `#28745a` / `#edf5f1` | Correct and completed states |
| Teacher error / wash | `#a34338` / `#fbefeb` | Incorrect and alert states |
| Teacher warning / wash | `#8b6505` / `#f8f1df` | Partial or pending states |
| Orbit answer colors | `#2d6ed0`, `#a94b42`, `#397b63`, `#74569b` | First four answer options; additional options use `#aa6b2a`, `#2a7382` |

Use **Space Grotesk** for body, UI, and the compact `atomEDU` wordmark (`EDU` bold); **Poiret One** for large public display headings; **Fraunces** sparingly for italic editorial accents; and local **KaTeX** fonts for rendered math. The app headers are 56px tall, with the wordmark centered. The public site header is 68px. Source of truth: [`styles.css`](./styles.css), [`math-lab.css`](./math-lab.css), and [`teacher.css`](./teacher.css). The teacher palette deliberately adds blue, green/red/yellow feedback, and distinct saturated answer-choice colors while retaining the shared ink and typography.

## Repository and runtime

The public pages are static HTML/CSS/JS. There is no site build step; serve the folder over HTTP so browser modules load. `engine/` contains the owned math engine, `graph/` the graph workspace, `vendor/` the checked-in MathLive and KaTeX browser assets, and `images/` the site art. The runtime services are separate packages: `classroom-api/` (Durable Object rooms and assessments), `lti-api/` (Canvas and shareable assignments), `contest-api/`, `contact-api/`, `live-signal-worker/` (WebRTC signaling), and `live-service/` (optional self-hosted media relay). Their READMEs contain service-specific setup and limits.

| Component | Responsibility | Storage / transport |
| --- | --- | --- |
| `engine/` and `graph/` | Browser-side math solving, checking, generation, and graphing | Local browser execution |
| `classroom-api/` | Live Orbit and timed assessment room state | Cloudflare Durable Objects and WebSockets |
| `lti-api/` | LTI launches, Canvas services, and standalone shareable assignments | Cloudflare Worker and D1 |
| `contest-api/` | Graph art submissions, judging, and winners | Cloudflare Worker, D1, and R2 |
| `contact-api/` | Message submission and private acknowledgement inbox | Cloudflare Worker and D1 |
| `live-signal-worker/` | Direct WebRTC presenter/viewer signaling | Cloudflare Worker; media travels browser to browser |
| `live-service/` | Optional larger-audience LiveKit relay | Self-hosted server; not the default public live path |

**Keep local dependencies temporary.** Each service has its own `package.json` and lockfile. When working on one service, run `npm ci` **in that service only**, perform its checks/deploy, then remove **that service's `node_modules/`** when done. Do not install dependencies for every service, and do not leave multiple large `node_modules/` folders in this repository. The checked-in site and deployed services continue to run without local `node_modules/`. The root site server and Node-based engine tests can run without a root install; install root dependencies only when refreshing bundled MathLive/KaTeX assets. See [`AGENTS.md`](./AGENTS.md) for contributor requirements.

**Restoring the contest API after a fresh checkout:** `contest-api/wrangler.jsonc` is local-only and is not in Git. Copy [`contest-api/wrangler.example.jsonc`](./contest-api/wrangler.example.jsonc) to `contest-api/wrangler.jsonc`, then fill in `d1_databases[0].database_id` using the ID of the **existing** `atom-contest` D1 database in the correct Cloudflare account. That database ID is the only difference between the former local config and the committed example. Do not create a new database or R2 bucket when restoring the checkout. The deployed Worker keeps running if local files are removed; a future contest API deployment needs this config restored. Worker secrets remain in Cloudflare, not in Git. See [`contest-api/README.md`](./contest-api/README.md) before deploying.

The production site publishes from the root of `main` through GitHub Pages. Keep `CNAME` set to `atom-edu.org` so the custom domain stays attached when replacing site files.

## Math engine

Proof Lab is a locally hosted visual LaTeX workbench with an owned deterministic symbolic math engine. It does not call an LLM, send problems to a remote service, or require an API key. MathLive supplies visual input and KaTeX supplies typesetting, both bundled locally with their licenses; neither decides mathematical correctness. Algebra uses exact rational arithmetic and polynomial identities rather than numerical sampling. Geometry measurements distinguish exact formulas from approximate numerical values.

Start the local server for browser modules:

```sh
npm start
```

Open [Proof Lab](http://127.0.0.1:8080/proof-lab.html). Its four views solve problems, check student work with Ghost steps, generate seeded practice at difficulty `0.000` through `1.000`, and provide a full interactive graphing workspace. Fractions, roots, matrices, piecewise functions, and other templates have editable placeholder boxes. A large symbol and number pad edits the active expression.

The graph offers Cartesian, logarithmic-axis, and polar-grid views. A user may explicitly share a bounded graph link to Google Classroom; that sends the graph expressions and window settings in the URL to Google, where the user chooses a class. This is link sharing, not roster access, automatic grading, or an OAuth-backed Classroom API connection. The math solver still runs locally and never calls Google to decide an answer.

The vendored math assets are ready to serve. Only when reinstalling or refreshing the pinned editor/renderer assets, run root `npm ci`, then `npm run build`, then remove root `node_modules/` after verification. This copies browser files, fonts, and licenses into the served assets. MathLive and KaTeX do not need a CDN at runtime; the site typography still loads from Google Fonts.

```sh
npm test
npm run benchmark
npm run benchmark:curriculum
node engine/cli.js solve 'f(x)=2/(x-3)+1'
node engine/cli.js solve 'x^2+1=0' --domain complex
node engine/cli.js check --problem '2(x+3)=14' --steps '2x+6=14;x=4'
node engine/cli.js generate --topic quadratic --difficulty 0.750 --seed practice --count 10
```

The generator CLI streams newline-delimited JSON, supports up to one million problems per invocation, and checks each problem before emitting its solution. Increasing the count does not create new mathematical rule families. The generated benchmark is a reproducible regression check. The separate curriculum benchmark uses fixed authored answers and includes known gaps; neither is a standardized curriculum assessment.

See [graph embedding and controls](./graph/README.md) for connecting the graph workspace to another page without a paid service.

See [the engine API and supported inputs](./engine/README.md) and [the product plan](./math-engine-plan.md).
The [standards coverage checklist](./docs/standards-coverage.md) maps verified subsets and remaining gaps against Missouri DESE Algebra I, Algebra II, Geometry, and AP Precalculus Units 1–4. It is not a claim of complete course coverage.

The [20-minute product demo script](./docs/product-video-script.md) pairs with the [20-slide browser presentation](./product-video.html). The [30-day education opportunity map](./docs/education-opportunities-30-days.md) separates actions we can take from approvals controlled by each platform.

## Pages
- `index.html` - main page
- `teachers.html` - teacher entry point for Orbit Rooms, assessments, and assignments
- `teachers-orbit-make.html`, `teachers-orbit-host.html` - Orbit creation and host view
- `teachers-quiz-make.html`, `teachers-quiz-console.html` - assessment creation and console
- `teachers-assignments.html` - shareable homework entry point
- `students/join.html`, `students/room.html`, `students/quiz.html` - student entry and activity views
- `features.html` - Proof Lab's four views, visual editor, and verification boundaries
- `learn.html` - how to use Proof Lab
- `about.html` - why atomEDU exists
- `contact.html` - public title and message contact form with no name collection
- `contact-manage.html` - password-protected contact inbox and acknowledgement tracking
- `proof-lab.html` - local math engine, work checking, and generated practice
- `math-lab.html` - redirect for old links
- `art-contest.html` - public daily graph-art contest
- `judging.html` - password-protected contest judging view
- `live.html`, `live-manage.html` - viewer and presenter pages
- `404.html` - missing-page experience

## Shared files
- `styles.css` - public site styling and shared palette
- `math-lab.css` - Proof Lab workspace and header
- `teacher.css` - teacher and student activity styling
- `site.js` - sticky header, mobile menu, active nav link
- `images/` - logos, three graph backgrounds, and footer artwork

## Fonts
Loaded from Google Fonts: Poiret One (headings), Fraunces (serif accent words), Space Grotesk (body), and Roboto (Classroom integration text). They load over the internet. To ship offline, download the font files and point the `@font-face` rules at local copies.

## About the images
The first home slide uses the local polar graph image `images/bg1.png`. The second uses the Webb Cosmic Cliffs image in `images/bg2.jpg`, and the third uses the Table Mountain pelargonium photo in `images/bg3.jpg`. Image credits are listed on the site. The footer uses the original `images/footer.svg` artwork.

## Color and type source
The palette above records the current design, but CSS is authoritative: check the `:root` blocks and component rules in `styles.css`, `math-lab.css`, and `teacher.css` before editing. Change related tokens consistently across the public site, Proof Lab, and Teachers.
