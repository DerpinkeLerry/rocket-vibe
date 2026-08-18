function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function authRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body
      ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
      : options.headers
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status fallback below remains useful for proxy/server failures.
  }
  if (!response.ok) throw new Error(payload?.error || `Anmeldung fehlgeschlagen (${response.status})`);
  return payload;
}

export function requestAuthentication(root) {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'account-screen';
    overlay.innerHTML = `
      <section class="account-card" aria-labelledby="account-title">
        <div class="join-card__eyebrow">ROCKET VIBE ACCOUNT</div>
        <h1 id="account-title">Willkommen</h1>
        <p>Melde dich an oder erstelle einen Account, bevor du eine Lobby betrittst.</p>
        <div class="account-session" data-account-session hidden></div>
        <div class="account-tabs" role="tablist" aria-label="Account auswählen">
          <button type="button" role="tab" data-account-tab="login" aria-selected="true">LOGIN</button>
          <button type="button" role="tab" data-account-tab="register" aria-selected="false">REGISTRIEREN</button>
        </div>
        <form class="account-form" data-account-form novalidate>
          <label>Benutzername
            <input name="username" type="text" minlength="2" maxlength="16" pattern="[A-Za-z0-9_.-]+" autocomplete="username" autocapitalize="none" spellcheck="false" required />
          </label>
          <label>Passwort
            <input name="password" type="password" minlength="8" maxlength="128" autocomplete="current-password" required />
          </label>
          <label data-password-confirm hidden>Passwort wiederholen
            <input name="passwordConfirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" />
          </label>
          <small class="account-form__hint">Benutzername: 2–16 Zeichen, Buchstaben, Zahlen, Punkt, Minus oder Unterstrich. Passwörter werden niemals im Klartext gespeichert.</small>
          <div class="account-form__error" data-account-error aria-live="polite"></div>
          <button class="account-form__submit" type="submit">ANMELDEN</button>
        </form>
      </section>`;
    root.appendChild(overlay);

    const form = overlay.querySelector('[data-account-form]');
    const error = overlay.querySelector('[data-account-error]');
    const submit = overlay.querySelector('.account-form__submit');
    const confirmLabel = overlay.querySelector('[data-password-confirm]');
    const session = overlay.querySelector('[data-account-session]');
    const tabs = [...overlay.querySelectorAll('[data-account-tab]')];
    let mode = 'login';
    let currentUser = null;

    const finish = (user) => {
      overlay.remove();
      resolve({ username: String(user?.username || '').slice(0, 16) });
    };

    const setMode = (nextMode) => {
      mode = nextMode === 'register' ? 'register' : 'login';
      for (const tab of tabs) {
        const selected = tab.dataset.accountTab === mode;
        tab.classList.toggle('is-selected', selected);
        tab.setAttribute('aria-selected', String(selected));
      }
      confirmLabel.hidden = mode !== 'register';
      form.elements.passwordConfirm.required = mode === 'register';
      form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      submit.textContent = mode === 'register' ? 'ACCOUNT ERSTELLEN' : 'ANMELDEN';
      error.textContent = '';
    };

    for (const tab of tabs) tab.addEventListener('click', () => setMode(tab.dataset.accountTab));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const username = form.elements.username.value.trim();
      const password = form.elements.password.value;
      if (!form.reportValidity()) return;
      if (mode === 'register' && password !== form.elements.passwordConfirm.value) {
        error.textContent = 'Die Passwörter stimmen nicht überein.';
        form.elements.passwordConfirm.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = mode === 'register' ? 'ACCOUNT WIRD ERSTELLT …' : 'ANMELDUNG …';
      try {
        const payload = await authRequest(`/api/auth/${mode}`, {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        finish(payload.user);
      } catch (requestError) {
        submit.disabled = false;
        setMode(mode);
        error.textContent = requestError.message;
      }
    });

    try {
      const payload = await authRequest('/api/auth/session');
      currentUser = payload?.user;
    } catch {
      currentUser = null;
    }

    if (currentUser?.username) {
      session.hidden = false;
      session.innerHTML = `
        <span>Aktive Anmeldung</span>
        <strong>${escapeHtml(currentUser.username)}</strong>
        <div>
          <button type="button" data-account-continue>WEITER</button>
          <button type="button" data-account-logout>ABMELDEN</button>
        </div>`;
      session.querySelector('[data-account-continue]').addEventListener('click', () => finish(currentUser));
      session.querySelector('[data-account-logout]').addEventListener('click', async () => {
        try {
          await authRequest('/api/auth/logout', { method: 'POST' });
        } catch {
          // The local screen can still forget the expired/broken session.
        }
        session.hidden = true;
        currentUser = null;
        form.elements.username.focus();
      });
    } else {
      form.elements.username.focus?.({ preventScroll: true });
    }
    setMode('login');
  });
}
