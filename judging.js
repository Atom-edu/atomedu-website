(() => {
  'use strict';

  function configuredApiBase() {
    const raw = window.ATOM_CONTEST_API_BASE;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const url = new URL(raw.trim(), location.origin);
      if (!/^https?:$/.test(url.protocol) || url.search || url.hash) return null;
      if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/art-contest';
      if (url.pathname.replace(/\/$/, '') !== '/api/art-contest') return null;
      return `${url.origin}/api/art-contest`;
    } catch { return null; }
  }
  const API = configuredApiBase();
  const CENTRAL = 'America/Chicago';
  const $ = (id) => document.getElementById(id);
  let token = '';
  let busy = false;
  let imageRun = 0;
  let imageController = null;
  const imageObjects = new Set();

  function centralToday() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function dateLabel(value) {
    if (!validDate(value)) return value || '-';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
  }

  function safeImageUrl(value) {
    if (!API || typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, `${API}/`);
      const approved = /^\/api\/art-contest\/judging\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname);
      return url.origin === new URL(API).origin && approved && !url.search && !url.hash && /^https?:$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function setMessage(element, text, kind = 'error') {
    element.textContent = text;
    element.dataset.kind = kind;
    element.hidden = !text;
  }

  async function request(path, options = {}, authorized = false) {
    if (!API) throw new Error('The contest API has not been configured. Judging is unavailable.');
    if (authorized && !token) throw new Error('Sign in to judge this contest.');
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        cache: 'no-store',
        credentials: 'omit',
        ...options,
        headers: { ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
      });
    } catch {
      throw new Error('The judging service is unavailable. Please try again later.');
    }
    const json = response.headers.get('content-type')?.includes('application/json');
    let body = null;
    if (json) {
      try { body = await response.json(); } catch { throw new Error('The judging server returned an unreadable response.'); }
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error(authorized ? 'Your judging session expired or is not authorized. Sign in again.' : 'The password was not accepted by the contest server.');
      error.unauthorized = authorized;
      throw error;
    }
    if (!response.ok) {
      const message = typeof body?.error?.message === 'string' && body.error.message.length < 250 ? body.error.message : `The judging server could not complete this request (${response.status}).`;
      throw new Error(message);
    }
    if (!json && response.status !== 204) throw new Error('The judging service is unavailable. Please try again later.');
    return body;
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['login-button', 'load-date', 'refresh-judging', 'sign-out']) $(id).disabled = value;
    $('submission-list').querySelectorAll('button').forEach((button) => { button.disabled = value || button.dataset.locked === 'true'; });
  }

  function revokeImages() {
    imageRun++;
    imageController?.abort();
    imageController = null;
    for (const url of imageObjects) URL.revokeObjectURL(url);
    imageObjects.clear();
  }

  async function loadPrivateImage(value, image, placeholder, run, signal) {
    const url = safeImageUrl(value);
    if (!url) { placeholder.textContent = 'Image unavailable'; return; }
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store', signal });
      if (response.status === 401 || response.status === 403) {
        if (run === imageRun) signOut('Your judging session expired. Sign in again.');
        return;
      }
      if (!response.ok || !/^image\/(png|jpeg|webp|gif)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Image unavailable');
      const blob = await response.blob();
      if (signal.aborted || run !== imageRun) return;
      const objectUrl = URL.createObjectURL(blob);
      imageObjects.add(objectUrl);
      image.onerror = () => { image.hidden = true; placeholder.hidden = false; placeholder.textContent = 'Image could not be displayed'; };
      image.src = objectUrl;
      image.hidden = false;
      placeholder.hidden = true;
    } catch {
      if (!signal.aborted && run === imageRun) placeholder.textContent = 'Image unavailable';
    }
  }

  function clearEntries(message) {
    revokeImages();
    $('summary-date').textContent = '-';
    $('summary-count').textContent = '-';
    $('summary-winner').textContent = '-';
    $('list-caption').textContent = message;
    $('submission-list').replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'judge-empty';
    empty.textContent = message;
    $('submission-list').append(empty);
  }

  function signOut(message = '') {
    token = '';
    $('judge-password').value = '';
    $('dashboard').hidden = true;
    $('login-panel').hidden = false;
    setMessage($('dashboard-message'), '');
    setMessage($('login-message'), message);
    clearEntries('Sign in to view submissions.');
  }

  function formatSubmittedAt(value) {
    if (typeof value !== 'string') return 'Time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
  }

  function renderEntries(data, requestedDate, phase) {
    if (!data || !Array.isArray(data.submissions)) throw new Error('The judging server returned an incomplete list of submissions.');
    const submissions = data.submissions;
    for (const entry of submissions) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || entry.date !== requestedDate) {
        throw new Error('The judging server returned an invalid submission.');
      }
    }
    revokeImages();
    imageController = new AbortController();
    const run = imageRun;
    $('summary-date').textContent = dateLabel(requestedDate);
    $('summary-count').textContent = String(submissions.length);
    const winner = submissions.find((entry) => String(entry.id) === String(data.winnerId));
    $('summary-winner').toggleAttribute('data-i18n-ignore', typeof data.winnerName === 'string' && !!data.winnerName);
    $('summary-winner').textContent = typeof data.winnerName === 'string' && data.winnerName
      ? data.winnerName : winner ? winner.name : data.winnerId === null ? 'Not selected' : 'Status not provided';
    $('list-caption').textContent = `${submissions.length} ${submissions.length === 1 ? 'entry' : 'entries'} for ${dateLabel(requestedDate)}`;
    const list = $('submission-list');
    list.replaceChildren();
    if (!submissions.length) {
      const empty = document.createElement('p');
      empty.className = 'judge-empty';
      empty.textContent = data.winnerName ? 'No submissions remain for this date. The selected winner is shown above.' : 'No submissions for this date.';
      list.append(empty);
      return;
    }
    for (const entry of submissions) {
      const card = document.createElement('article');
      card.className = 'judge-card';
      const isWinner = String(entry.id) === String(data.winnerId);
      if (isWinner) card.classList.add('is-winner');
      const image = document.createElement('img');
      image.className = 'judge-image';
      image.alt = `Submission by ${entry.name}`;
      image.hidden = true;
      const placeholder = document.createElement('div');
      placeholder.className = 'judge-image-placeholder';
      placeholder.textContent = 'Loading private image…';
      card.append(image, placeholder);
      loadPrivateImage(entry.imageUrl, image, placeholder, run, imageController.signal);
      const body = document.createElement('div');
      body.className = 'judge-card-body';
      const top = document.createElement('div');
      top.className = 'judge-card-top';
      const title = document.createElement('h3');
      title.setAttribute('data-i18n-ignore', '');
      title.textContent = entry.name;
      top.append(title);
      if (isWinner) {
        const badge = document.createElement('span');
        badge.textContent = 'WINNER ✳';
        top.append(badge);
      }
      const meta = document.createElement('p');
      meta.textContent = `Submitted ${formatSubmittedAt(entry.submittedAt)}`;
      const actions = document.createElement('div');
      actions.className = 'judge-card-actions';
      if (!isWinner) {
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'select-winner';
        select.textContent = 'Select winner';
        if (!['judging', 'results_pending'].includes(phase) || data.winnerId) { select.disabled = true; select.dataset.locked = 'true'; select.title = data.winnerId ? 'A winner has already been selected.' : 'Winner selection opens after entries close.'; }
        select.addEventListener('click', () => selectWinner(entry, requestedDate));
        actions.append(select);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-entry';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete submission by ${entry.name}`);
      remove.addEventListener('click', () => deleteEntry(entry, requestedDate));
      actions.append(remove);
      body.append(top, meta, actions);
      card.append(body);
      list.append(card);
    }
  }

  async function loadEntries(syncDate = false) {
    if (!token || busy) return false;
    setBusy(true);
    setMessage($('dashboard-message'), 'Loading entries from the contest server…', 'info');
    clearEntries('Loading submissions…');
    try {
      const state = await request('/state');
      if (!validDate(state?.contestDate)) throw new Error('The contest server did not provide a valid live date.');
      if (syncDate || !$('contest-date').value) $('contest-date').value = state.contestDate;
      const date = $('contest-date').value;
      if (!validDate(date)) throw new Error('Choose a valid contest date.');
      if (date !== state.contestDate) {
        setMessage($('dashboard-message'), `The judging API only provides the live contest date, ${dateLabel(state.contestDate)}. Choose that date or select Sync live date.`, 'info');
        clearEntries('This date is not available from the judging API.');
        return false;
      }
      const data = await request('/judging/submissions', {}, true);
      renderEntries(data, date, state.phase);
      $('login-panel').hidden = true;
      $('dashboard').hidden = false;
      setMessage($('dashboard-message'), '');
      return true;
    } catch (error) {
      if (error.unauthorized) signOut(error.message);
      else {
        setMessage($('dashboard').hidden ? $('login-message') : $('dashboard-message'), error.message || 'The judging service is unavailable.');
        clearEntries('Submissions are unavailable.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeEntry(path, options, success, validate) {
    if (busy || !token) return;
    setBusy(true);
    setMessage($('dashboard-message'), 'Saving your change on the contest server…', 'info');
    try {
      const result = await request(path, options, true);
      if (validate && !validate(result)) throw new Error('The contest server did not confirm the change. Please refresh before trying again.');
      setBusy(false);
      const refreshed = await loadEntries(true);
      if (refreshed) setMessage($('dashboard-message'), success, 'success');
      else if (token) setMessage($('dashboard-message'), `${success} The list could not be refreshed; select Sync live date.`, 'info');
    } catch (error) {
      if (error.unauthorized) signOut(error.message);
      else setMessage($('dashboard-message'), error.message || 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function shortDate(date) {
    const [year, month, day] = date.split('-');
    return `${month}/${day}/${year}`;
  }

  function selectWinner(entry, date) {
    if (!window.confirm(`Select ${entry.name} as the winner for ${shortDate(date)}? Confirming one winner permanently deletes ALL other submissions for that contest date. This cannot be undone, and an existing winner cannot be replaced.`)) return;
    changeEntry('/judging/winners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id, date }) }, 'The winner was saved by the contest server.', (result) => result?.winner?.id === entry.id);
  }

  function deleteEntry(entry, date) {
    if (!window.confirm(`Permanently delete ${entry.name}'s submission for ${shortDate(date)}? This cannot be undone.`)) return;
    changeEntry(`/judging/submissions/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }, 'The submission was deleted by the contest server.', (result) => result?.deleted === true);
  }

  $('contest-date').value = centralToday();
  clearEntries('Sign in to view submissions.');
  if (!API) {
    $('login-button').disabled = true;
    setMessage($('login-message'), 'The contest API has not been configured. Judging is unavailable.');
  }
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !API) return;
    const apiUrl = new URL(API);
    if (apiUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(apiUrl.hostname)) {
      setMessage($('login-message'), 'Judging requires an HTTPS API connection.');
      return;
    }
    const enteredPassword = $('judge-password').value;
    $('judge-password').value = '';
    setBusy(true);
    setMessage($('login-message'), 'Checking password with the contest server…', 'info');
    try {
      const result = await request('/judging/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: enteredPassword }) });
      if (typeof result?.token !== 'string' || !result.token) throw new Error('The judging server did not issue a valid session.');
      token = result.token;
      $('login-panel').hidden = true;
      $('dashboard').hidden = false;
      setMessage($('login-message'), '');
      setBusy(false);
      await loadEntries(true);
    } catch (error) {
      token = '';
      setMessage($('login-message'), error.message || 'Judging sign-in failed.');
    } finally {
      setBusy(false);
    }
  });
  $('load-date').addEventListener('click', () => loadEntries(false));
  $('refresh-judging').addEventListener('click', () => loadEntries(true));
  $('sign-out').addEventListener('click', () => signOut('Signed out of this page.'));
  window.addEventListener('pagehide', () => { token = ''; revokeImages(); });
})();
