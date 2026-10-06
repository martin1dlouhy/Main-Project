// Zámek celého webu (Vercel Routing Middleware, zapojený ve vercel.json → proxy) — bez platného
// přihlášení Vercel nevydá žádnou stránku ani API, a to na všech adresách projektu.
// Přihlášení = cookie it_auth s deviceTokenem z Railway:
//   exp + '.' + HMAC-SHA256(key = PIN_HASH, msg = 'device:' + exp)   (stejný podpis jako railway-api/server.js)
// Změna PIN_HASH (na Railway I ve Vercelu) okamžitě zneplatní všechna přihlášení.
// TypeScript, protože Vercel u zámku přijímá jen .js/.ts a projekt jinak používá CommonJS (api/*.js).
// Kód záměrně nepotřebuje typy Node.js ani novější knihovny jazyka (žádná závislost navíc).
// Cesty, na kterých zámek běží, jsou ve vercel.json → proxy.matcher.

// @ts-ignore — typy Node.js projekt nemá, modul je za běhu k dispozici
import { createHmac } from 'node:crypto';

declare const process: { env: { [key: string]: string | undefined } };

const COOKIE = 'it_auth';
const PUBLIC_PATHS = ['/login.html', '/api/login'];

// Pokračovat k původní stránce — stejná odpověď jako next() z @vercel/functions
function next(): Response {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

function readCookie(header: string | null, name: string): string | null {
    const parts = String(header || '').split(';');
    for (let i = 0; i < parts.length; i++) {
        const eq = parts[i].indexOf('=');
        if (eq === -1) continue;
        if (parts[i].slice(0, eq).trim() === name) {
            try { return decodeURIComponent(parts[i].slice(eq + 1).trim()); } catch (e) { return null; }
        }
    }
    return null;
}

// Porovnání v konstantním čase (podpis se nesmí dát hádat podle doby odpovědi)
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function isValidToken(token: string | null, pinHash: string): boolean {
    if (!pinHash || !token) return false;
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^\d+$/.test(expStr) || Number(expStr) <= Date.now()) return false;
    const expected: string = createHmac('sha256', pinHash).update('device:' + expStr).digest('hex');
    return safeEqual(sig, expected);
}

export default function proxy(request: Request): Response {
    const url = new URL(request.url);
    if (PUBLIC_PATHS.indexOf(url.pathname) !== -1) return next(); // přihlašovací stránka a API jsou volné

    const pinHash = (process.env.PIN_HASH || '').trim(); // chybí-li, nepustí nikoho (fail closed)
    if (isValidToken(readCookie(request.headers.get('cookie'), COOKIE), pinHash)) return next(); // přihlášen

    if (url.pathname.indexOf('/api/') === 0) {
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
