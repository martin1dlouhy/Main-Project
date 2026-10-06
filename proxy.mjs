// Zámek celého webu (Vercel Routing Middleware) — bez platného přihlášení Vercel nevydá
// žádnou stránku ani API, a to na všech adresách projektu.
// Přihlášení = cookie it_auth s deviceTokenem z Railway:
//   exp + '.' + HMAC-SHA256(key = PIN_HASH, msg = 'device:' + exp)   (stejný podpis jako railway-api/server.js)
// Změna PIN_HASH (na Railway I ve Vercelu) okamžitě zneplatní všechna přihlášení.
// Soubor je .mjs, protože projekt jinak používá CommonJS (api/*.js) — viz vercel.json → proxy.entrypoint.
import crypto from 'node:crypto';

export const config = {
    runtime: 'nodejs',
    // Jen stránky a API — sdílené styly, skripty a obrázky nenesou data ani logiku aplikací
    matcher: ['/', '/(.*\\.html)', '/api/(.*)']
};

const COOKIE = 'it_auth';
const PUBLIC_PATHS = new Set(['/login.html', '/api/login']);

// Pokračovat k původní stránce — stejná odpověď jako next() z @vercel/functions (bez další závislosti)
function next() {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

function readCookie(header, name) {
    const parts = String(header || '').split(';');
    for (const part of parts) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        if (part.slice(0, i).trim() === name) {
            try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
        }
    }
    return null;
}

function isValidToken(token, pinHash) {
    if (!pinHash || !token) return false;
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^\d+$/.test(expStr) || Number(expStr) <= Date.now()) return false;
    const expected = crypto.createHmac('sha256', pinHash).update('device:' + expStr).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default function proxy(request) {
    const url = new URL(request.url);
    if (PUBLIC_PATHS.has(url.pathname)) return next(); // přihlašovací stránka a API jsou volné

    const pinHash = (process.env.PIN_HASH || '').trim(); // chybí-li, nepustí nikoho (fail closed)
    if (isValidToken(readCookie(request.headers.get('cookie'), COOKIE), pinHash)) return next(); // přihlášen

    if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Nepřihlášeno' }), {
            status: 401,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
    }
    const target = url.pathname + url.search;
    return new Response(null, {
        status: 302,
        headers: { location: '/login.html?next=' + encodeURIComponent(target), 'cache-control': 'no-store' }
    });
}
