/**
 * Sifia Native Storage Bridge
 * Mantem compatibilidade com as chaves atuais e cria uma copia persistente
 * no armazenamento nativo (Preferences: UserDefaults no iOS / SharedPreferences no Android).
 * A migracao nunca apaga o localStorage existente.
 */
(function () {
  const KEYS = [
    'controle_gastos_transacoes',
    'controle_gastos_recorrencias'
  ];
  const PREFIX = 'sifia.native.v1.';
  const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());

  async function preferences() {
    if (!isNative()) return null;
    try {
      const mod = await import('@capacitor/preferences');
      return mod.Preferences;
    } catch (error) {
      console.error('[Sifia Native] Preferences indisponivel', error);
      return null;
    }
  }

  function validJson(value) {
    if (!value) return false;
    try { JSON.parse(value); return true; } catch (_) { return false; }
  }

  async function hydrate() {
    const prefs = await preferences();
    if (!prefs) return;
    for (const key of KEYS) {
      const webValue = localStorage.getItem(key);
      const nativeKey = PREFIX + key;
      const nativeValue = (await prefs.get({ key: nativeKey })).value;

      // Primeira execucao nativa: importa os dados existentes sem remove-los.
      if (validJson(webValue) && !nativeValue) {
        await prefs.set({ key: nativeKey, value: webValue });
        continue;
      }

      // Se o WebView perdeu o dado, recupera da copia nativa.
      if (!validJson(webValue) && validJson(nativeValue)) {
        localStorage.setItem(key, nativeValue);
      }
    }
  }

  async function persist(key, value) {
    if (!KEYS.includes(key) || !validJson(value)) return;
    const prefs = await preferences();
    if (prefs) await prefs.set({ key: PREFIX + key, value });
  }

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && KEYS.includes(key)) {
      persist(key, String(value)).catch(err => console.error('[Sifia Native] Falha ao persistir', err));
    }
  };

  window.SifiaNativeStorage = { hydrate, persist, isNative };
  window.__sifiaNativeStorageReady = hydrate();
})();
