// Odhlášení ze zámku webu — smaže cookie it_auth (je HttpOnly, skript stránky ho sám smazat nemůže).
// Volá login.html?odhlasit=1 (tlačítko Odhlásit v režimu advokáta). Veřejné v proxy.ts (PUBLIC_PATHS).
const COOKIE = 'it_auth';

module.exports = function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    res.setHeader('Set-Cookie', COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    return res.status(200).json({ ok: true });
};
