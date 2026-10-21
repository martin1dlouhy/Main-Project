// Přihlášení do zámku webu (proxy.mjs) — nastaví cookie it_auth (= deviceToken z Railway, 90 dní).
// POST { deviceToken } — zařízení už přihlášené (token z localStorage) → cookie bez PINu
// POST { pin }         — PIN se ověří na Railway (/api/device/register), kde platí brzdy proti
//                        hádání (limit na IP, rostoucí čekání, globální denní strop chybných pokusů)
// Kód advokáta (LAWYER_PIN_HASH) dá token exp + '.lawyer.' + podpis → proxy.ts ho pustí jen do
// Úvěrové dokumentace. Odpověď nese role: 'owner' | 'lawyer'.
const crypto = require('crypto');

const RAILWAY = 'https://main-project-production-b048.up.railway.app';
const COOKIE = 'it_auth';

function safeEqualHex(sig, expected) {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidToken(token, pinHash) {
    if (!pinHash || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^\d+$/.test(expStr) || Number(expStr) <= Date.now()) return false;
    const expected = crypto.createHmac('sha256', pinHash).update('device:' + expStr).digest('hex');
    return safeEqualHex(sig, expected);
}

// Token advokáta — jen když LAWYER_PIN_HASH existuje a liší se od PIN_HASH (jinak je přístup vypnutý)
function isValidLawyerToken(token, pinHash) {
    const lawyerHash = (process.env.LAWYER_PIN_HASH || '').trim();
    if (!pinHash || !lawyerHash || lawyerHash === pinHash || typeof token !== 'string') return false;
    const m = /^(\d+)\.lawyer\.([0-9a-f]+)$/.exec(token);
    if (!m || Number(m[1]) <= Date.now()) return false;
    const expected = crypto.createHmac('sha256', lawyerHash).update('lawyer:' + m[1]).digest('hex');
    return safeEqualHex(m[2], expected);
}

function tokenRole(token, pinHash) {
    if (isValidToken(token, pinHash)) return 'owner';
    if (isValidLawyerToken(token, pinHash)) return 'lawyer';
    return '';
}

function setAuthCookie(res, token) {
    const exp = Number(token.split('.')[0]);
    const maxAge = Math.max(0, Math.floor((exp - Date.now()) / 1000));
    res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(token) +
        '; Path=/; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Lax');
}

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const pinHash = (process.env.PIN_HASH || '').trim();
    if (!pinHash) {
        return res.status(500).json({ error: 'Zámek není nastavený — chybí PIN_HASH ve Vercelu.' });
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    // 1) Zařízení už přihlášené dřív (stejný podpis jako cookie)
    if (typeof body.deviceToken === 'string') {
        const role = tokenRole(body.deviceToken, pinHash);
        if (!role) {
            return res.status(401).json({ error: 'Přihlášení vypršelo — zadejte PIN.' });
        }
        setAuthCookie(res, body.deviceToken);
        return res.status(200).json({ ok: true, role: role });
    }

    // 2) PIN → Railway
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (!/^\d{6}$/.test(pin)) {
        return res.status(400).json({ error: 'Zadejte 6místný PIN.' });
    }
    let status = 0;
    let data = null;
    try {
        const r = await fetch(RAILWAY + '/api/device/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pin })
        });
        status = r.status;
        data = await r.json().catch(function () { return null; });
    } catch (e) {
        return res.status(502).json({ error: 'Server pro ověření PINu neodpovídá. Zkuste to za chvíli.' });
    }
    const role = data && data.success ? tokenRole(data.deviceToken, pinHash) : '';
    if (role) {
        setAuthCookie(res, data.deviceToken);
        return res.status(200).json({ ok: true, deviceToken: data.deviceToken, sessionToken: data.sessionToken || null, role: role });
    }
    if (data && data.success) {
        // PIN sedí na Railway, ale podpis nesouhlasí → hash ve Vercelu je jiný než na Railway
        const lawyer = data.role === 'lawyer';
        return res.status(500).json({
            error: (lawyer ? 'LAWYER_PIN_HASH' : 'PIN_HASH') + ' ve Vercelu neodpovídá Railway — nastavte na obou místech stejnou hodnotu.'
        });
    }
    return res.status(status >= 400 && status < 600 ? status : 401)
        .json({ error: (data && data.error) || 'Nesprávný PIN.' });
};
