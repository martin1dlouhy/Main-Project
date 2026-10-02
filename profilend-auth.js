/**
 * ProfilendAuth — jednotné přihlášení pro Investment Tools
 *
 * Jeden 6místný PIN → deviceToken (~90 dní, localStorage) → z něj si appky
 * berou automaticky: Google access token (přes Railway refresh-token flow)
 * a sessionToken pro AI endpointy (X-Database-Token).
 *
 * Public API (všechna volání jsou bezpečná i bez serveru — vrací null):
 *   await ProfilendAuth.ensureDevice()     → deviceToken | null (uživatel dal
 *                                            Zrušit); když chybí, ukáže vlastní
 *                                            6místný PIN overlay a čeká
 *   await ProfilendAuth.getGoogleToken()   → access token | null (null = server
 *                                            nemá nastaveno → použij GIS fallback)
 *   await ProfilendAuth.getSessionToken()  → sessionToken pro AI endpointy | null
 *   ProfilendAuth.isDeviceRegistered()     → bool (lokální kontrola expirace)
 *   ProfilendAuth.reset()                  → odhlásí toto zařízení (smaže tokeny)
 *
 * Sdílené klíče (jedno přihlášení pro celý web — stejná doména):
 *   localStorage 'profilend-device-token'  — deviceToken (formát 'exp.sig')
 *   localStorage 'gdrive-shared-token' / 'gdrive-shared-token-expiry' — Google token
 *   sessionStorage 'profilend-session-token' — sessionToken (per tab)
 *
 * Načítat PŘED google-drive-sync.js a před inline skripty appek.
 */
