(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem('atom-contact-session') || '';
  let messages = [];
  let busy = false;

  function configuredApiBase() {
    const raw = window.ATOM_CONTACT_API_BASE;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const url = new URL(raw.trim(), location.origin);
      if (!/^https?:$/.test(url.protocol) || url.search || url.hash) return null;
      if (url.pathname.replace(/\/$/, '') !== '/api/contact') return null;
      return `${url.origin}/api/contact`;
    } catch { return null; }
  }

  const API = configuredApiBase();

  function setStatus(element, message, kind = 'error') {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['contact-login-button', 'contact-refresh', 'contact-sign-out']) $(id).disabled = value;
    document.querySelectorAll('.contact-acknowledge input').forEach((input) => { input.disabled = value; });
  }

  async function api(path, options = {}, authorized = false) {
    if (!API) throw new Error('The contact service is not configured.');
    if (authorized && !token) throw Object.assign(new Error('Sign in to open the inbox.'), { unauthorized: true });
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        cache: 'no-store',
        credentials: 'omit',
        ...options,
        headers: {
          ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('The contact service is unavailable. Please try again.');
    }
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null) : null;
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(authorized ? 'Your session expired. Sign in again.' : 'The password was not accepted.'), { unauthorized: authorized });
    }
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : `The contact service returned ${response.status}.`);
    return data;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Submission time unavailable';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Chicago', timeZoneName: 'short',
    }).format(date);
  }

  function updateCounts() {
    const acknowledged = messages.filter((message) => message.acknowledged).length;
    $('contact-total').textContent = String(messages.length);
    $('contact-open').textContent = String(messages.length - acknowledged);
    $('contact-acknowledged').textContent = String(acknowledged);
  }

  function renderMessages() {
    const list = $('contact-message-list');
    list.replaceChildren();
    updateCounts();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'contact-empty';
      empty.textContent = 'No messages have been submitted yet.';
      list.append(empty);
      return;
    }
    for (const message of messages) {
      const article = document.createElement('article');
      article.className = `contact-message${message.acknowledged ? ' is-acknowledged' : ''}`;

      const copy = document.createElement('div');
      copy.className = 'contact-message-copy';
      const heading = document.createElement('h2');
      heading.textContent = message.title;
      const time = document.createElement('time');
      time.dateTime = message.createdAt;
      time.textContent = `Submitted ${formatDate(message.createdAt)}`;
      const body = document.createElement('p');
      body.className = 'contact-message-body';
      body.textContent = message.body;
      copy.append(heading, time, body);

      const control = document.createElement('div');
      control.className = 'contact-message-control';
      const label = document.createElement('label');
      label.className = 'contact-acknowledge';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = message.acknowledged;
      checkbox.disabled = busy;
      const labelText = document.createElement('span');
      labelText.textContent = 'Acknowledged';
      label.append(checkbox, labelText);
      const state = document.createElement('small');
      state.textContent = message.acknowledged ? 'Marked as done' : 'Needs review';
      checkbox.addEventListener('change', async () => {
        const previous = message.acknowledged;
        checkbox.disabled = true;
        setStatus($('contact-dashboard-status'), '');
        try {
          const result = await api(`/messages/${encodeURIComponent(message.id)}/acknowledged`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged: checkbox.checked }),
          }, true);
          message.acknowledged = result.acknowledged;
          message.acknowledgedAt = result.acknowledgedAt;
          article.classList.toggle('is-acknowledged', message.acknowledged);
          state.textContent = message.acknowledged ? 'Marked as done' : 'Needs review';
          updateCounts();
        } catch (error) {
          checkbox.checked = previous;
          if (error.unauthorized) return signOut(error.message);
          setStatus($('contact-dashboard-status'), error.message);
        } finally {
          checkbox.disabled = busy;
        }
      });
      control.append(label, state);
      article.append(copy, control);
      list.append(article);
    }
  }

  async function loadMessages() {
    if (busy) return;
    setBusy(true);
    setStatus($('contact-dashboard-status'), '');
    try {
      const result = await api('/messages', {}, true);
      if (!result || !Array.isArray(result.messages)) throw new Error('The contact service returned an incomplete inbox.');
      messages = result.messages;
      renderMessages();
    } catch (error) {
      if (error.unauthorized) return signOut(error.message);
      setStatus($('contact-dashboard-status'), error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openDashboard() {
    $('contact-login').hidden = true;
    $('contact-dashboard').hidden = false;
    await loadMessages();
  }

  function signOut(message = '') {
    token = '';
    messages = [];
    sessionStorage.removeItem('atom-contact-session');
    $('contact-password').value = '';
    $('contact-dashboard').hidden = true;
    $('contact-login').hidden = false;
    setStatus($('contact-login-status'), message);
    setStatus($('contact-dashboard-status'), '');
    $('contact-message-list').replaceChildren();
  }

  $('contact-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus($('contact-login-status'), '');
    try {
      const result = await api('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('contact-password').value }),
      });
      if (!result || typeof result.token !== 'string') throw new Error('The contact service returned an invalid session.');
      token = result.token;
      sessionStorage.setItem('atom-contact-session', token);
      $('contact-password').value = '';
      await openDashboard();
    } catch (error) {
      setStatus($('contact-login-status'), error.message);
    } finally {
      setBusy(false);
    }
  });

  $('contact-refresh').addEventListener('click', loadMessages);
  $('contact-sign-out').addEventListener('click', () => signOut());
  if (token) void openDashboard();
})();
