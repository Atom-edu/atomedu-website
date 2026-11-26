import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

interface Env {
  DB: D1Database;
  SITE_ORIGIN: string;
  LTI_KEY_ID: string;
  LTI_PRIVATE_KEY: string;
  LTI_PUBLIC_JWK: string;
  LTI_PREVIOUS_PUBLIC_JWK?: string;
}

type Platform = {
  issuer: string; client_id: string; auth_url: string; token_url: string;
  jwks_url: string; service_origin: string; active: number;
};
type Deployment = { active: number };
type LaunchState = {
  nonce: string; issuer: string; client_id: string; target_uri: string; expires_at: number;
};
type Session = {
  issuer: string; client_id: string; deployment_id: string; subject: string;
  roles: string; context_id: string; resource_link_id: string;
  services_json: string; deep_link_json: string; expires_at: number;
  activity_id: string; display_name: string;
};
type QuestionType = 'multiple-choice' | 'multi-select' | 'true-false' | 'fill-blank' | 'free-response';
type Question = {
  id: string; type: QuestionType; prompt: string; context: string; image: string;
  options: string[]; correct: string[]; points: number;
};
type Activity = {
  id: string; issuer: string; client_id: string; deployment_id: string;
  context_id: string; creator_subject: string; title: string;
  questions_json: string; score_maximum: number; created_at: number;
};
type Submission = {
  activity_id: string; subject: string; display_name: string; resource_link_id: string;
  lineitem_url: string; answers_json: string; manual_json: string; score: number;
  score_maximum: number; submitted_at: number; graded_at: number | null;
  grade_status: string; grade_error: string;
};
type LtiClaims = {
  nonce?: string;
  [key: string]: unknown;
};

const LTI = 'https://purl.imsglobal.org/spec/lti/claim/';
const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const NRPS = 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice';
const CUSTOM = LTI + 'custom';
const COOKIE = 'atom_lti_session';
const MAX_FORM = 64_000;
const SESSION_SECONDS = 2 * 60 * 60;
const STATE_SECONDS = 10 * 60;

