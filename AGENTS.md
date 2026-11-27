# Working on atomEDU

Read [`README.md`](./README.md) for the product overview, architecture, and palette. This file applies to the entire repository. Preserve the user's current request and the existing product behavior when changing code or copy.

## Product and claims

- atomEDU is a free education product about showing and checking mathematical reasoning. Its two main experiences are **atomEDU Proof Lab** and **atomEDU for Teachers**.
- Proof Lab has an owned deterministic symbolic engine in `engine/`. MathLive is the input editor and KaTeX renders math; neither decides correctness. Do not suggest that an LLM supplies the answers. Label unsupported or numerical-only work accurately; graph output alone is not a proof.
- Teachers includes Orbit Rooms, timed assessments, and shareable assignments. Student join and activity pages live under `/students/`. Standalone classroom flows are accountless; temporary room data expires. Shareable assignments have private teacher report links and a separate retention period.
- Canvas LTI 1.3 code and a deployed Worker exist in `lti-api/`. A self-hosted Canvas test passed. **No school Canvas installation is registered**; never say that a school is connected or that link-based assignments provide automatic Canvas roster or gradebook sync. A school administrator must install the tool and supply registration details.
- Web quiz integrity controls cannot disable operating-system shortcuts, close arbitrary tabs, or guarantee cheating prevention. Keep security descriptions factual.

## Visual style: use the existing product as reference

The design should look like one coherent education product, with readable math and restrained, editorial UI. Inspect `styles.css`, `math-lab.css`, `teacher.css`, and the existing page being changed before adding components. CSS is the authoritative source if it differs from this guide.

| Purpose | Current value |
| --- | --- |
| Dark ink and app header | `#1f2a36` |
| Secondary ink | `#3a4654` |
| Public cream / raised cream | `#f6f5f2` / `#fffdf9` |
| App work surface | `#ffffff` |
| Clay / deep clay | `#bf5a2e` / `#a2461f` |
| Proof Lab label in dark header | `#f0a782` |
| Teacher blue / deep blue | `#2d6ed0` / `#205ba8` |
| `for Teachers` label in dark header | `#78aef0` |
| Public rule / teacher rule | `#d8d2c8` / `#dce2e8` |
| Teacher recessed surface / blue wash | `#f8fafb` / `#eef4fb` |
| Teacher success / wash | `#28745a` / `#edf5f1` |
| Teacher error / wash | `#a34338` / `#fbefeb` |
| Teacher warning / wash | `#8b6505` / `#f8f1df` |
| Orbit answer options 1–4 | `#2d6ed0`, `#a94b42`, `#397b63`, `#74569b` |

- **Typography:** Space Grotesk for body, controls, and compact brand. Write the centered brand as `atom` plus bold `EDU`; append `Proof Lab` in the warm header color or `for Teachers` in blue. Poiret One is for large public display headings. Fraunces is an occasional italic editorial accent. Use KaTeX for typeset math.
- **Layout:** Public pages use cream, a 68px header, generous whitespace, clear section rhythm, and fine dividers. Proof Lab and Teachers use a compact 56px dark header and white workspace. Teacher/student views follow Proof Lab's scale and alignment. Use flat, bordered surfaces and split layouts where appropriate. Avoid generic lifted cards, card grids, large rounded panels, heavy shadows, decorative gradients, oversized app headings, and unrelated icon styles.
- **Interaction:** Small purposeful controls, visible focus states, responsive layout, and enough contrast. Orbit answer choices may use distinct saturated colors; correctness and reports also use green/red/yellow feedback. Do not let decorative color replace text or a clear status cue.
- **Copy:** Direct, specific, human. Say what a feature actually does and avoid generic AI marketing language or claims of comprehensive course coverage.

## Code map

- Public site: root HTML/CSS/JS, `site.js`, `site-i18n.js`, `images/`.
- Proof Lab: `proof-lab.html`, `math-lab.js`, `math-lab.css`, `math-editor.css`, `engine/`, `graph/`, checked-in `vendor/` assets.
- Teachers/students: `teachers*.html`, `students/`, `students-*.html`, `teacher*.js`, `teacher.css`, `classroom-api/`.
- Other services: `lti-api/`, `contest-api/`, `contact-api/`, `live-signal-worker/`, and the optional `live-service/`. Read the service's README before modifying it.
- The site publishes static files from the repository root. Preserve `CNAME` for `atom-edu.org`.

## Required dependency and disk-space workflow

**Install only the dependencies for the service being worked on, and remove that service's `node_modules/` when the work is finished.** This is a repository requirement because independent service installs duplicate large toolchains and can expand the checkout by more than 1 GB.

1. Choose the relevant package (`classroom-api`, `lti-api`, `contest-api`, `contact-api`, `live-signal-worker`, or `live-service`). Do not install every package as a routine setup step.
2. In that package directory, run `npm ci` only if the task actually needs its dependencies (for example, local development, type checking, tests, a build, or deployment). Use its committed lockfile. The root static server and engine's Node tests do not normally need root `node_modules/`; root `npm ci` is for refreshing MathLive/KaTeX assets.
3. Run the relevant checks and finish the work. Stop any local process using the installed package, then remove **that package's `node_modules/`** before handing off. If root dependencies were installed, remove root `node_modules/` too. Keep source, lockfiles, generated checked-in vendor assets, and unrelated user files.
4. If an install must remain temporarily for an active local process, state that explicitly and remove it after the process stops. Never treat generated `node_modules/` as a deliverable or commit them.

The deployed site and Workers do not require local `node_modules/` to stay present. Restore a package's dependencies later with `npm ci` in that package only.