(function () {
    'use strict';

    var RAILWAY = 'https://main-project-production-b048.up.railway.app';
    var DEVICE_KEY = 'profilend-device-token';
    var GTOKEN_KEY = 'gdrive-shared-token';
    var GTOKEN_EXP_KEY = 'gdrive-shared-token-expiry';
    var SESSION_KEY = 'profilend-session-token';

    var pendingDevice = null;   // Promise — jediný běžící PIN flow
    var pendingGoogle = null;   // Promise — jediný běžící token fetch

    function getStoredDevice() {
        try {
            var t = localStorage.getItem(DEVICE_KEY);
            if (!t) return null;
            var exp = parseInt(t.split('.')[0], 10);
            if (!exp || exp <= Date.now()) { localStorage.removeItem(DEVICE_KEY); return null; }
            return t;
        } catch (e) { return null; }
    }

    function clearDevice() {
        try {
            localStorage.removeItem(DEVICE_KEY);
            localStorage.removeItem(GTOKEN_KEY);
            localStorage.removeItem(GTOKEN_EXP_KEY);
            sessionStorage.removeItem(SESSION_KEY);
        } catch (e) { /* no-op */ }
    }

    // ──────────────────────────────────────────────────────────
    //  PIN overlay (editorial amber, 6 polí) — vkládá se on-demand
    // ──────────────────────────────────────────────────────────
    function injectOverlay(onSubmit, onCancel) {
        if (document.getElementById('pf-auth-overlay')) return;
        var style = document.createElement('style');
        style.id = 'pf-auth-style';
        style.textContent =
            '#pf-auth-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;' +
            'background:var(--bg-deep,#070910);font-family:var(--font-body,Inter,sans-serif)}' +
            '#pf-auth-box{background:var(--bg-raised,#11161f);border:1px solid var(--line-faint,rgba(232,223,208,0.06));' +
            'border-radius:12px;padding:40px 44px;max-width:400px;width:92%;text-align:center}' +
            '#pf-auth-logo{width:56px;height:56px;margin:0 auto 18px;border-radius:14px;display:flex;align-items:center;justify-content:center;' +
            'background:linear-gradient(145deg,var(--amber-warm,#f4c98a),var(--amber,#e8b97c));box-shadow:0 0 32px var(--amber-glow,rgba(232,185,124,0.18))}' +
            '#pf-auth-logo svg{width:26px;height:26px;stroke:#1a1207;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
            '#pf-auth-box h2{color:var(--text,#f1ece1);font-family:var(--font-display,Fraunces,serif);font-weight:300;font-size:24px;margin:0 0 6px}' +
            '#pf-auth-box p{color:var(--text-mute,rgba(241,236,225,0.46));font-size:13px;margin:0 0 22px;line-height:1.5}' +
            '#pf-auth-digits{display:flex;gap:8px;justify-content:center;margin-bottom:14px}' +
            '.pf-digit{width:44px;height:52px;text-align:center;font-size:20px;color:var(--text,#f1ece1);' +
            'background:var(--bg-input,rgba(232,223,208,0.04));border:1px solid var(--line,rgba(232,223,208,0.10));border-radius:6px;outline:none}' +
            '.pf-digit:focus{border-color:var(--amber,#e8b97c);box-shadow:0 0 0 3px var(--amber-glow,rgba(232,185,124,0.18))}' +
            '#pf-auth-err{color:var(--danger,#e87c6e);font-size:12.5px;min-height:18px;margin-bottom:10px}' +
            '#pf-auth-btn{width:100%;padding:12px 24px;background:var(--amber,#e8b97c);color:#1a1207;border:none;border-radius:6px;' +
            'font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}' +
            '#pf-auth-btn:hover{background:var(--amber-warm,#f4c98a)}' +
            '#pf-auth-btn:disabled{opacity:.55;cursor:default}' +
            '#pf-auth-cancel{margin-top:12px;background:none;border:none;cursor:pointer;font-family:inherit;' +
            'color:var(--text-mute,rgba(241,236,225,0.46));font-size:12.5px;text-decoration:underline;text-underline-offset:3px}' +
            '#pf-auth-cancel:hover{color:var(--text-soft,rgba(241,236,225,0.72))}';
        document.head.appendChild(style);

        var ov = document.createElement('div');
        ov.id = 'pf-auth-overlay';
        ov.innerHTML =
            '<div id="pf-auth-box">' +
            '<div id="pf-auth-logo"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
            '<h2>Investment Tools</h2>' +
            '<p>Zadejte 6místný PIN — zařízení si zapamatujeme na 90 dní.</p>' +
            '<div id="pf-auth-digits"></div>' +
            '<div id="pf-auth-err"></div>' +
            '<button type="button" id="pf-auth-btn">Odemknout</button>' +
            '<button type="button" id="pf-auth-cancel">Zrušit</button>' +
            '</div>';
        document.body.appendChild(ov);

        var digitsWrap = document.getElementById('pf-auth-digits');
        var inputs = [];
        for (var i = 0; i < 6; i++) {
            var inp = document.createElement('input');
            inp.type = 'password';
            inp.inputMode = 'numeric';
            inp.maxLength = 1;
            inp.className = 'pf-digit';
            inp.autocomplete = 'off';
            digitsWrap.appendChild(inp);
            inputs.push(inp);
        }

        function pinValue() {
            return inputs.map(function (x) { return x.value; }).join('');
        }
        function clearInputs() {
            inputs.forEach(function (x) { x.value = ''; });
            inputs[0].focus();
        }
        function submit() {
            var pin = pinValue();
            if (pin.length !== 6 || /\D/.test(pin)) return;
            var btn = document.getElementById('pf-auth-btn');
            btn.disabled = true;
            inputs.forEach(function (x) { x.disabled = true; });
            onSubmit(pin, function fail(msg) {
                var err = document.getElementById('pf-auth-err');
                if (err) err.textContent = msg || 'Nesprávný PIN.';
                btn.disabled = false;
                inputs.forEach(function (x) { x.disabled = false; });
                clearInputs();
            });
        }

        inputs.forEach(function (inp, idx) {
            inp.addEventListener('input', function () {
                inp.value = inp.value.replace(/\D/g, '');
                if (inp.value && idx < 5) inputs[idx + 1].focus();
                if (pinValue().length === 6) submit();
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !inp.value && idx > 0) inputs[idx - 1].focus();
                if (e.key === 'Enter') submit();
            });
            inp.addEventListener('paste', function (e) {
                e.preventDefault();
                var txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
                for (var j = 0; j < txt.length && j < 6; j++) inputs[j].value = txt[j];
                if (txt.length === 6) submit();
                else if (txt.length > 0) inputs[Math.min(txt.length, 5)].focus();
            });
        });
        document.getElementById('pf-auth-btn').addEventListener('click', submit);
        document.getElementById('pf-auth-cancel').addEventListener('click', function () {
            if (onCancel) onCancel();
        });
        inputs[0].focus();
    }

    function removeOverlay() {
        var ov = document.getElementById('pf-auth-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        var st = document.getElementById('pf-auth-style');
        if (st && st.parentNode) st.parentNode.removeChild(st);
    }

    // ──────────────────────────────────────────────────────────
    //  Device registration
    // ──────────────────────────────────────────────────────────
    function ensureDevice() {
        var existing = getStoredDevice();
        if (existing) return Promise.resolve(existing);
        if (pendingDevice) return pendingDevice;
        pendingDevice = new Promise(function (resolve) {
            var start = function () {
                injectOverlay(function (pin, fail) {
                    fetch(RAILWAY + '/api/device/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pin: pin })
                    }).then(function (r) {
                        return r.json().catch(function () { return {}; })
                            .then(function (data) { return { status: r.status, data: data }; });
                    })
                        .then(function (resp) {
                            var data = resp.data;
                            if (resp.status === 404 || resp.status >= 500) {
                                // endpoint ještě neexistuje / server padá — NENÍ to špatný PIN
                                fail('Server je nedostupný nebo se právě nasazuje — zkuste to za chvíli.');
                                return;
                            }
                            if (data && data.success && data.deviceToken) {
                                try {
                                    localStorage.setItem(DEVICE_KEY, data.deviceToken);
                                    if (data.sessionToken) sessionStorage.setItem(SESSION_KEY, data.sessionToken);
                                } catch (e) { /* no-op */ }
                                removeOverlay();
                                pendingDevice = null;
                                resolve(data.deviceToken);
                            } else {
                                fail((data && data.error) || 'Nesprávný PIN.');
                            }
                        })
                        .catch(function () {
                            fail('Server nedostupný — zkuste to za chvíli.');
                        });
                }, function onCancel() {
                    // Zrušeno uživatelem (např. klient bez PINu v R-E) → resolve(null),
                    // volající použije svůj fallback (GIS popup / chybová obrazovka)
                    removeOverlay();
                    pendingDevice = null;
                    resolve(null);
                });
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', start);
            } else {
                start();
            }
        });
        return pendingDevice;
    }

    // ──────────────────────────────────────────────────────────
    //  Google access token (Railway refresh-token flow)
    // ──────────────────────────────────────────────────────────
    function cachedGoogleToken() {
        try {
            var t = localStorage.getItem(GTOKEN_KEY);
            var exp = parseInt(localStorage.getItem(GTOKEN_EXP_KEY) || '0', 10);
            if (t && exp > Date.now() + 60000) return t;
        } catch (e) { /* no-op */ }
        return null;
    }

    /**
     * Vrátí platný Google access token, nebo null.
     * null = server nemá refresh token nastavený / zařízení není registrované
     *        a interactive=false → volající použije vlastní fallback (GIS).
     * opts.interactive: smí-li se ukázat PIN overlay (default true).
     */
    function getGoogleToken(opts) {
        opts = opts || {};
        var interactive = opts.interactive !== false;
        var cached = cachedGoogleToken();
        if (cached) return Promise.resolve(cached);
        if (pendingGoogle) return pendingGoogle;

        var devicePromise;
        if (getStoredDevice()) {
            devicePromise = Promise.resolve(getStoredDevice());
        } else if (interactive) {
            devicePromise = ensureDevice();
        } else {
            return Promise.resolve(null);
        }

        pendingGoogle = devicePromise.then(function (device) {
            if (!device) return null;
            return fetch(RAILWAY + '/api/google/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceToken: device })
            }).then(function (r) {
                if (r.status === 503) return null; // not_configured → GIS fallback
                if (r.status === 401) { clearDevice(); return null; }
                return r.json().catch(function () { return null; });
            }).then(function (data) {
                if (data && data.accessToken) {
                    try {
                        localStorage.setItem(GTOKEN_KEY, data.accessToken);
                        localStorage.setItem(GTOKEN_EXP_KEY, String(data.expiresAt || (Date.now() + 50 * 60000)));
                    } catch (e) { /* no-op */ }
                    return data.accessToken;
                }
                return null;
            });
        }).catch(function () { return null; })
            .then(function (tok) { pendingGoogle = null; return tok; });
        return pendingGoogle;
    }

    // ──────────────────────────────────────────────────────────
    //  Session token pro AI endpointy (X-Database-Token)
    // ──────────────────────────────────────────────────────────
    function getSessionToken() {
        var cached = null;
        try { cached = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* no-op */ }
        var device = getStoredDevice();
        if (!device) return Promise.resolve(cached);
        // Čerstvý token při každém volání — session mapa na serveru je in-memory,
        // takže cache by po restartu/redeployi Railway byla mrtvá a appka by se
        // zasekla na 401 až do zavření tabu. Cache slouží jen jako záloha při
        // výpadku sítě.
        return fetch(RAILWAY + '/api/device/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceToken: device })
        }).then(function (r) {
            if (r.status === 401) { clearDevice(); return { unauthorized: true }; }
            return r.json().catch(function () { return null; })
                .then(function (d) { return { data: d }; });
        }).then(function (res) {
            if (!res || res.unauthorized) return null; // zařízení zneplatněno → nový PIN
            var data = res.data;
            if (data && data.sessionToken) {
                try { sessionStorage.setItem(SESSION_KEY, data.sessionToken); } catch (e) { /* no-op */ }
                return data.sessionToken;
            }
            return cached; // nečitelná odpověď (deploy okno apod.) → záloha z cache
        }).catch(function () { return cached; });
    }

    window.ProfilendAuth = {
        ensureDevice: ensureDevice,
        getGoogleToken: getGoogleToken,
        getSessionToken: getSessionToken,
        isDeviceRegistered: function () { return !!getStoredDevice(); },
        getDeviceToken: getStoredDevice,
        reset: function () { clearDevice(); },
        RAILWAY: RAILWAY
    };
})();