function fail(message: string, status = 400): Response {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function claim<T>(payload: LtiClaims, name: string): T | undefined { return payload[name] as T | undefined; }
function cookie(request: Request, name: string): string {
  return request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
function cookieHeader(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=None`;
}
function sameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
async function form(request: Request, max = MAX_FORM): Promise<URLSearchParams> {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('Expected form submission');
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > max) throw new Error('Form is too large');
  const body = await request.text();
  if (body.length > max) throw new Error('Form is too large');
  return new URLSearchParams(body);
}
function exactHttps(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid HTTPS URL');
  return url;
}
function validTarget(value: string, origin: string): boolean {
  try {
    const url = exactHttps(value);
    return url.origin === origin && /^\/lti\/(launch|resource)$/.test(url.pathname) && !url.search;
  } catch { return false; }
}
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
function framePolicy(origin: string, nonce = ''): string {
  return `default-src 'none'; form-action 'self' ${origin}; frame-ancestors ${origin}; base-uri 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; ${nonce ? `script-src 'nonce-${nonce}'` : ''}`;
}
async function privateKey(env: Env): Promise<CryptoKey> {
  if (!env.LTI_PRIVATE_KEY) throw new Error('Signing key is not configured');
  return importPKCS8(env.LTI_PRIVATE_KEY, 'RS256');
}

async function login(request: Request, env: Env): Promise<Response> {
  const params = request.method === 'POST' ? await form(request) : new URL(request.url).searchParams;
  const issuer = params.get('iss') ?? '';
  const clientId = params.get('client_id') ?? '';
  const loginHint = params.get('login_hint') ?? '';
  const target = params.get('target_link_uri') ?? '';
  if (!issuer || !clientId || !loginHint || !validTarget(target, new URL(request.url).origin)) return fail('Invalid LTI login');
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1').bind(issuer, clientId).first<Platform>();
  if (!platform) return fail('Canvas installation is not registered', 403);
  exactHttps(platform.auth_url);
  const state = token();
  const nonce = token();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO launch_states (state_hash, nonce, issuer, client_id, target_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await hash(state), nonce, issuer, clientId, target, now + STATE_SECONDS).run();
  const destination = new URL(platform.auth_url);
  destination.searchParams.set('scope', 'openid');
  destination.searchParams.set('response_type', 'id_token');
  destination.searchParams.set('response_mode', 'form_post');
  destination.searchParams.set('prompt', 'none');
  destination.searchParams.set('client_id', clientId);
  destination.searchParams.set('redirect_uri', new URL('/lti/launch', request.url).href);
  destination.searchParams.set('login_hint', loginHint);
  destination.searchParams.set('state', state);
  destination.searchParams.set('nonce', nonce);
  const hint = params.get('lti_message_hint');
  if (hint) destination.searchParams.set('lti_message_hint', hint);
  return new Response(null, {
    status: 302,
    headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  });
}

async function launch(request: Request, env: Env): Promise<Response> {
  const params = await form(request);
  const state = params.get('state') ?? '';
  const jwt = params.get('id_token') ?? '';
  if (!state || !jwt) return fail('Invalid LTI state', 403);
  const stateHash = await hash(state);
  const pending = await env.DB.prepare('DELETE FROM launch_states WHERE state_hash = ? AND expires_at > ? RETURNING nonce, issuer, client_id, target_uri, expires_at')
    .bind(stateHash, Math.floor(Date.now() / 1000)).first<LaunchState>();
  if (!pending) return fail('Expired or repeated LTI launch', 403);
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1')
    .bind(pending.issuer, pending.client_id).first<Platform>();
  if (!platform) return fail('Canvas installation is disabled', 403);
  const jwksUrl = exactHttps(platform.jwks_url);
  // The URL comes only from an administrator controlled registration.
  const jwks = createRemoteJWKSet(jwksUrl);
  let payload: LtiClaims;
  try {
    const verified = await jwtVerify(jwt, jwks, {
      issuer: platform.issuer, audience: platform.client_id, algorithms: ['RS256'],
      clockTolerance: '60s', maxTokenAge: '10m'
    });
    payload = verified.payload as LtiClaims;
  } catch { return fail('Canvas signature or claims were invalid', 403); }
  if (payload.nonce !== pending.nonce || (payload.azp && payload.azp !== platform.client_id)) return fail('Invalid LTI nonce or audience', 403);
  if (Array.isArray(payload.aud) && (payload.aud.length !== 1 || payload.aud[0] !== platform.client_id)) return fail('Unexpected LTI audience', 403);
  if (claim<string>(payload, LTI + 'version') !== '1.3.0') return fail('Unsupported LTI version', 403);
  const messageType = claim<string>(payload, LTI + 'message_type');
  if (messageType !== 'LtiResourceLinkRequest' && messageType !== 'LtiDeepLinkingRequest') return fail('Unsupported LTI message', 403);
  if (claim<string>(payload, LTI + 'target_link_uri') !== pending.target_uri) return fail('LTI target mismatch', 403);
  const deploymentId = claim<string>(payload, LTI + 'deployment_id');
  const roles = claim<string[]>(payload, LTI + 'roles');
  if (!deploymentId || !Array.isArray(roles) || !roles.every(role => typeof role === 'string') || !payload.sub) return fail('Missing required LTI claims', 403);
  const deployment = await env.DB.prepare('SELECT active FROM deployments WHERE issuer = ? AND client_id = ? AND deployment_id = ?')
    .bind(platform.issuer, platform.client_id, deploymentId).first<Deployment>();
  if (!deployment?.active) return fail('Canvas deployment is not registered', 403);
  const context = claim<{ id?: string }>(payload, LTI + 'context');
  const resource = claim<{ id?: string }>(payload, LTI + 'resource_link');
  const deepLink = claim<Record<string, unknown>>(payload, DL + 'deep_linking_settings');
  if (messageType === 'LtiResourceLinkRequest' && !resource?.id) return fail('Resource link is missing', 403);
  if (messageType === 'LtiDeepLinkingRequest' && (!roles.some(role => /#(Instructor|Administrator)$/.test(role)) || !deepLink?.deep_link_return_url)) return fail('Deep Linking requires an instructor', 403);
  let activityId = '';
  if (messageType === 'LtiResourceLinkRequest') {
    const custom = claim<Record<string, unknown>>(payload, CUSTOM);
    const requestedId = typeof custom?.atom_activity_id === 'string' ? custom.atom_activity_id : '';
    if (requestedId) {
      const activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ? AND issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ?')
        .bind(requestedId, platform.issuer, platform.client_id, deploymentId, context?.id ?? '').first<Activity>();
      if (!activity) return fail('Canvas activity is unavailable in this course', 403);
      activityId = activity.id;
      const existing = await env.DB.prepare('SELECT resource_id FROM resource_links WHERE issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ? AND resource_link_id = ?')
        .bind(platform.issuer, platform.client_id, deploymentId, context?.id ?? '', resource?.id).first<{ resource_id: string }>();
      if (existing && existing.resource_id !== activityId) return fail('Canvas link points to a different activity', 403);
      await env.DB.prepare('INSERT OR IGNORE INTO resource_links (issuer, client_id, deployment_id, context_id, resource_link_id, resource_kind, resource_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(platform.issuer, platform.client_id, deploymentId, context?.id ?? '', resource?.id, 'assessment', activityId).run();
    } else {
      const existing = await env.DB.prepare('SELECT resource_id FROM resource_links WHERE issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ? AND resource_link_id = ?')
        .bind(platform.issuer, platform.client_id, deploymentId, context?.id ?? '', resource?.id).first<{ resource_id: string }>();
      activityId = existing?.resource_id ?? '';
    }
  }
  const session = token();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (session_hash, issuer, client_id, deployment_id, subject, roles, context_id, resource_link_id, services_json, deep_link_json, expires_at, activity_id, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(await hash(session), platform.issuer, platform.client_id, deploymentId, payload.sub, JSON.stringify(roles), context?.id ?? '', resource?.id ?? '',
      JSON.stringify({ ags: claim(payload, AGS) ?? null, nrps: claim(payload, NRPS) ?? null }), JSON.stringify(messageType === 'LtiDeepLinkingRequest' ? deepLink : null), now + SESSION_SECONDS,
      activityId, typeof payload.name === 'string' ? payload.name.slice(0, 120) : '').run();
  // Canvas often opens assignment selection in an iframe where third-party
  // cookies are blocked. Render the launch response directly and carry the
  // opaque session only in the same-origin Deep Linking form.
  const rendered = messageType === 'LtiDeepLinkingRequest'
    ? await selectPage(session, env)
    : await resourcePage(session, env);
  rendered.headers.append('Set-Cookie', cookieHeader(COOKIE, session, SESSION_SECONDS));
  return rendered;
}

async function sessionFor(request: Request, env: Env): Promise<Session | null> {
  return sessionForToken(cookie(request, COOKIE), env);
}
async function sessionForToken(value: string, env: Env): Promise<Session | null> {
  if (!value) return null;
  return env.DB.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?')
    .bind(await hash(value), Math.floor(Date.now() / 1000)).first<Session>();
}
function instructor(session: Session): boolean {
  return (JSON.parse(session.roles) as string[]).some(role => /#(Instructor|Administrator)$/.test(role));
}
function page(content: string, platformOrigin: string, script = ''): Response {
  const nonce = script ? token() : '';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>atomEDU in Canvas</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{font:16px 'Space Grotesk',system-ui,-apple-system,sans-serif;background:#fff;color:#1f2a36;margin:0}header{min-height:56px;background:#1f2a36;color:#fff;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 20px}.brand{font-size:21px;font-weight:500;letter-spacing:-.035em}.brand b{font-weight:700}.brand-label{color:#78aef0;font-size:13px;font-weight:700}main{max-width:1000px;margin:0 auto;padding:clamp(22px,4vw,52px)}h1{font-size:clamp(26px,3vw,40px);line-height:1.1;letter-spacing:-.045em;margin:0 0 18px}h2{font-size:20px;letter-spacing:-.03em}p{line-height:1.55}a{color:#205ba8}button,.button{display:inline-block;padding:11px 17px;color:#fff;background:#1f2a36;border:1px solid #1f2a36;border-radius:5px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}button.secondary,.button.secondary{color:#1f2a36;background:#fff;border-color:#cfd8e1}button:hover,.button:hover{filter:brightness(1.13)}input,textarea,select{font:inherit;padding:10px;border:1px solid #cfd8e1;border-radius:4px;background:#fff;color:#1f2a36;max-width:100%}textarea{width:100%;min-height:95px}input[type=number]{width:110px}label{display:block;font-weight:650;margin:14px 0 6px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.rule{border:0;border-top:1px solid #dce2e8;margin:24px 0}.muted{color:#687887}.question{border-top:1px solid #dce2e8;padding:18px 0}.option{display:flex;align-items:center;gap:9px;margin:8px 0}.option input{margin:0}.option label{margin:0;font-weight:400}.notice{border-left:4px solid #bf5a2e;padding:8px 14px;background:#f8eee4}.error{color:#a34338}.success{color:#28745a}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #dce2e8;text-align:left;vertical-align:top}img.question-image{max-width:min(100%,500px);max-height:350px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere}
  </style><header><span class="brand">atom<b>EDU</b></span><span class="brand-label">for Teachers · Canvas</span></header><main>${content}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': framePolicy(platformOrigin, nonce), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
async function platformFor(session: Session, env: Env): Promise<Platform> {
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1')
    .bind(session.issuer, session.client_id).first<Platform>();
  if (!platform) throw new Error('Platform is unavailable');
  return platform;
}
async function resourcePage(sessionToken: string, env: Env): Promise<Response> {
  const session = await sessionForToken(sessionToken, env);
  if (!session) return fail('Launch atomEDU from Canvas first', 401);
  if (session.activity_id) return activityPage(sessionToken, session, env);
  const prefix = instructor(session) ? '/teachers' : '/proof-lab';
  const platform = await platformFor(session, env);
  return page(`<h1>atomEDU</h1><p>Canvas launch verified.</p><p><a href="${env.SITE_ORIGIN}${prefix}" target="_blank" rel="noopener">Open atomEDU</a></p>`, platform.service_origin);
}
async function resource(request: Request, env: Env): Promise<Response> {
  const token = cookie(request, COOKIE);
  return resourcePage(token, env);
}
async function selectPage(sessionToken: string, env: Env): Promise<Response> {
  const session = await sessionForToken(sessionToken, env);
  if (!session || !instructor(session) || session.deep_link_json === 'null') return fail('Instructor launch required', 403);
  const platform = await platformFor(session, env);
  const activities = await env.DB.prepare('SELECT * FROM activities WHERE issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(session.issuer, session.client_id, session.deployment_id, session.context_id).all<Activity>();
  const existing = activities.results.map(activity => `<form method="post" action="/lti/select" class="row question"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}"><input type="hidden" name="activity_id" value="${htmlEscape(activity.id)}"><strong>${htmlEscape(activity.title)}</strong><span class="muted">${activity.score_maximum} points</span><button type="submit">Add to Canvas</button></form>`).join('');
  return page(`<h1>Choose an atomEDU activity</h1>${existing ? `<h2>In this course</h2>${existing}<hr class="rule">` : ''}<h2>Create an assessment</h2><p class="muted">The assessment will belong to this Canvas course. Students will open it from the Canvas assignment.</p><form method="post" action="/lti/activity/create" id="activity-form"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}"><label for="activity-title">Assessment title</label><input id="activity-title" name="title" maxlength="120" required style="width:100%"><div id="questions"></div><input type="hidden" name="questions" id="questions-json"><div class="row"><button type="button" class="secondary" id="add-question">+ Add question</button><button type="submit">Create and add to Canvas</button></div><p id="form-error" class="error" role="alert"></p></form><hr class="rule"><h2>Other atomEDU links</h2><form method="post" action="/lti/select" class="row"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}"><button name="resource" value="proof-lab" class="secondary">Proof Lab</button><button name="resource" value="teachers" class="secondary">Teachers</button></form>`, platform.service_origin, assessmentEditorScript());
}
async function select(request: Request, env: Env): Promise<Response> {
  return selectPage(cookie(request, COOKIE), env);
}
function assessmentEditorScript(): string {
  return String.raw`
  const list=document.getElementById('questions');
  const form=document.getElementById('activity-form');
  const error=document.getElementById('form-error');
  function addQuestion(){
    const section=document.createElement('section');section.className='question';
    section.innerHTML='<div class="row"><strong class="number"></strong><button type="button" class="secondary remove">Remove</button></div><label>Question</label><textarea class="prompt" required maxlength="4000"></textarea><label>Passage or additional context (optional)</label><textarea class="context" maxlength="8000"></textarea><div class="row"><div><label>Question type</label><select class="type"><option value="multiple-choice">Multiple choice</option><option value="multi-select">Multi-select</option><option value="true-false">True / false</option><option value="fill-blank">Fill in the blank</option><option value="free-response">Free response, teacher graded</option></select></div><div><label>Points</label><input class="points" type="number" min="1" max="100" value="1" required></div></div><label>Choices, one per line (for multiple choice and multi-select)</label><textarea class="options" placeholder="Choice A&#10;Choice B"></textarea><label>Correct answer(s), one per line (leave empty for free response)</label><textarea class="correct" placeholder="Copy the correct choice here"></textarea><label>Image (optional)</label><input class="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><p class="muted">Images are resized before upload. Up to 20 questions per assessment.</p>';
    section.querySelector('.remove').onclick=()=>{section.remove();number();};
    list.append(section);number();
  }
  function number(){[...list.children].forEach((el,i)=>el.querySelector('.number').textContent='Question '+(i+1));}
  document.getElementById('add-question').onclick=()=>{if(list.children.length<20)addQuestion();else error.textContent='Maximum 20 questions.';};
  addQuestion();
  async function imageData(file){
    if(!file)return '';
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw Error('Use a PNG, JPEG, WebP, or GIF image.');
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const data=canvas.toDataURL('image/jpeg',.72);if(data.length>250000)throw Error('An image is too large after resizing. Choose a smaller image.');
    return data;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();error.textContent='';
    try{
      const questions=[];
      for(const section of list.children){
        questions.push({type:section.querySelector('.type').value,prompt:section.querySelector('.prompt').value,context:section.querySelector('.context').value,
          options:section.querySelector('.options').value.split('\n').map(x=>x.trim()).filter(Boolean),
          correct:section.querySelector('.correct').value.split('\n').map(x=>x.trim()).filter(Boolean),
          points:Number(section.querySelector('.points').value),image:await imageData(section.querySelector('.image').files[0])});
      }
      const payload=JSON.stringify(questions);if(payload.length>1000000)throw Error('Assessment images are too large together.');
      document.getElementById('questions-json').value=payload;form.submit();
    }catch(e){error.textContent=e.message||'Could not prepare assessment.';}
  });`;
}
function textField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function parseQuestions(raw: string): Question[] {
  const input = JSON.parse(raw) as Record<string, unknown>[];
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new Error('Use 1 to 20 questions');
  const permitted: QuestionType[] = ['multiple-choice', 'multi-select', 'true-false', 'fill-blank', 'free-response'];
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Question ${index + 1} is invalid`);
    const type = item.type as QuestionType;
    if (!permitted.includes(type)) throw new Error(`Question ${index + 1} has an invalid type`);
    const prompt = textField(item.prompt, 4000);
    const context = textField(item.context, 8000);
    const points = Number(item.points);
    if (typeof item.image === 'string' && item.image.length > 250000) throw new Error(`Question ${index + 1} image is too large`);
    const image = textField(item.image, 250000);
    if (!prompt || !Number.isInteger(points) || points < 1 || points > 100) throw new Error(`Question ${index + 1} needs text and 1 to 100 points`);
    if (image && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error(`Question ${index + 1} has an invalid image`);
    const options = type === 'true-false' ? ['True', 'False'] : (Array.isArray(item.options) ? item.options : []).map(v => textField(v, 300)).filter(Boolean).slice(0, 8);
    const correct = (Array.isArray(item.correct) ? item.correct : []).map(v => textField(v, 500)).filter(Boolean).slice(0, 8);
    if ((type === 'multiple-choice' || type === 'multi-select') && (options.length < 2 || new Set(options.map(v => v.toLowerCase())).size !== options.length)) throw new Error(`Question ${index + 1} needs distinct choices`);
    if (type !== 'free-response' && !correct.length) throw new Error(`Question ${index + 1} needs a correct answer`);
    if (type === 'free-response' && correct.length) throw new Error(`Question ${index + 1} must be teacher graded`);
    if ((type === 'multiple-choice' || type === 'true-false') && correct.length !== 1) throw new Error(`Question ${index + 1} needs one correct answer`);
    if (['multiple-choice','multi-select','true-false'].includes(type) && correct.some(value => !options.some(option => option.toLowerCase() === value.toLowerCase()))) throw new Error(`Question ${index + 1} has an answer outside its choices`);
    return { id: crypto.randomUUID(), type, prompt, context, image, options, correct, points };
  });
}
async function createActivity(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const data = await form(request, 1_500_000);
  const session = await sessionForToken(data.get('session') ?? '', env);
  if (!session || !instructor(session) || session.deep_link_json === 'null') return fail('Instructor launch required', 403);
  const title = textField(data.get('title'), 120);
  if (!title) return fail('Assessment title is required');
  const questions = parseQuestions(data.get('questions') ?? '');
  const id = crypto.randomUUID();
  const maximum = questions.reduce((sum, question) => sum + question.points, 0);
  await env.DB.prepare('INSERT INTO activities (id, issuer, client_id, deployment_id, context_id, creator_subject, title, questions_json, score_maximum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, session.issuer, session.client_id, session.deployment_id, session.context_id, session.subject, title, JSON.stringify(questions), maximum, Math.floor(Date.now() / 1000)).run();
  return deepLinkResponse(request, env, session, 'assessment', id);
}
async function choose(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const data = await form(request);
  const session = await sessionForToken(data.get('session') ?? cookie(request, COOKIE), env);
  if (!session || !instructor(session) || session.deep_link_json === 'null') return fail('Instructor launch required', 403);
  const activityId = data.get('activity_id') ?? '';
  const kind = activityId ? 'assessment' : data.get('resource');
  if (kind !== 'proof-lab' && kind !== 'teachers' && kind !== 'assessment') return fail('Unknown activity');
  return deepLinkResponse(request, env, session, kind, activityId);
}
async function deepLinkResponse(request: Request, env: Env, session: Session, kind: 'proof-lab' | 'teachers' | 'assessment', activityId = ''): Promise<Response> {
  const settings = JSON.parse(session.deep_link_json) as { deep_link_return_url?: string; data?: string; accept_types?: string[] };
  if (!settings.deep_link_return_url || !settings.accept_types?.includes('ltiResourceLink')) return fail('Canvas cannot accept this link');
  const returnUrl = exactHttps(settings.deep_link_return_url);
  const platform = await platformFor(session, env);
  if (returnUrl.origin !== platform.service_origin) return fail('Invalid Canvas return URL', 403);
  let activity: Activity | null = null;
  if (kind === 'assessment') {
    activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ? AND issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ?')
      .bind(activityId, session.issuer, session.client_id, session.deployment_id, session.context_id).first<Activity>();
    if (!activity) return fail('Assessment is unavailable in this course', 404);
  }
  const now = Math.floor(Date.now() / 1000);
  const item = {
    type: 'ltiResourceLink', title: activity?.title ?? (kind === 'proof-lab' ? 'atomEDU Proof Lab' : 'atomEDU for Teachers'),
    url: new URL('/lti/resource', request.url).href,
    custom: activity ? { atom_activity_id: activity.id } : { atom_resource: kind },
    ...(activity ? { lineItem: { label: activity.title, scoreMaximum: activity.score_maximum } } : {})
  };
  const signed = await new SignJWT({
    [LTI + 'message_type']: 'LtiDeepLinkingResponse',
    [LTI + 'version']: '1.3.0',
    [LTI + 'deployment_id']: session.deployment_id,
    [DL + 'content_items']: [item],
    ...(settings.data ? { [DL + 'data']: settings.data } : {})
  }).setProtectedHeader({ alg: 'RS256', kid: env.LTI_KEY_ID, typ: 'JWT' })
    .setIssuer(session.client_id).setAudience(session.issuer).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(await privateKey(env));
  return page(`<h1>Returning to Canvas</h1><p>Your activity is ready. Select the button to add it to Canvas.</p><form method="post" action="${htmlEscape(returnUrl.href)}"><input type="hidden" name="JWT" value="${htmlEscape(signed)}"><button type="submit">Finish adding activity</button></form>`, platform.service_origin);
}
function answerScore(question: Question, answer: string[]): number {
  if (question.type === 'free-response') return 0;
  const entered = [...new Set(answer.map(value => value.trim().toLocaleLowerCase()).filter(Boolean))];
  const correct = [...new Set(question.correct.map(value => value.trim().toLocaleLowerCase()))];
  if (question.type === 'fill-blank') return entered.length === 1 && correct.includes(entered[0]) ? question.points : 0;
  if (question.type !== 'multi-select') return entered.length === 1 && entered[0] === correct[0] ? question.points : 0;
  const right = entered.filter(value => correct.includes(value)).length;
  const wrong = entered.filter(value => !correct.includes(value)).length;
  return Math.round(Math.max(0, Math.min(1, (right - wrong) / correct.length)) * question.points * 100) / 100;
}
async function activityFor(session: Session, env: Env): Promise<Activity | null> {
  if (!session.activity_id) return null;
  return env.DB.prepare('SELECT * FROM activities WHERE id = ? AND issuer = ? AND client_id = ? AND deployment_id = ? AND context_id = ?')
    .bind(session.activity_id, session.issuer, session.client_id, session.deployment_id, session.context_id).first<Activity>();
}
function questionDisplay(question: Question, index: number, answers?: string[]): string {
  const chosen = new Set(answers ?? []);
  const input = question.type === 'free-response' ? `<textarea name="answer:${htmlEscape(question.id)}" required maxlength="8000"></textarea>`
    : question.type === 'fill-blank' ? `<input name="answer:${htmlEscape(question.id)}" required maxlength="500" style="width:100%">`
    : question.options.map(option => `<div class="option"><input type="${question.type === 'multi-select' ? 'checkbox' : 'radio'}" id="${htmlEscape(question.id + option)}" name="answer:${htmlEscape(question.id)}" value="${htmlEscape(option)}" ${chosen.has(option) ? 'checked' : ''}><label for="${htmlEscape(question.id + option)}">${htmlEscape(option)}</label></div>`).join('');
  return `<section class="question"><h2>${index + 1}. ${htmlEscape(question.prompt)} <small class="muted">${question.points} pt${question.points === 1 ? '' : 's'}</small></h2>${question.context ? `<p>${htmlEscape(question.context).replaceAll('\n', '<br>')}</p>` : ''}${question.image ? `<img class="question-image" src="${htmlEscape(question.image)}" alt="Question image">` : ''}${input}</section>`;
}
async function activityPage(sessionToken: string, session: Session, env: Env): Promise<Response> {
  const activity = await activityFor(session, env);
  if (!activity) return fail('Canvas activity is unavailable in this course', 404);
  const platform = await platformFor(session, env);
  const questions = JSON.parse(activity.questions_json) as Question[];
  if (instructor(session)) return instructorReport(sessionToken, session, activity, questions, env);
  const submission = await env.DB.prepare('SELECT * FROM submissions WHERE activity_id = ? AND subject = ?')
    .bind(activity.id, session.subject).first<Submission>();
  if (submission) return page(`<h1>${htmlEscape(activity.title)}</h1><p class="notice">Your work was submitted. ${submission.grade_status === 'awaiting_review' ? 'Your teacher will grade the written response.' : submission.grade_status === 'posted' ? `Score: ${submission.score} / ${activity.score_maximum}.` : 'The grade is saved and is waiting to sync with Canvas.'}</p>`, platform.service_origin);
  return page(`<h1>${htmlEscape(activity.title)}</h1><p class="muted">${questions.length} question${questions.length === 1 ? '' : 's'} · ${activity.score_maximum} points · ${htmlEscape(session.display_name || 'Canvas learner')}</p><form method="post" action="/lti/activity/submit"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}">${questions.map((question, index) => questionDisplay(question, index)).join('')}<button type="submit">Submit assessment</button></form>`, platform.service_origin);
}
async function submitActivity(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const data = await form(request);
  const sessionToken = data.get('session') ?? '';
  const session = await sessionForToken(sessionToken, env);
  if (!session || instructor(session) || !session.activity_id) return fail('Student launch required', 403);
  const activity = await activityFor(session, env);
  if (!activity) return fail('Canvas activity is unavailable', 404);
  const questions = JSON.parse(activity.questions_json) as Question[];
  const answers: Record<string, string[]> = {};
  let score = 0;
  for (const question of questions) {
    const answer = data.getAll(`answer:${question.id}`).map(value => textField(value, question.type === 'free-response' ? 8000 : 500));
    if (!answer.length || answer.every(value => !value)) return fail('Answer every question before submitting');
    if (question.type !== 'free-response' && question.type !== 'fill-blank' && answer.some(value => !question.options.includes(value))) return fail('Invalid answer');
    answers[question.id] = answer;
    score += answerScore(question, answer);
  }
  const services = JSON.parse(session.services_json) as { ags?: { lineitem?: string } };
  const manual = questions.some(question => question.type === 'free-response');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT OR IGNORE INTO submissions (activity_id, subject, display_name, resource_link_id, lineitem_url, answers_json, score, score_maximum, submitted_at, grade_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(activity.id, session.subject, session.display_name, session.resource_link_id, services.ags?.lineitem ?? '', JSON.stringify(answers), score, activity.score_maximum, now, manual ? 'awaiting_review' : 'pending').run();
  if (!manual) {
    const saved = await env.DB.prepare('SELECT * FROM submissions WHERE activity_id = ? AND subject = ?').bind(activity.id, session.subject).first<Submission>();
    if (saved?.grade_status === 'pending') await postSubmissionScore(saved, session, env);
  }
  return activityPage(sessionToken, session, env);
}
async function serviceToken(session: Session, platform: Platform, scope: string, env: Env): Promise<string> {
  const endpoint = exactHttps(platform.token_url);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: env.LTI_KEY_ID, typ: 'JWT' })
    .setIssuer(session.client_id).setSubject(session.client_id).setAudience(endpoint.href)
    .setIssuedAt(now).setExpirationTime(now + 300).setJti(crypto.randomUUID())
    .sign(await privateKey(env));
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope
  });
  const response = await fetch(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  if (!response.ok) throw new Error('Canvas rejected service authorization');
  const result = await boundedJson(response, 8192) as { access_token?: string; token_type?: string; scope?: string };
  if (!result.access_token || result.token_type?.toLowerCase() !== 'bearer' || !result.scope?.split(' ').includes(scope)) throw new Error('Invalid Canvas service token');
  return result.access_token;
}
async function boundedJson(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get('Content-Length') ?? 0);
  if (length > maxBytes) throw new Error('Canvas response is too large');
  if (!response.body) throw new Error('Canvas response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Canvas response is too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Canvas response is invalid');
  return result as Record<string, unknown>;
}
async function postSubmissionScore(submission: Submission, session: Session, env: Env): Promise<void> {
  try {
    const platform = await platformFor(session, env);
    const services = JSON.parse(session.services_json) as { ags?: { scope?: string[]; lineitem?: string } };
    const scope = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
    if (!services.ags?.scope?.includes(scope)) throw new Error('Canvas did not grant grade access');
    const lineitem = serviceUrl(submission.lineitem_url || services.ags.lineitem, platform);
    const access = await serviceToken(session, platform, scope, env);
    const response = await fetch(lineitem.href.replace(/\/$/, '') + '/scores', {
      method: 'POST', redirect: 'manual',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/vnd.ims.lis.v1.score+json' },
      body: JSON.stringify({ userId: submission.subject, scoreGiven: submission.score, scoreMaximum: submission.score_maximum,
        activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: new Date().toISOString() })
    });
    if (!response.ok) throw new Error(`Canvas rejected grade: HTTP ${response.status}`);
    await env.DB.prepare("UPDATE submissions SET grade_status = 'posted', grade_error = '', graded_at = ? WHERE activity_id = ? AND subject = ?")
      .bind(Math.floor(Date.now() / 1000), submission.activity_id, submission.subject).run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : 'Unknown grade sync error';
    console.error(JSON.stringify({ event: 'lti_grade_sync_failed', activity: submission.activity_id, error: message }));
    await env.DB.prepare("UPDATE submissions SET grade_status = 'error', grade_error = ? WHERE activity_id = ? AND subject = ?")
      .bind(message, submission.activity_id, submission.subject).run();
  }
}
async function instructorReport(sessionToken: string, session: Session, activity: Activity, questions: Question[], env: Env): Promise<Response> {
  const platform = await platformFor(session, env);
  const rows = await env.DB.prepare('SELECT * FROM submissions WHERE activity_id = ? ORDER BY submitted_at DESC LIMIT 500').bind(activity.id).all<Submission>();
  const entries = rows.results.map(submission => {
    const answers = JSON.parse(submission.answers_json) as Record<string, string[]>;
    const overrides = JSON.parse(submission.manual_json) as Record<string, number>;
    const details = questions.map((question, index) => {
      const answer = answers[question.id] ?? [];
      const auto = answerScore(question, answer);
      const value = overrides[question.id] ?? (question.type === 'free-response' && submission.grade_status === 'awaiting_review' ? '' : auto);
      return `<div class="question"><strong>${index + 1}. ${htmlEscape(question.prompt)}</strong><p>Answer: ${htmlEscape(answer.join(', ') || 'No answer')}</p><label>Points earned (maximum ${question.points})</label><input type="number" name="points:${htmlEscape(question.id)}" min="0" max="${question.points}" step="0.01" value="${value}" required></div>`;
    }).join('');
    return `<section class="question"><h2>${htmlEscape(submission.display_name || submission.subject)}</h2><p class="muted">Canvas learner ID: ${htmlEscape(submission.subject)} · ${submission.score} / ${submission.score_maximum} · ${htmlEscape(submission.grade_status)}</p>${submission.grade_error ? `<p class="error">Grade sync: ${htmlEscape(submission.grade_error)}</p>` : ''}<details><summary>Review answers and grade</summary><form method="post" action="/lti/activity/grade"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}"><input type="hidden" name="subject" value="${htmlEscape(submission.subject)}">${details}<button type="submit">Save grade to Canvas</button></form></details></section>`;
  }).join('');
  const pending = rows.results.filter(row => row.grade_status !== 'posted').length;
  let rosterHtml = '';
  try {
    const roster = await readRoster(session, env);
    const learners = (roster.members as { user_id?: string; name?: string; roles?: string[] }[])
      .filter(member => member.roles?.some(role => /#Learner$/.test(role)));
    const submitted = new Set(rows.results.map(row => row.subject));
    rosterHtml = `<hr class="rule"><h2>Course roster</h2><p class="muted">${learners.length} learner${learners.length === 1 ? '' : 's'} enrolled</p><table><thead><tr><th>Student</th><th>Assessment</th></tr></thead><tbody>${learners.slice(0, 500).map(member => `<tr><td>${htmlEscape(member.name || member.user_id || 'Canvas learner')}</td><td>${submitted.has(member.user_id || '') ? 'Submitted' : 'Not submitted'}</td></tr>`).join('')}</tbody></table>`;
  } catch {
    rosterHtml = '<p class="muted">Canvas roster is unavailable for this launch.</p>';
  }
  return page(`<h1>${htmlEscape(activity.title)}</h1><p class="muted">${rows.results.length} submission${rows.results.length === 1 ? '' : 's'} · ${pending} awaiting review or grade sync · ${activity.score_maximum} points</p>${entries || '<p>No submissions yet. Students open this assignment in Canvas.</p>'}${rosterHtml}`, platform.service_origin);
}
async function gradeActivity(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const data = await form(request);
  const sessionToken = data.get('session') ?? '';
  const session = await sessionForToken(sessionToken, env);
  if (!session || !instructor(session) || !session.activity_id) return fail('Instructor assignment launch required', 403);
  const activity = await activityFor(session, env);
  if (!activity) return fail('Assessment is unavailable', 404);
  const subject = data.get('subject') ?? '';
  const submission = await env.DB.prepare('SELECT * FROM submissions WHERE activity_id = ? AND subject = ?')
    .bind(activity.id, subject).first<Submission>();
  if (!submission) return fail('Submission is unavailable', 404);
  const questions = JSON.parse(activity.questions_json) as Question[];
  const overrides: Record<string, number> = {};
  let score = 0;
  for (const question of questions) {
    const raw = data.get(`points:${question.id}`);
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(value) || value < 0 || value > question.points || Math.abs(Math.round(value * 100) - value * 100) > 0.000001) return fail('Invalid question grade');
    overrides[question.id] = value;
    score += value;
  }
  score = Math.round(score * 100) / 100;
  await env.DB.prepare("UPDATE submissions SET manual_json = ?, score = ?, grade_status = 'pending', grade_error = '' WHERE activity_id = ? AND subject = ?")
    .bind(JSON.stringify(overrides), score, activity.id, subject).run();
  const updated = { ...submission, score, manual_json: JSON.stringify(overrides), grade_status: 'pending' };
  await postSubmissionScore(updated, session, env);
  return instructorReport(sessionToken, session, activity, questions, env);
}
function serviceUrl(raw: unknown, platform: Platform): URL {
  if (typeof raw !== 'string') throw new Error('LTI service URL is missing');
  const url = exactHttps(raw);
  if (url.origin !== platform.service_origin) throw new Error('LTI service origin mismatch');
  return url;
}
async function roster(request: Request, env: Env): Promise<Response> {
  const session = await sessionFor(request, env);
  if (!session || !instructor(session)) return fail('Instructor launch required', 403);
  return json(await readRoster(session, env));
}
async function readRoster(session: Session, env: Env): Promise<Record<string, unknown>> {
  const platform = await platformFor(session, env);
  const services = JSON.parse(session.services_json) as { nrps?: { context_memberships_url?: string } };
  const url = serviceUrl(services.nrps?.context_memberships_url, platform);
  const scope = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';
  const access = await serviceToken(session, platform, scope, env);
  const members: unknown[] = [];
  const seen = new Set<string>();
  let next: string | null = url.href;
  let first: Record<string, unknown> | null = null;
  for (let pageIndex = 0; next && pageIndex < 20; pageIndex += 1) {
    const pageUrl = serviceUrl(next, platform);
    if (seen.has(pageUrl.href)) throw new Error('Canvas roster pagination loop');
    seen.add(pageUrl.href);
    const response = await fetch(pageUrl.href, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' },
      redirect: 'manual'
    });
    if (!response.ok) throw new Error('Canvas roster request failed');
    const data = await boundedJson(response, 1_000_000);
    if (!Array.isArray(data.members)) throw new Error('Canvas roster is invalid');
    if (!first) first = data;
    members.push(...data.members);
    if (members.length > 2000) throw new Error('Canvas roster is too large');
    const part = response.headers.get('Link')?.split(',').find(value => /rel=["']?next["']?/.test(value));
    next = part?.match(/<([^>]+)>/)?.[1] ?? null;
  }
  if (next) throw new Error('Canvas roster has too many pages');
  return { ...first, members };
}
function canvasConfig(request: Request): Response {
  const origin = new URL(request.url).origin;
  return json({
    title: 'atomEDU',
    description: 'Proof Lab and classroom learning activities',
    oidc_initiation_url: origin + '/lti/login',
    target_link_uri: origin + '/lti/resource',
    redirect_uris: [origin + '/lti/launch'],
    public_jwk_url: origin + '/lti/jwks',
    scopes: [
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
      'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly'
    ],
    extensions: [{
      domain: new URL(origin).hostname,
      tool_id: 'atomedu',
      platform: 'canvas.instructure.com',
      privacy_level: 'name_only',
      settings: {
        text: 'atomEDU',
        placements: [
          { placement: 'course_navigation', message_type: 'LtiResourceLinkRequest', target_link_uri: origin + '/lti/resource', text: 'atomEDU', default: 'disabled', windowTarget: '_blank' },
          { placement: 'assignment_selection', message_type: 'LtiDeepLinkingRequest', target_link_uri: origin + '/lti/resource', text: 'Choose atomEDU activity' }
        ]
      }
    }]
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/lti/health' && request.method === 'GET') return json({ ok: true, service: 'atom-lti-api' });
      if (url.pathname === '/lti/config/canvas' && request.method === 'GET') return canvasConfig(request);
      if (url.pathname === '/lti/jwks' && request.method === 'GET') {
        const jwk = JSON.parse(env.LTI_PUBLIC_JWK) as Record<string, unknown>;
        const previous = env.LTI_PREVIOUS_PUBLIC_JWK ? JSON.parse(env.LTI_PREVIOUS_PUBLIC_JWK) as Record<string, unknown> : null;
        if (previous && (typeof previous.kid !== 'string' || previous.kid === env.LTI_KEY_ID)) return fail('Signing key configuration is invalid', 503);
        return json({ keys: [{ ...jwk, kid: env.LTI_KEY_ID, alg: 'RS256', use: 'sig' }, ...(previous ? [{ ...previous, alg: 'RS256', use: 'sig' }] : [])] });
      }
      if (url.pathname === '/lti/login' && (request.method === 'POST' || request.method === 'GET')) return login(request, env);
      if (url.pathname === '/lti/launch' && request.method === 'POST') return launch(request, env);
      if (url.pathname === '/lti/resource' && request.method === 'GET') return resource(request, env);
      if (url.pathname === '/lti/select' && request.method === 'GET') return select(request, env);
      if (url.pathname === '/lti/select' && request.method === 'POST') return choose(request, env);
      if (url.pathname === '/lti/activity/create' && request.method === 'POST') return createActivity(request, env);
      if (url.pathname === '/lti/activity/submit' && request.method === 'POST') return submitActivity(request, env);
      if (url.pathname === '/lti/activity/grade' && request.method === 'POST') return gradeActivity(request, env);
      if (url.pathname === '/lti/roster' && request.method === 'GET') return roster(request, env);
      return fail('Not found', 404);
    } catch (error) {
      console.error(JSON.stringify({ event: 'lti_request_failed', path: url.pathname, error: error instanceof Error ? error.name : 'unknown' }));
      return fail('LTI request failed', 400);
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM launch_states WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now)
    ]);
  }
};
