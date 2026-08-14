import { QUICK_CHAT_OPTIONS, normalizeQuickChatOptions } from '../shared/quick-chat.js';

const CHAT_MAX_CHARS = 160;

export class ChatPanel {
  constructor(root, options = {}) {
    this.root = root;
    this.mobile = Boolean(options.mobile);
    this.onQuickChat = typeof options.onQuickChat === 'function' ? options.onQuickChat : null;
    this.onTextChat = typeof options.onTextChat === 'function' ? options.onTextChat : null;
    this.onOpenChange = typeof options.onOpenChange === 'function' ? options.onOpenChange : null;
    this.quickChats = normalizeQuickChatOptions(options.quickChats || QUICK_CHAT_OPTIONS);
    this.quickCooldownUntil = 0;
    this.textCooldownUntil = 0;
    this.cooldownTimer = null;
    this.activeMode = 'quick';

    this.el = document.createElement('div');
    this.el.className = `chat-panel${this.mobile ? ' chat-panel--mobile' : ''}`;
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="chat-panel__backdrop" data-chat-close></div>
      <section class="chat-panel__card" role="dialog" aria-modal="true" aria-label="Spielchat">
        <header class="chat-panel__header">
          <div>
            <span class="chat-panel__eyebrow">TEAM & MATCH</span>
            <strong>CHAT</strong>
          </div>
          <button type="button" class="chat-panel__close" data-chat-close aria-label="Chat schließen">×</button>
        </header>
        <div class="chat-panel__tabs" role="tablist">
          <button type="button" data-chat-tab="quick" role="tab" aria-selected="true">QUICK CHAT</button>
          <button type="button" data-chat-tab="text" role="tab" aria-selected="false">TEXT CHAT</button>
        </div>
        <div class="chat-panel__content">
          <div class="chat-panel__quick" data-chat-view="quick">
            <div class="chat-panel__quick-grid" data-quick-grid></div>
            <div class="chat-panel__status" data-quick-status aria-live="polite"></div>
          </div>
          <div class="chat-panel__text" data-chat-view="text" hidden>
            <form data-chat-form autocomplete="off">
              <label for="match-chat-input">Nachricht an alle</label>
              <textarea id="match-chat-input" data-chat-input maxlength="${CHAT_MAX_CHARS}" rows="3" placeholder="Nachricht schreiben …"></textarea>
              <div class="chat-panel__text-actions">
                <span data-chat-count>0/${CHAT_MAX_CHARS}</span>
                <button type="submit" data-chat-send>SENDEN</button>
              </div>
            </form>
            <div class="chat-panel__status" data-text-status aria-live="polite"></div>
            <p class="chat-panel__hint">Desktop: <kbd>T</kbd> öffnet Text Chat · <kbd>Y</kbd> öffnet Quick Chat</p>
          </div>
        </div>
      </section>`;
    root.appendChild(this.el);

    this.quickGrid = this.el.querySelector('[data-quick-grid]');
    this.quickStatus = this.el.querySelector('[data-quick-status]');
    this.textStatus = this.el.querySelector('[data-text-status]');
    this.input = this.el.querySelector('[data-chat-input]');
    this.counter = this.el.querySelector('[data-chat-count]');
    this.sendButton = this.el.querySelector('[data-chat-send]');
    this.form = this.el.querySelector('[data-chat-form]');
    this.tabs = [...this.el.querySelectorAll('[data-chat-tab]')];
    this.views = [...this.el.querySelectorAll('[data-chat-view]')];

    this.renderQuickChats();
    this.bindEvents();
  }

  bindEvents() {
    this.el.querySelectorAll('[data-chat-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    this.tabs.forEach((tab) => tab.addEventListener('click', () => this.setMode(tab.dataset.chatTab)));
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitText();
    });
    this.input?.addEventListener('input', () => this.updateCounter());
    this.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.submitText();
      }
      event.stopPropagation();
    });
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
      event.stopPropagation();
    });
    this.el.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  renderQuickChats() {
    if (!this.quickGrid) return;
    this.quickGrid.replaceChildren();
    for (let index = 0; index < this.quickChats.length; index++) {
      const option = this.quickChats[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-panel__quick-button';
      button.dataset.quickChatId = option.id;
      const shortcut = index < 4 ? `<kbd>${index + 1}</kbd>` : '';
      button.innerHTML = `${shortcut}<span></span>`;
      button.querySelector('span').textContent = option.text;
      button.addEventListener('click', () => {
        if (this.quickCooldownRemaining() > 0) {
          this.updateCooldownState();
          return;
        }
        if (this.onQuickChat?.(option.id) !== false) {
          if (this.mobile) this.close();
        }
      });
      this.quickGrid.appendChild(button);
    }
    this.updateCooldownState();
  }

  setQuickChats(options) {
    this.quickChats = normalizeQuickChatOptions(options);
    this.renderQuickChats();
  }

  setMode(mode) {
    this.activeMode = mode === 'text' ? 'text' : 'quick';
    for (const tab of this.tabs) {
      const active = tab.dataset.chatTab === this.activeMode;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.classList.toggle('is-active', active);
    }
    for (const view of this.views) view.hidden = view.dataset.chatView !== this.activeMode;
    if (this.activeMode === 'text' && !this.el.hidden) {
      setTimeout(() => this.input?.focus({ preventScroll: true }), 0);
    }
  }

  open(mode = 'quick') {
    if (!this.el.hidden) {
      this.setMode(mode);
      return;
    }
    this.el.hidden = false;
    this.root.classList.add('chat-open');
    this.setMode(mode);
    this.updateCooldownState();
    this.onOpenChange?.(true);
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.root.classList.remove('chat-open');
    this.input?.blur();
    this.onOpenChange?.(false);
  }

  toggle(mode = 'quick') {
    if (this.el.hidden) this.open(mode);
    else if (this.activeMode !== mode) this.setMode(mode);
    else this.close();
  }

  isOpen() {
    return !this.el.hidden;
  }

  updateCounter() {
    if (!this.counter || !this.input) return;
    const count = Array.from(this.input.value).length;
    this.counter.textContent = `${Math.min(count, CHAT_MAX_CHARS)}/${CHAT_MAX_CHARS}`;
  }

  submitText() {
    if (!this.input) return false;
    const normalized = String(this.input.value || '').trim().replace(/\s+/g, ' ');
    const text = Array.from(normalized).slice(0, CHAT_MAX_CHARS).join('');
    if (!text) return false;
    if (this.textCooldownRemaining() > 0) {
      this.updateCooldownState();
      return false;
    }
    const sent = this.onTextChat?.(text) !== false;
    if (sent) {
      this.input.value = '';
      this.updateCounter();
      this.close();
    }
    return sent;
  }

  quickCooldownRemaining() {
    return Math.max(0, this.quickCooldownUntil - performance.now());
  }

  textCooldownRemaining() {
    return Math.max(0, this.textCooldownUntil - performance.now());
  }

  setQuickChatCooldown(milliseconds = 0) {
    const duration = Math.max(0, Number(milliseconds) || 0);
    this.quickCooldownUntil = duration > 0 ? performance.now() + duration : 0;
    this.startCooldownTicker();
  }

  setTextChatCooldown(milliseconds = 0) {
    const duration = Math.max(0, Number(milliseconds) || 0);
    this.textCooldownUntil = duration > 0 ? performance.now() + duration : 0;
    this.startCooldownTicker();
  }

  startCooldownTicker() {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.updateCooldownState();
    if (this.quickCooldownRemaining() <= 0 && this.textCooldownRemaining() <= 0) return;
    this.cooldownTimer = setInterval(() => {
      this.updateCooldownState();
      if (this.quickCooldownRemaining() <= 0 && this.textCooldownRemaining() <= 0) {
        clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
      }
    }, 100);
  }

  updateCooldownState() {
    const quickRemaining = this.quickCooldownRemaining();
    const textRemaining = this.textCooldownRemaining();
    if (this.quickStatus) this.quickStatus.textContent = quickRemaining > 0 ? `Quick Chat Cooldown · ${(quickRemaining / 1000).toFixed(1)} s` : '';
    if (this.textStatus) this.textStatus.textContent = textRemaining > 0 ? `Text Chat Cooldown · ${(textRemaining / 1000).toFixed(1)} s` : '';
    this.quickGrid?.querySelectorAll('button').forEach((button) => { button.disabled = quickRemaining > 0; });
    if (this.sendButton) this.sendButton.disabled = textRemaining > 0;
  }

  destroy() {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.onOpenChange?.(false);
    this.el?.remove();
    this.root?.classList.remove('chat-open');
  }
}
