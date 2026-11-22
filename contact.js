(() => {
  'use strict';

  const form = document.getElementById('contact-form');
  if (!form) return;

  const title = document.getElementById('contact-title');
  const body = document.getElementById('contact-body');
  const count = document.getElementById('contact-count');
  const status = document.getElementById('contact-status');
  const submit = document.getElementById('contact-submit');

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

  function setStatus(message, kind = 'error') {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  body.addEventListener('input', () => {
    count.textContent = `${body.value.length} / 5000`;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!API) {
      setStatus('The contact service is not configured yet. Please try again later.');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Submitting...';
    setStatus('');
    try {
      const response = await fetch(`${API}/messages`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.value, body: body.value }),
      });
      const data = response.headers.get('content-type')?.includes('application/json')
        ? await response.json() : null;
      if (!response.ok) {
        if (response.status === 429) throw new Error('Too many messages were submitted from this network. Please try again later.');
        throw new Error(typeof data?.message === 'string' ? data.message : 'Your message could not be submitted. Please try again.');
      }
      form.reset();
      count.textContent = '0 / 5000';
      setStatus('Your message was submitted. Thank you.', 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Your message could not be submitted. Please try again.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Submit message';
    }
  });
})();
