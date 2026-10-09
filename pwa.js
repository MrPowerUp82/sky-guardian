// PWA glue: registers the service worker, shows the install button, downloads the
// models for offline play and reports the state to the page (`window.__pwa`).
(() => {
  const state = window.__pwa = { label: 'indisponível', ready: false, installed: false, progress: 0 };
  const statusEl = document.querySelector('#offline-status');
  const installBtn = document.querySelector('#install-app');
  const badge = document.querySelector('#offline-badge');

  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  state.installed = standalone;

  function render(label) {
    state.label = label;
    if (statusEl) statusEl.textContent = label;
    dispatchEvent(new CustomEvent('pwa-status', { detail: state }));
  }

  const formatMB = bytes => `${(bytes / 1048576).toFixed(0)} MB`;

  function updateBadge() {
    if (badge) badge.hidden = navigator.onLine;
  }
  addEventListener('online', updateBadge);
  addEventListener('offline', updateBadge);
  updateBadge();

  // --- install button (Chrome/Edge/Android) and the iOS hint ---
  let deferredPrompt = null;
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });
  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  addEventListener('appinstalled', () => { state.installed = true; if (installBtn) installBtn.hidden = true; });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosHint = document.querySelector('#ios-install-hint');
  if (iosHint && ios && !standalone) iosHint.hidden = false;

  // --- service worker ---
  const params = new URLSearchParams(location.search);
  const allowed = 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  if (!allowed) { render('indisponível neste endereço (precisa de HTTPS)'); return; }

  if (params.has('nosw')) {
    navigator.serviceWorker.getRegistrations().then(list => Promise.all(list.map(r => r.unregister())))
      .then(() => caches.keys()).then(keys => Promise.all(keys.filter(k => k.startsWith('sky-')).map(k => caches.delete(k))))
      .then(() => render('desativado (?nosw)'));
    return;
  }

  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'offline-progress') {
      state.ready = false;
      state.progress = data.total ? Math.min(1, data.done / data.total) : 0;
      render(`baixando ${Math.round(state.progress * 100)}% (${formatMB(data.done)} de ${formatMB(data.total)})`);
    } else if (data.type === 'offline-ready') {
      state.ready = true; state.progress = 1;
      render('pronto para jogar offline ✓');
    } else if (data.type === 'offline-status') {
      state.ready = data.ready;
      if (data.ready) render('pronto para jogar offline ✓');
      else if (navigator.onLine) { render('preparando…'); navigator.serviceWorker.controller?.postMessage({ type: 'precache' }); }
      else render('modelos ainda não baixados (conecte-se uma vez)');
    } else if (data.type === 'offline-error') {
      render(navigator.onLine ? 'falha ao baixar; tentaremos de novo' : 'sem conexão para baixar os modelos');
    }
  });

  navigator.serviceWorker.register('./sw.js', { scope: './' }).then(async () => {
    const registration = await navigator.serviceWorker.ready;
    render('verificando…');
    registration.active?.postMessage({ type: 'status' });
    // After the first install the page is not controlled yet; ask the worker directly.
    addEventListener('online', () => registration.active?.postMessage({ type: 'status' }));
  }).catch(error => {
    console.warn('Service worker não registrado:', error);
    render('indisponível');
  });
})();
