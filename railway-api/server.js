const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

// Optional: sharp for reference image compression in marketing image pipeline.
// If sharp is unavailable on the runtime (native binary issues), the pipeline
// still works — references just go uncompressed (larger payload).
var sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('[marketing] sharp not available — reference images sent uncompressed'); }

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================
// MARKETING_CONFIG — central config for marketing endpoints
// Cost values are estimates; OpenAI prices change — not authoritative.
// =============================================
var MARKETING_CONFIG = {
    visionModel: 'gpt-4o',
    visionMaxTokens: 1500,
    visionTemperature: 0.3,
    // gpt-image-1.5 = current flagship (since ~Apr 2026), ~30% cheaper than gpt-image-1 with better quality.
    // gpt-image-2 = "ChatGPT Images 2.0" (released 2026-04-21) — API rollout to developers in early May 2026;
    //              listed here so the dropdown is ready, but server falls back to default if model unsupported.
    imageModelDefault: 'gpt-image-1.5',
    imageQualityDefault: 'hd',
    promptMaxLength: 4000,
    referenceCompressionPx: 512,
    costPerVisionImage: 0.01,
    // Per-image cost estimates for 1024x1024 high quality. Source: OpenAI pricing 2026-04-23.
    costPerImageGen: {
        'gpt-image-2': 0.211,
        'gpt-image-1.5': 0.133,
        'gpt-image-1': 0.19,
        'gpt-image-1-mini': 0.052,
        'dall-e-3': 0.12,
        'dall-e-2': 0.02
    },
    costPerTextGen: { 'gpt-4o-mini': 0.001, 'gpt-4o': 0.005 }
};

// CORS — allow Vercel production + localhost
var allowedOrigins = [
    'https://main-five-alpha.vercel.app',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        return callback(new Error('CORS not allowed'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    // X-Database-Token: custom header pro session token na /api/database/* endpointy.
    // Bez něj browser zruší POST request po preflightu (CORS error).
    allowedHeaders: ['Content-Type', 'X-Database-Token']
}));

app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/', function (req, res) {
    res.json({ status: 'ok', service: 'Investment Tools API', timestamp: new Date().toISOString() });
});

app.get('/health', function (req, res) {
    res.json({ status: 'ok' });
});

// =============================================
// Session tokens (in-memory, 4h TTL)
// Issued by /api/verify-pin on success, required for /api/database/* endpoints.
// =============================================
var sessionTokens = {}; // { token: { ip, createdAt } }

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function cleanupSessionTokens() {
    var now = Date.now();
    var keys = Object.keys(sessionTokens);
    for (var i = 0; i < keys.length; i++) {
        if (now - sessionTokens[keys[i]].createdAt > 4 * 60 * 60 * 1000) {
            delete sessionTokens[keys[i]];
        }
    }
}
setInterval(cleanupSessionTokens, 30 * 60 * 1000);

function verifyDatabaseToken(req) {
    var t = req.headers['x-database-token'];
    if (!t || !sessionTokens[t]) return false;
    // Refresh activity (sliding window)
    sessionTokens[t].createdAt = Date.now();
    return true;
}

// =============================================
// POST /api/verify-pin — Server-side PIN verification
// PIN hash stored in env variable PIN_HASH (SHA-256)
// Rate limited: max 5 attempts per IP per 5 minutes
// On success, returns sessionToken for /api/database/* endpoints.
// (Legacy callers — termsheet, loan-doc — ignore sessionToken field; backwards compat.)
// =============================================
var pinAttempts = {}; // { ip: { count, firstAttempt } }

function cleanupAttempts() {
    var now = Date.now();
    var keys = Object.keys(pinAttempts);
    for (var i = 0; i < keys.length; i++) {
        if (now - pinAttempts[keys[i]].firstAttempt > 5 * 60 * 1000) {
            delete pinAttempts[keys[i]];
        }
    }
}

// Cleanup every 10 minutes
setInterval(cleanupAttempts, 10 * 60 * 1000);

app.post('/api/verify-pin', async function (req, res) {
    var pinHash = (process.env.PIN_HASH || '').trim();
    if (!pinHash) {
        return res.status(500).json({ error: 'PIN_HASH is not configured on server.' });
    }

    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    var now = Date.now();

    // Rate limiting
    if (!pinAttempts[ip]) {
        pinAttempts[ip] = { count: 0, firstAttempt: now };
    }
    var record = pinAttempts[ip];

    // Reset window after 5 minutes
    if (now - record.firstAttempt > 5 * 60 * 1000) {
        record.count = 0;
        record.firstAttempt = now;
    }

    if (record.count >= 5) {
        var remaining = Math.ceil((5 * 60 * 1000 - (now - record.firstAttempt)) / 1000);
        return res.status(429).json({
            success: false,
            error: 'Příliš mnoho pokusů. Zkuste to za ' + remaining + ' sekund.'
        });
    }

    var pin = req.body && req.body.pin;
    if (!pin || typeof pin !== 'string' || pin.length !== 4) {
        return res.status(400).json({ success: false, error: 'Neplatný PIN.' });
    }

    record.count++;

    // SHA-256 comparison (no $ characters — safe for Railway env vars)
    var inputHash = crypto.createHash('sha256').update(pin).digest('hex');
    if (inputHash === pinHash) {
        // Reset attempts on success
        delete pinAttempts[ip];
        // Issue session token (legacy callers can ignore this field)
        var sessionToken = generateSessionToken();
        sessionTokens[sessionToken] = { ip: ip, createdAt: Date.now() };
        return res.status(200).json({ success: true, sessionToken: sessionToken });
    } else {
        return res.status(200).json({ success: false, error: 'Nesprávný PIN.' });
    }
});

// =============================================
// POST /api/parse-lv — Claude LV analysis
// No timeout limit (unlike Vercel's 60s cap)
// =============================================
app.post('/api/parse-lv', async function (req, res) {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Add it in Railway → Variables.' });
    }

    var text = req.body && req.body.text;
    var images = req.body && req.body.images; // Array of base64 JPEG strings (fallback when pdf.js can't extract text)
    var fileName = req.body && req.body.fileName;
    var instructions = req.body && req.body.instructions;

    var hasText = text && text.trim().length >= 20;
    var hasImages = images && Array.isArray(images) && images.length > 0;

    if (!hasText && !hasImages) {
        return res.status(400).json({ error: 'Z dokumentu se nepodařilo extrahovat text ani obrázky.' });
    }

    if (hasText && text.length > 100000) {
        return res.status(400).json({ error: 'Text je příliš dlouhý (max 100 000 znaků).' });
    }

    if (hasImages && images.length > 20) {
        return res.status(400).json({ error: 'Příliš mnoho stránek (max 20).' });
    }

    var client = new Anthropic({ apiKey: apiKey });

    var systemPrompt = 'Jsi expert na analýzu českých katastrálních dokumentů — Listů vlastnictví (LV).\n' +
        'Tvým úkolem je z poskytnutého textu extrahovat strukturovaná data.\n\n' +
        'KRITICKÉ PRAVIDLO: Vrať POUZE platný JSON. Žádný markdown, žádné ```json``` bloky, žádný text před ani za JSON. Odpověď MUSÍ začínat znakem { nebo [.\n\n' +
        'Formát JSON:\n' +
        '{\n' +
        '  "lv_cislo": "číslo LV nebo null",\n' +
        '  "katastralni_uzemi": "název katastrálního území nebo null",\n' +
        '  "obec": "název obce nebo null",\n' +
        '  "vlastnici": ["jméno vlastníka 1", "jméno vlastníka 2"],\n' +
        '  "parcely": [\n' +
        '    {\n' +
        '      "typ": "pozemek nebo stavba",\n' +
        '      "parcelni_cislo": "číslo parcely (např. st. 123 nebo 456/2)",\n' +
        '      "vymera": "výměra v m² nebo null",\n' +
        '      "druh": "druh pozemku nebo typ stavby nebo null",\n' +
        '      "zpusob_vyuziti": "způsob využití nebo null"\n' +
        '    }\n' +
        '  ],\n' +
        '  "zastavni_prava": [\n' +
        '    {\n' +
        '      "typ": "Zástavní právo smluvní / exekutorské / soudcovské",\n' +
        '      "opravneny": "název oprávněného subjektu",\n' +
        '      "castka": "částka pohledávky nebo null"\n' +
        '    }\n' +
        '  ],\n' +
        '  "vecna_bremena": [\n' +
        '    {\n' +
        '      "typ": "popis věcného břemene",\n' +
        '      "opravneny": "oprávněný subjekt nebo null"\n' +
        '    }\n' +
        '  ],\n' +
        '  "omezeni": ["další omezení vlastnického práva - textové popisy"],\n' +
        '  "collateral_summary": "Stručný jednořádkový popis pro pole zajištění v Term Sheetu, např: LV 303, kú Čečovice — pozemky p.č. 456/2, 456/3 (celkem 2 500 m²)"\n' +
        '}\n\n' +
        'Pokud některé údaje v textu nejsou, vrať null nebo prázdné pole.\n' +
        'Pokud text obsahuje více LV, vrať pole JSON objektů.\n' +
        'Klíč "collateral_summary" je nejdůležitější — měl by obsahovat stručný popis vhodný do Term Sheetu.\n' +
        'Text může být špatně extrahovaný z PDF — pokus se i tak rozpoznat klíčové údaje (číslo LV, katastrální území, parcely).\n' +
        'U velkých LV s mnoha parcelami uveď VŠECHNY parcely — nevynechávej žádnou.\n' +
        'Pokud dostaneš obrázky stránek PDF místo textu, přečti a analyzuj je stejným způsobem.\n' +
        'Pokud PDF obsahuje více LV (každý na jiné stránce/stránkách), vrať pole JSON objektů — jeden objekt pro každý LV.';

    // Helper: try to extract JSON from Claude response text
    function tryParseJSON(responseText) {
        // Strategy 1: Direct parse
        try {
            return JSON.parse(responseText.trim());
        } catch (e) { /* not pure JSON */ }

        // Strategy 2: Markdown code block
        var codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
            try {
                return JSON.parse(codeBlockMatch[1].trim());
            } catch (e) { /* invalid JSON in code block */ }
        }

        // Strategy 3: Find first { to last } or first [ to last ]
        var startObj = responseText.indexOf('{');
        var startArr = responseText.indexOf('[');

        if (startArr !== -1 && (startObj === -1 || startArr < startObj)) {
            try {
                return JSON.parse(responseText.substring(startArr, responseText.lastIndexOf(']') + 1));
            } catch (e) { /* invalid */ }
        }
        if (startObj !== -1) {
            try {
                return JSON.parse(responseText.substring(startObj, responseText.lastIndexOf('}') + 1));
            } catch (e) { /* invalid */ }
        }

        // Strategy 4: Truncated array — salvage complete objects from "[{...}, {..."
        // When max_tokens is hit, the JSON array may be cut mid-object
        if (startArr !== -1) {
            var arrContent = responseText.substring(startArr + 1);
            var salvaged = [];
            var braceDepth = 0;
            var objStart = -1;
            for (var ci = 0; ci < arrContent.length; ci++) {
                var ch = arrContent[ci];
                if (ch === '{' && braceDepth === 0) objStart = ci;
                if (ch === '{') braceDepth++;
                if (ch === '}') braceDepth--;
                if (ch === '}' && braceDepth === 0 && objStart !== -1) {
                    try {
                        var obj = JSON.parse(arrContent.substring(objStart, ci + 1));
                        salvaged.push(obj);
                    } catch (e) { /* skip malformed object */ }
                    objStart = -1;
                }
            }
            if (salvaged.length > 0) {
                console.log('Salvaged ' + salvaged.length + ' complete JSON objects from truncated response');
                return salvaged;
            }
        }

        // Strategy 5: Single truncated object — try to close it
        if (startObj !== -1) {
            var objText = responseText.substring(startObj);
            // Count unclosed braces and try to close them
            var openBraces = 0;
            var openBrackets = 0;
            var inString = false;
            var escaped = false;
            for (var si = 0; si < objText.length; si++) {
                var sc = objText[si];
                if (escaped) { escaped = false; continue; }
                if (sc === '\\') { escaped = true; continue; }
                if (sc === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (sc === '{') openBraces++;
                if (sc === '}') openBraces--;
                if (sc === '[') openBrackets++;
                if (sc === ']') openBrackets--;
            }
            if (openBraces > 0 || openBrackets > 0) {
                // Truncate to last complete key-value pair
                var lastComma = objText.lastIndexOf(',');
                var lastCloseBrace = objText.lastIndexOf('}');
                if (lastComma > lastCloseBrace) {
                    objText = objText.substring(0, lastComma);
                }
                // Close open brackets and braces
                for (var bi = 0; bi < openBrackets; bi++) objText += ']';
                for (var bj = 0; bj < openBraces; bj++) objText += '}';
                try {
                    var repaired = JSON.parse(objText);
                    console.log('Repaired truncated JSON object (closed ' + openBraces + ' braces, ' + openBrackets + ' brackets)');
                    return repaired;
                } catch (e) { /* repair failed */ }
            }
        }

        return null;
    }

    var mode = hasImages && !hasText ? 'images' : 'text';
    console.log('LV parse request:', { fileName: fileName, mode: mode, textLength: hasText ? text.length : 0, imageCount: hasImages ? images.length : 0 });

    try {
        var userContentParts;

        if (mode === 'images') {
            // Multimodal mode — send page images to Claude
            var textIntro = 'Analyzuj tento List vlastnictví z katastru nemovitostí (soubor: ' + (fileName || 'neznámý') + ').\n' +
                'Níže jsou obrázky jednotlivých stránek PDF.\n' +
                (instructions ? 'POKYN OD UŽIVATELE: ' + instructions + '\n' : '') +
                'Přečti a extrahuj VŠECHNA data ze VŠECH stránek.';

            userContentParts = [{ type: 'text', text: textIntro }];

            for (var imgIdx = 0; imgIdx < images.length; imgIdx++) {
                // Strip data URI prefix if present
                var base64Data = images[imgIdx];
                if (base64Data.indexOf(',') !== -1) {
                    base64Data = base64Data.split(',')[1];
                }
                userContentParts.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: base64Data
                    }
                });
            }
        } else {
            // Text mode — original behavior
            var inputText = text.substring(0, 30000);
            var textContent = 'Analyzuj tento List vlastnictví z katastru nemovitostí (soubor: ' + (fileName || 'neznámý') + '):\n\n' +
                (instructions ? 'POKYN OD UŽIVATELE: ' + instructions + '\n\n' : '') +
                inputText;
            userContentParts = textContent;
        }

        // Image mode: no prefill — Claude can return array directly for multiple LVs
        // Text mode: use "{" prefill to force JSON (original behavior)
        var maxTokens = mode === 'images' ? 16384 : 8192;
        var messages;
        if (mode === 'images') {
            messages = [{ role: 'user', content: userContentParts }];
        } else {
            messages = [
                { role: 'user', content: userContentParts },
                { role: 'assistant', content: '{' }
            ];
        }

        var message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            messages: messages,
            system: systemPrompt
        });

        // Reconstruct response — add prefill "{" only for text mode
        var responseText = mode === 'images'
            ? message.content[0].text
            : '{' + message.content[0].text;
        var stopReason = message.stop_reason || 'unknown';
        console.log('Claude response length:', responseText.length, 'stop_reason:', stopReason, 'mode:', mode, 'first 200 chars:', responseText.substring(0, 200));

        // If response was truncated (max_tokens hit), try to salvage partial JSON
        if (stopReason === 'max_tokens') {
            console.warn('Claude response was truncated at max_tokens — attempting to salvage partial JSON');
        }

        var parsed = tryParseJSON(responseText);

        if (parsed) {
            var results;
            if (Array.isArray(parsed)) {
                results = parsed;
            } else if (parsed.lv_cislo !== undefined) {
                // Single LV object
                results = [parsed];
            } else {
                // Wrapper object — Claude used { prefill and wrapped array in a key
                // Look for the first array value containing LV objects
                var foundArray = null;
                var keys = Object.keys(parsed);
                for (var ki = 0; ki < keys.length; ki++) {
                    var val = parsed[keys[ki]];
                    if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object') {
                        foundArray = val;
                        console.log('Unwrapped LV array from key "' + keys[ki] + '" (' + val.length + ' items)');
                        break;
                    }
                }
                results = foundArray || [parsed];
            }
            return res.status(200).json({ success: true, data: results });
        } else {
            console.error('Failed to parse JSON from Claude response (first 500 chars):', responseText.substring(0, 500));
            return res.status(200).json({ success: false, error: 'Claude nedokázal z textu extrahovat strukturovaná data. Zkuste soubor nahrát znovu.', raw: responseText.substring(0, 500) });
        }
    } catch (err) {
        console.error('Claude API error:', JSON.stringify({
            message: err.message,
            status: err.status,
            type: err.constructor.name,
            body: err.body || null
        }));
        var errorMsg = err.message || 'Neznámá chyba';
        var statusCode = 500;
        if (err.status === 401) {
            errorMsg = 'Neplatný API klíč. Zkontrolujte ANTHROPIC_API_KEY v Railway Variables.';
            statusCode = 401;
        } else if (err.status === 429) {
            errorMsg = 'Příliš mnoho požadavků. Počkejte chvíli a zkuste znovu.';
            statusCode = 429;
        } else if (err.status === 529 || err.status === 503) {
            errorMsg = 'Claude API je přetížené. Zkuste znovu za chvíli.';
            statusCode = 503;
        } else if (err.status === 400) {
            errorMsg = 'Chyba požadavku na Claude API: ' + (err.message || 'neznámá');
            statusCode = 400;
        }
        return res.status(statusCode).json({
            error: errorMsg,
            debug: {
                apiStatus: err.status || null,
                type: err.constructor.name,
                detail: (err.body && err.body.error && err.body.error.message) || err.message || null
            }
        });
    }
});

// Helpers pro Czech number formátování — používané loan doc prompt buildery.
// parseCzNumber: "38 000 000" / "38.000.000" / "38000000" / "1,5" → JS number.
// formatCzAmount: 380000 → "380.000" (tečky jako oddělovače tisíců, žádné desetinné).
function parseCzNumber(value) {
    if (value === null || value === undefined) return NaN;
    var s = String(value).replace(/\s/g, '').replace(/ /g, '');
    // Pokud má string jen jeden výskyt . nebo , a před ním je <= 2 cifry, je to desetinný.
    // Jinak (typicky "38.000.000") jsou to tisícové oddělovače — odstraníme.
    var commaIdx = s.lastIndexOf(',');
    var dotIdx = s.lastIndexOf('.');
    if (commaIdx > -1 && (dotIdx === -1 || commaIdx > dotIdx)) {
        // Čárka jako desetinný oddělovač (cs-CZ)
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (dotIdx > -1) {
        var afterDot = s.length - dotIdx - 1;
        if (afterDot === 3 && s.indexOf('.') !== dotIdx) {
            // Více teček + poslední s 3 ciframi za sebou → tisícové oddělovače
            s = s.replace(/\./g, '');
        } else if (afterDot === 3 && s.length > 5) {
            // Jeden výskyt s 3 ciframi (např. "5.000") — typicky tisícový oddělovač pro velké částky
            // Heuristika: pokud string má 5+ znaků a 3 cifry za tečkou, je to tisícový oddělovač
            s = s.replace(/\./g, '');
        }
        // Jinak nech tečku jako desetinný
    }
    var n = parseFloat(s);
    return isNaN(n) ? NaN : n;
}

function formatCzAmount(num) {
    if (typeof num !== 'number' || isNaN(num)) return String(num || '');
    // toLocaleString cs-CZ vrátí "380 000" (s nezalomitelnou mezerou). Nahradíme tečkou
    // aby formát odpovídal konvenci promptu ("5.000.000 Kč").
    return Math.round(num).toLocaleString('cs-CZ').replace(/ /g, '.').replace(/\s/g, '.');
}

// =============================================
// Loan doc prompt builders — single source of truth.
// Tyto funkce VOLÁ jak /api/generate-loan-doc (reálné AI volání), tak
// /api/generate-loan-doc/preview (jen vrátí prompt bez API volání).
// Tj. preview na frontendu je VŽDY identický s tím, co AI reálně dostane —
// žádný drift mezi backend a "buildSystemPromptPreview" v loan-documentation.html.
// =============================================
function buildLoanDocSystemPrompt(templateName, passNumber) {
    var systemPrompt = 'Jsi právní asistent ProfiLend specializovaný na vyplňování smluvní dokumentace pro úvěrové dealy.\n\n' +
        '=== KONTEXT (PLATÍ PRO KAŽDÝ TYP ŠABLONY) ===\n' +
        'ProfiLend pracuje se sadou šablon: úvěrová smlouva, zástavní smlouva (k nemovitostem / podílům / akciím), plná moc k přímému prodeji, vinkulace pojistného plnění, notářský zápis, směnka, dohoda o úhradě nákladů ocenění a další.\n\n' +
        'KAŽDÁ ŠABLONA (BEZ VÝJIMKY) JE PŘEDVYPLNĚNÁ KONKRÉTNÍMI ÚDAJI Z PŘEDCHOZÍHO DEALU. Šablony se v ProfiLendu znovupoužívají tak, že se vezme dokument z minulé smlouvy a přepíší se v něm konkrétní hodnoty na nového klienta a nový deal. To znamená:\n' +
        '- Najdeš v šabloně KONKRÉTNÍ jméno minulého klienta (např. "AGRI PARTNERS Nezamyslice s.r.o.", "QED FACILITY s.r.o.", "TSI Consulting s.r.o.") — to NENÍ legal text, je to data k nahrazení.\n' +
        '- Najdeš tam KONKRÉTNÍ IČO, sídlo, spisovou značku, jméno jednatele — to NENÍ legal text, je to data k nahrazení.\n' +
        '- Najdeš tam KONKRÉTNÍ částku ("5.000.000 Kč"), úrokovou sazbu ("9,5 % p.a."), datum ("27.04.2029"), čísla LV ("LV 303"), čísla účtů ("123-456789/0100"), banku ("Komerční Banka, a.s.") — to vše JE data, ne legal text.\n' +
        '- Najdeš tam KONKRÉTNÍ adresy nemovitostí, výměry parcel, popisy zajištění — pokud se v poskytnutých DATA liší, JE TO data k nahrazení.\n\n' +
        'JMÉNO ŠABLONY (' + (templateName || 'neznámé') + ') ti napoví, o jaký typ smlouvy jde, ale pravidlo o předvyplnění platí pro VŠECHNY typy.\n\n' +
        'TVŮJ ÚKOL: Pro KAŽDOU šablonu (bez ohledu na typ — úvěrová, zástavní, plná moc, vinkulace, atd.) udělej KOMPLETNÍ REVIZI celého obsahu od první do poslední věty. NESTAČÍ jen najít konkrétní údaje a nahradit je — musíš celou smlouvu projít jako právník dělající due diligence revizi a zajistit, aby výsledný dokument DÁVAL SMYSL jako celek pro NOVÝ deal.\n\n' +
        '=== PROCES REVIZE (postupuj přesně v tomto pořadí) ===\n' +
        '1. PŘEČTI CELOU SMLOUVU. Pochop, o jaký typ smlouvy jde, jaké strany, jaké zajištění, jaké přílohy, jakou strukturu článků.\n' +
        '2. IDENTIFIKUJ KONKRÉTNÍ ÚDAJE Z MINULÉHO DEALU. Projdi od začátku do konce a najdi všechna jména firem, IČO, sídla, jména jednatelů, částky, data, úroky, doby splatnosti, LV čísla, čísla účtů, banky, adresy, výměry, jména odhadců — VŠE konkrétní, co je specifické pro nějaký konkrétní deal.\n' +
        '3. POROVNEJ S NOVÝMI DATA. Pro každý identifikovaný údaj: existuje v DATA odpovídající nová hodnota? Pokud ano → ZMĚŇ. Pokud DATA tento údaj NEMÁ (např. minulý deal měl ručitele, nový ne) → SMAŽ celou pasáž / klauzuli / přílohu týkající se tohoto údaje.\n' +
        '4. KONTROLA KONZISTENCE NAPŘÍČ DOKUMENTEM. Jeden údaj se v šabloně OPAKUJE na mnoha místech (jméno klienta třeba 20×, částka úvěru 5×, splatnost 8×). MUSÍŠ zachytit VŠECHNY výskyty — pokud frontend dostane "find" string který se v textu opakuje, aplikuje ho na všechny výskyty (1 replacement pár stačí). Ale POZOR — pokud se hodnota v různých místech zapisuje různě (např. "5.000.000 Kč" v hlavičce, "pět miliónů Kč" v textu, "5 mil. Kč" v příloze), MUSÍŠ vrátit SEPARÁTNÍ replacement pár pro KAŽDOU variantu zápisu.\n' +
        '5. KONTROLA LOGIKY. Pokud jsi v kroku 3 něco smazala (např. ručitele), projdi zbytek smlouvy a HLEDEJ křížové reference. Pokud článek X zmiňuje "ručitel" / "rezervní fond" / "vinkulace" / přílohu, kterou jsi smazala, MUSÍŠ tento odkaz taky upravit / smazat / přeformulovat. Smlouva nesmí obsahovat odkazy na neexistující články, přílohy, osoby ani závazky.\n' +
        '6. KONTROLA HISTORICKÝCH ZBYTKŮ. Šablona je historická smlouva — mohou tam být i poznámky pod čarou, komentáře, datumy revizí, jména autorů, číslování verzí ("verze 3 ze dne 12.4.2023"), interní reference ("dle úvěrové komise z 5.5.2022"), schvalovací podpisy. Tyto historické otisky NEPATŘÍ do nového dokumentu — SMAŽ je nebo aktualizuj.\n' +
        '7. KONTROLA ÚPLNOSTI POKRYTÍ DATA. Po prvních 6 krocích zpětně projdi formData a ověř: každé pole, které Martin vyplnil (borrower, ico, sidlo, amount, interest, ...), MUSÍ být ve smlouvě někde použito. Pokud Martin vyplnil contactPhone, ale ve smlouvě žádné telefonní číslo neexistuje, tak nic neměníš. Ale pokud Martin vyplnil borrower a ve smlouvě je staré jméno klienta, MUSELA jsi to v kroku 3 zachytit.\n' +
        '8. NOTES. V "notes" stručně shrň výsledek revize: kolik změn jsi udělala, co jsi smazala (a proč), co jsi přidala, kde si nejsi 100% jistá a doporučuješ manuální revizi.\n\n' +
        '=== TYPICKÉ HISTORICKÉ ZBYTKY (často přehlížené, AKTIVNĚ hledej) ===\n' +
        'Z PRAXE: tyto věci AI často přehlíží, protože vypadají jako "legal text". NEJSOU — jsou to konkrétní zbytky z minulého dealu. AKTIVNĚ je hledej a řeš:\n\n' +
        '1. ČÍSLA ŘÍZENÍ KATASTRU — formát "V-XXXX/YYYY-ZZZ" nebo "Z-XXXX/YYYY-ZZZ" (např. "V-722/2010-433", "V-1245/2026-406"). Tato čísla jsou SPECIFICKÁ pro minulý deal. Pokud DATA neobsahují nové číslo řízení, SMAŽ celou závorku "(pod sp. zn. V-XXXX/YYYY-ZZZ)" nebo nahraď "(pod sp. zn. [DOPLNIT])".\n\n' +
        '2. STARÉ ZÁSTAVNÍ BANKY — názvy jako "Raiffeisenbank a.s.", "Komerční banka, a.s.", "Česká spořitelna, a.s.", "ČSOB a.s." pokud se v textu vyskytují JAKO zastavni věřitel (nikoli jako "Banka úvěrového účtu Dlužníka"). Pokud DATA má existingPledge, nahraď. Pokud DATA nemá existingPledge, SMAŽ celou klauzuli o starém zástavním právu k výmazu — v novém dealu žádné staré zástavní právo neexistuje.\n\n' +
        '3. ČERPÁNÍ ÚVĚRU — pokud šablona popisuje čerpání ve TRANŠÍCH (např. články typu "Úvěr se čerpá v 5 tranších", "1. tranše do data X, 2. tranše po splnění podmínky Y") a DATA má drawdownType="Jednorázové", MUSÍŠ tyto články PŘEFORMULOVAT na jednorázové čerpání. Stejně opačně — pokud šablona má jednorázové a DATA má tranše, přeformuluj na tranše.\n\n' +
        '4. POPLATEK Z ČERPANÉ ČÁSTKY — pokud šablona má "1 % z každé čerpané tranše", ale DATA má originationFeeType="percent" + originationFee=X, MUSÍŠ článek upravit aby odpovídal (např. "X % z celkové výše úvěru" pro jednorázové čerpání). Pokud DATA má originationFeeType="amount" + originationFee=X, přeformuluj jako paušální poplatek X Kč.\n\n' +
        '5. VINKULACE POJISTNÉHO PLNĚNÍ — klauzule typu "Úvěrovaný zajistí vinkulaci pojistného plnění z nemovitostí na LV X, LV Y ve prospěch Věřitele." Pokud DATA má v collateralItems jiné nemovitosti, MUSÍŠ aktualizovat seznam LV. Pokud DATA nemá nemovitosti (jen jiný typ zajištění — podíly, akcie), SMAŽ celou klauzuli o vinkulaci.\n\n' +
        '6. POŘADÍ ČLÁNKŮ A KŘÍŽOVÉ ODKAZY — odkazy typu "viz článek 5.3", "dle Přílohy 1C", "v souladu s ustanovením článku 12 odst. 4". Pokud jsi smazala Přílohu 1C, MUSÍŠ taky smazat / upravit všechny odkazy na ni v hlavním textu.\n\n' +
        '7. DATUMY MIMO RÁMEC DEALU — datumy interních úvěrových komisí ("schváleno na úvěrové komisi z 5.5.2022"), datumy revizí šablony ("verze 3 ze dne 12.4.2023"), datumy předchozího odhadu nemovitosti pokud DATA má appraisalDate. SMAŽ nebo aktualizuj.\n\n' +
        '8. ČÍSLA ÚČTŮ MIMO DATA — pokud najdeš v textu číslo účtu (formát "XXX-XXXXXXXXXX/YYYY"), které není ani borrowerAccount ani lenderAccount z DATA, je to zbytek z minulého dealu. SMAŽ kontext, ve kterém se nachází, nebo nahraď za odpovídající nový.\n\n' +
        '=== ČTYŘI TYPY OPERACÍ ===\n' +
        'Šablona je HISTORICKÁ smlouva, ne placeholder template. Některé části jsou specifické pro MINULÝ deal a v novém dealu nemají místo. Máš 4 typy operací — všechny se zapisují stejným formátem {"find": "...", "replace": "..."}:\n\n' +
        '1. ZMĚNIT HODNOTU (nejčastější) — najdi konkrétní údaj a nahraď ho novou hodnotou z DATA.\n' +
        '   Příklad: {"find": "AGRI PARTNERS Nezamyslice s.r.o.", "replace": "Louve Group s.r.o."}\n\n' +
        '2. SMAZAT IRRELEVANTNÍ OBSAH — vrať prázdný "replace". Použij, když:\n' +
        '   - Šablona má přílohu o nemovitosti (LV 303), kterou nový klient v collateralItems NEMÁ.\n' +
        '   - Šablona má klauzuli o ručiteli, ale nový deal ručitele nemá.\n' +
        '   - Šablona má specifické ustanovení pro minulý deal, které pro nový nedává smysl.\n' +
        '   Příklad: {"find": "Příloha 3 — Nemovitosti LV 303\\n[celý obsah přílohy doslova]", "replace": ""}\n\n' +
        '3. PŘIDAT CHYBĚJÍCÍ OBSAH — najdi anchor v dokumentu a vrať "replace" = anchor + nový text.\n' +
        '   Použij, když má nový deal víc LV/zajištění než minulý a šablona je neobsahuje.\n' +
        '   Příklad: {"find": "Příloha 2 — Nemovitosti LV 100", "replace": "Příloha 2 — Nemovitosti LV 100\\n\\nPříloha 3 — Nemovitosti LV 4587\\n[obsah nové přílohy]"}\n\n' +
        '4. PŘEFORMULOVAT — i celé věty/odstavce. Použij, když nový deal má jinou strukturu (např. jiný typ splácení, jiný splátkový kalendář).\n' +
        '   Příklad: {"find": "Úvěrovaný splatí úvěr jednorázově ke Dni konečné splatnosti.", "replace": "Úvěrovaný splatí úvěr ve 12 měsíčních splátkách počínaje dnem čerpání."}\n\n' +
        '=== CO NEMĚNIT ===\n' +
        'Nesahej na obecné právní formulace BEZ čísel/jmen ("Smluvní strany se tímto dohodly…", definice pojmů typu "Den konečné splatnosti", standardní hlavičky článků). Heuristika: obsahuje-li věta číslo / jméno firmy / datum / částku / adresu → JE TO DATA k revizi. Obecná formulace beze čísel a jmen → LEGAL TEXT, neměnit.\n\n' +
        '=== POZNÁMKY (notes) — MARTIN JE UVIDÍ V UI ===\n' +
        'V "notes" stručně shrň co jsi udělala — Martin to uvidí pod každým vygenerovaným dokumentem v aplikaci (NE v samotné smlouvě). Sem patří:\n' +
        '- Co jsi SMAZALA a proč (např. "Smazala jsem 3 přílohy LV 303, 321, 100 — nový klient má v collateralItems jen LV 4587.").\n' +
        '- Co jsi PŘIDALA (např. "Přidala jsem novou přílohu pro LV 4587 — odhad mu doplň ručně.").\n' +
        '- Co jsi musela odhadovat / kde si nejsi 100% jistá (např. "Článek 5.3 zmiňoval rezervní fond — nechala jsem beze změny, ověř manuálně.").\n' +
        '- Co Martin musí doplnit ručně (např. "Datum podpisu nebylo v DATA — nechala jsem prázdné.").\n' +
        'Pokud si NEJSI 100% jistá, jestli něco smazat, NESMAŽ a místo toho do notes napiš doporučení k manuální revizi. Lepší méně agresivní změna než zlikvidovat něco potřebného.\n\n' +
        '=== FORMÁT ODPOVĚDI ===\n' +
        'Vrať POUZE platný JSON, žádný markdown:\n' +
        '{\n' +
        '  "replacements": [\n' +
        '    {"find": "AGRI PARTNERS Nezamyslice s.r.o.", "replace": "Louve Group s.r.o."},\n' +
        '    {"find": "27.04.2029", "replace": "31.05.2030"},\n' +
        '    {"find": "Příloha 3 — Nemovitosti LV 303 ...", "replace": ""}\n' +
        '  ],\n' +
        '  "notes": "Nahradila jsem klienta + datum. Smazala přílohu LV 303 (nový deal má jen LV 4587). Doporučuji ověřit článek 5.3."\n' +
        '}\n\n' +
        '=== PRAVIDLA REPLACEMENT PÁRŮ ===\n' +
        '- "find" MUSÍ být PŘESNÝ řetězec, který je doslova v šabloně. Zkopíruj přesně z textu šablony včetně mezer, diakritiky, formátování. Pokud "find" nesedí přesně, frontend nahrazení neaplikuje (tichý fail) — proto kopíruj doslova.\n' +
        '- POKUD V DATA NĚJAKÝ ÚDAJ CHYBÍ (např. prázdné contactPhone) — nechej v šabloně původní hodnotu, NENAHRAZUJ.\n' +
        '- Částky formátuj s tečkami jako oddělovače tisíců + měna ("5.000.000 Kč").\n' +
        '- Data ve formátu DD.MM.YYYY ("27.04.2029").\n' +
        '- Procenta s desetinnou čárkou + " % p.a." ("9,5 % p.a.").\n' +
        '- IČO bez mezer (8 číslic).\n' +
        '- LV čísla a kolaterály z formData.collateralItems (multi-line text, každý řádek = jedna nemovitost).\n' +
        '- Pokud najdeš více výskytů stejného řetězce v šabloně (např. jméno klienta se opakuje 10×), stačí JEDEN replacement pár — frontend ho aplikuje na všechny výskyty.\n\n' +
        '=== MINIMÁLNÍ OČEKÁVANÝ POČET REPLACEMENTS ===\n' +
        'Pro typickou úvěrovou smlouvu se očekává 10-30 replacements (změny hodnot + případné smazání irrelevantních příloh). Pokud vracíš méně než 5 replacements, něco je špatně — v "notes" vysvětli proč.';

    if (passNumber === 2) {
        systemPrompt += '\n\n=== PASS 2 — HLUBOKÁ REVIZE PO PRVNÍM PRŮCHODU ===\n' +
            'TOTO JE DRUHÝ PRŮCHOD revize. V Pass 1 už byly aplikovány nějaké změny (viz "JIŽ APLIKOVANÉ ZMĚNY" v user message). Tvůj úkol nyní:\n\n' +
            '1. NEDUPLIKUJ co už bylo nahrazeno. Pokud Pass 1 už změnila "AGRI PARTNERS s.r.o." → "Louve Group s.r.o.", NEVRACEJ stejný pár.\n' +
            '2. HLEDEJ CO ZBYLO. Projdi text smlouvy znovu — co tam je z minulého dealu a NEBYLO Pass 1 odstraněno? Specificky:\n' +
            '   - Čísla řízení katastru, která zůstala\n' +
            '   - Stará čísla LV, která zůstala v křížových odkazech\n' +
            '   - Klauzule o vinkulaci / čerpání / poplatcích, které stále neodpovídají DATA\n' +
            '   - Historické datumy, jména bank, čísla účtů\n' +
            '   - Přílohy o nemovitostech, které měly být smazány v Pass 1, ale find string nesedl\n' +
            '3. ZAMĚŘ SE NA TIŠÉ FAILED REPLACEMENTS. Pokud Pass 1 měla replacement "Příloha 1C — LV 100..." s prázdným replace (= mělo smazat), ale text Přílohy 1C v dokumentu STÁLE existuje, znamená to že find string nesedl přesně. Najdi přesný text Přílohy 1C v dokumentu a vrať NOVÝ replacement s correct find.\n' +
            '4. V NOTES uveď, kolik dodatečných změn Pass 2 přidala a jakého typu.';
    }

    return systemPrompt;
}

function buildLoanDocDataDescription(formData) {
    formData = formData || {};
    var d = 'DATA PRO VYPLNĚNÍ SMLOUVY:\n\n';
    d += '=== DLUŽNÍK ===\n';
    if (formData.borrower) d += 'Název: ' + formData.borrower + '\n';
    if (formData.ico) d += 'IČO: ' + formData.ico + '\n';
    if (formData.spisovaZnacka) d += 'Spisová značka: ' + formData.spisovaZnacka + '\n';
    if (formData.sidlo) d += 'Sídlo: ' + formData.sidlo + '\n';

    d += '\n=== PARAMETRY ÚVĚRU ===\n';
    if (formData.purpose) d += 'Účel úvěru: ' + formData.purpose + '\n';
    if (formData.amount) d += 'Výše úvěru: ' + formData.amount + ' ' + (formData.currency || 'CZK') + '\n';
    if (formData.currency) d += 'Měna: ' + formData.currency + '\n';
    if (formData.drawdownDate) d += 'Datum čerpání: ' + formData.drawdownDate + '\n';
    if (formData.drawdownType) d += 'Typ čerpání: ' + formData.drawdownType + '\n';
    if (formData.interest) d += 'Úroková sazba: ' + formData.interest + ' % p.a.\n';
    if (formData.interestPayment) d += 'Placení úroků: ' + formData.interestPayment + '\n';
    if (formData.maturity) d += 'Doba splatnosti: ' + formData.maturity + ' ' + (formData.maturityUnit || 'let') + '\n';
    if (formData.maturityDate) d += 'Datum splatnosti (Den konečné splatnosti): ' + formData.maturityDate + '\n';
    if (formData.earlyRepayment) d += 'Předčasné splacení: ' + formData.earlyRepayment + '\n';

    d += '\n=== POPLATKY ===\n';
    if (formData.originationFee) {
        var currency = formData.currency || 'CZK';
        if (formData.originationFeeType === 'percent') {
            // Spočítáme absolutní částku, pokud máme amount — AI tak dostane
            // hodnotu, kterou rovnou dosadí do smlouvy. Jinak by AI musela
            // počítat sama a často by udělala chybu.
            var amountNum = parseCzNumber(formData.amount);
            var feeNum = parseCzNumber(formData.originationFee);
            if (amountNum > 0 && !isNaN(feeNum)) {
                var absoluteFee = (amountNum * feeNum) / 100;
                d += 'Poplatek za sjednání: ' + formData.originationFee + ' % z výše úvěru (' + formatCzAmount(amountNum) + ' ' + currency + ') = ' + formatCzAmount(absoluteFee) + ' ' + currency + '\n';
            } else {
                d += 'Poplatek za sjednání: ' + formData.originationFee + ' %\n';
            }
        } else {
            d += 'Poplatek za sjednání: ' + formData.originationFee + ' ' + currency + '\n';
        }
    }
    if (formData.otherCosts) d += 'Ostatní náklady: ' + formData.otherCosts + '\n';

    d += '\n=== ZAJIŠTĚNÍ ===\n';
    if (formData.collateralValue) d += 'Hodnota zajištění: ' + formData.collateralValue + '\n';
    if (formData.collateralItems) d += 'Položky zajištění:\n' + formData.collateralItems + '\n';

    d += '\n=== DODATEČNÉ ÚDAJE ===\n';
    if (formData.representativeName) d += 'Jednatel/zástupce dlužníka: ' + formData.representativeName + ', funkce: ' + (formData.representativeRole || '') + '\n';
    if (formData.contactName) d += 'Kontaktní osoba: ' + formData.contactName + ', tel: ' + (formData.contactPhone || '') + ', e-mail: ' + (formData.contactEmail || '') + '\n';
    if (formData.deliveryAddress) d += 'Adresa pro doručování: ' + formData.deliveryAddress + '\n';
    if (formData.borrowerAccount) d += 'Účet dlužníka: ' + formData.borrowerAccount + ' u ' + (formData.borrowerBank || '') + '\n';
    if (formData.lenderAccount) d += 'Účet věřitele: ' + formData.lenderAccount + ' u ' + (formData.lenderBank || '') + '\n';
    if (formData.appraisalRef) d += 'Odhad: ' + formData.appraisalRef + '\n';
    var appraiser = formData.appraiser || formData.appraisalAuthor;
    if (appraiser) d += 'Odhadce: ' + appraiser + '\n';
    if (formData.appraisalDate) d += 'Datum odhadu: ' + formData.appraisalDate + '\n';
    if (formData.appraisalValue) d += 'Hodnota z odhadu: ' + formData.appraisalValue + '\n';
    if (formData.existingPledge) d += 'Existující zástavní právo k výmazu: ' + formData.existingPledge + '\n';
    if (formData.propertyOwners) d += 'Vlastníci nemovitostí: ' + formData.propertyOwners + '\n';
    if (formData.defaultInterest) d += 'Úrok z prodlení: ' + formData.defaultInterest + ' % p.a.\n';
    if (formData.accelerationPenalty) d += 'Smluvní pokuta při zesplatnění: ' + formData.accelerationPenalty + ' %\n';
    if (formData.breachPenalty) d += 'Smluvní pokuta za porušení: ' + formData.breachPenalty + ' %\n';
    if (formData.signDate) d += 'Datum podpisu: ' + formData.signDate + '\n';
    if (formData.signPlace) d += 'Místo podpisu: ' + formData.signPlace + '\n';
    return d;
}

function buildLoanDocPreviousReplacementsSection(previousReplacements) {
    if (!Array.isArray(previousReplacements) || previousReplacements.length === 0) return '';
    var capped = previousReplacements.slice(0, 100);
    var section = '\n\n=== JIŽ APLIKOVANÉ ZMĚNY V PASS 1 (NEDUPLIKOVAT) ===\n';
    capped.forEach(function (r, idx) {
        if (r && typeof r.find === 'string' && typeof r.replace === 'string') {
            var f = r.find.length > 80 ? r.find.substring(0, 80) + '…' : r.find;
            var rep = r.replace.length > 80 ? r.replace.substring(0, 80) + '…' : r.replace;
            if (rep === '') rep = '(SMAZÁNO)';
            section += (idx + 1) + '. "' + f + '" → "' + rep + '"\n';
        }
    });
    if (previousReplacements.length > 100) {
        section += '… a dalších ' + (previousReplacements.length - 100) + ' změn.\n';
    }
    return section;
}

function buildLoanDocUserContent(templateName, dataDescription, previousReplacements, templateText) {
    return 'Vyplň následující šablonu smlouvy (' + (templateName || 'smlouva') + ') poskytnutými daty.\n\n' +
        dataDescription +
        buildLoanDocPreviousReplacementsSection(previousReplacements) + '\n\n' +
        '=== ŠABLONA SMLOUVY ===\n\n' +
        (templateText || '').substring(0, 50000);
}

// Speciální varianta promptu pro MANUÁLNÍ COPY-PASTE do web AI (ChatGPT.com /
// Claude.ai s file uploadem). Web AI má Code Interpreter / Python sandbox, umí
// pracovat s celým DOCX a vrátit upravený soubor — takže instrukce jsou jiné než
// pro naše API volání (které vrací jen JSON s find/replace páry).
//
// Klíčové rozdíly oproti API promptu:
// - Vrátit UPRAVENÝ .docx (file attachment), ne JSON
// - ZACHOVAT formátování (styly, headings, číslování, fonty, tabulky)
// - Před výstupem CELÉ znovu zreviduje (smlouva půjde rovnou klientovi)
function buildLoanDocManualUserContent(templateName, dataDescription, templateText) {
    return 'Mám historickou šablonu úvěrové smlouvy ProfiLend (' + (templateName || 'smlouva') + ') z minulého dealu. Potřebuju ji upravit pro nového klienta podle dat níže. Šablona JE PŘEDVYPLNĚNÁ konkrétními údaji z minulé smlouvy (jména, IČO, sídla, částky, datumy, čísla LV, čísla řízení katastru, jména bank apod.).\n\n' +
        '⚠ TENTO DOKUMENT PŮJDE ROVNOU KLIENTOVI — musí být precizní, profesionální a dávat smysl jako celek.\n\n' +
        '=== TVŮJ POSTUP ===\n' +
        '1. PŘEČTI CELOU šablonu (smlouvu) a pochop strukturu, strany, zajištění, přílohy, kontext.\n' +
        '2. NAHRAĎ konkrétní údaje z minulého dealu novými hodnotami z DATA níže (jméno klienta, IČO, sídlo, částka, úrok, splatnost, datumy, čísla LV, kontakty, podpisové údaje).\n' +
        '3. SMAŽ irrelevantní pasáže pro nový deal:\n' +
        '   - Přílohy o nemovitostech, které nový klient v collateralItems NEMÁ\n' +
        '   - Klauzule o ručiteli / vinkulaci / starém zástavním právu, pokud DATA odpovídající údaj nemá\n' +
        '   - Čísla řízení katastru (V-XXXX/YYYY-ZZZ), pokud DATA neuvádí nové\n' +
        '   - Staré zástavní banky (Raiffeisenbank, KB, ČSOB apod.), pokud DATA nemá existingPledge\n' +
        '   - Historické datumy úvěrových komisí, verze šablony, schvalovací podpisy\n' +
        '4. PŘEFORMULUJ klauzule, které neodpovídají novému dealu (např. čerpání ve tranších vs jednorázové, poplatek z čerpané částky vs paušál).\n' +
        '5. AKTUALIZUJ křížové odkazy — pokud smažeš Přílohu 1C, smaž i odkazy "viz Příloha 1C" v hlavním textu.\n' +
        '6. KONZISTENCE — stejná hodnota se obvykle opakuje na mnoha místech (jméno klienta 20×, částka 5×). Zachyť VŠECHNY výskyty napříč dokumentem.\n\n' +
        '=== FINÁLNÍ REVIZE (POVINNÁ PŘED VÝSTUPEM) ===\n' +
        'Než mi vrátíš upravený dokument, projdi ho ZNOVU jako právník dělající due diligence:\n' +
        '- Dává smysl jako celek pro NOVÝ deal? Nezůstaly tam logické rozpory?\n' +
        '- Odkazují všechny "viz článek X" / "dle Přílohy Y" na existující články/přílohy?\n' +
        '- Vyskytuje se kdekoli v dokumentu staré jméno klienta / staré IČO / staré LV / staré číslo řízení?\n' +
        '- Pokud jsi smazala přílohu, zmizely i všechny její reference z hlavního textu?\n' +
        '- Sedí čerpání a poplatky popsané v textu s parametry z DATA?\n' +
        '- Pokud jsi smazala klauzuli o ručiteli/vinkulaci, není někde jinde v textu reference na ručitele/vinkulaci?\n\n' +
        '=== ZACHOVÁNÍ FORMÁTOVÁNÍ ===\n' +
        'POVINNĚ ZACHOVEJ vizuální formátování šablony — styly, headings, číslování článků, odsazení, fonty, tabulky, podpisové bloky. Výsledný DOCX musí vypadat IDENTICKY se šablonou (jen s upraveným obsahem). NEVRACEJ obyčejný text — vrať upravený .docx (file attachment).\n\n' +
        dataDescription + '\n\n' +
        '=== ŠABLONA (PLAIN TEXT EXTRAKT — originál mám v .docx file uploadu) ===\n\n' +
        (templateText || '').substring(0, 50000);
}

// =============================================
// POST /api/generate-loan-doc/preview — vrátí sestavený prompt BEZ volání AI.
// Žádná API náklady. Frontend "Náhled promptu" má tímto identický prompt
// s tím, co AI reálně dostane v /api/generate-loan-doc. Plus Martin může
// prompt zkopírovat a paste do externí ChatGPT/Claude (manuální fallback).
// =============================================
app.post('/api/generate-loan-doc/preview', function (req, res) {
    var formData = (req.body && req.body.formData) || {};
    var templateText = (req.body && req.body.templateText) || '';
    var templateName = (req.body && req.body.templateName) || '';
    var previousReplacements = (req.body && Array.isArray(req.body.previousReplacements)) ? req.body.previousReplacements : null;
    var passNumber = (previousReplacements && previousReplacements.length > 0) ? 2 : 1;

    var systemPrompt = buildLoanDocSystemPrompt(templateName, passNumber);
    var dataDescription = buildLoanDocDataDescription(formData);
    var userContent = buildLoanDocUserContent(templateName, dataDescription, previousReplacements, templateText);
    // Speciální variant pro manuální copy-paste do web AI (ChatGPT.com / Claude.ai)
    // — vyžaduje upraveno DOCX jako file attachment, zachování formátování,
    // finální revizi před výstupem (smlouva jde rovnou klientovi).
    var manualUserContent = buildLoanDocManualUserContent(templateName, dataDescription, templateText);

    return res.status(200).json({
        success: true,
        systemPrompt: systemPrompt,
        dataDescription: dataDescription,
        userContent: userContent,
        manualUserContent: manualUserContent,
        pass: passNumber,
        templateTextWasTruncated: (templateText || '').length > 50000,
        templateTextOriginalLength: (templateText || '').length
    });
});

// =============================================
// POST /api/generate-loan-doc — Loan document generation
// Claude/OpenAI fills in a contract template with provided data
// No timeout limit — complex templates may take 2-3 minutes
// =============================================
app.post('/api/generate-loan-doc', async function (req, res) {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
    }

    var templateText = req.body && req.body.templateText;
    var formData = req.body && req.body.formData;
    var templateName = req.body && req.body.templateName;
    // Two-pass režim: previousReplacements = co už bylo aplikováno v Pass 1.
    // Když má položky, prompt řekne AI 'tohle už je vyřízeno, najdi co ZBYLO'.
    var previousReplacements = (req.body && Array.isArray(req.body.previousReplacements)) ? req.body.previousReplacements : null;
    var passNumber = (previousReplacements && previousReplacements.length > 0) ? 2 : 1;

    if (!templateText || templateText.trim().length < 50) {
        return res.status(400).json({ error: 'Šablona je prázdná nebo příliš krátká.' });
    }

    if (!formData) {
        return res.status(400).json({ error: 'Chybí data pro vyplnění smlouvy.' });
    }

    var client = new Anthropic({ apiKey: apiKey });

    // Sestavení promptu — single source of truth (sdíleno s /preview endpointem).
    var systemPrompt = buildLoanDocSystemPrompt(templateName, passNumber);
    var dataDescription = buildLoanDocDataDescription(formData);
    var userContent = buildLoanDocUserContent(templateName, dataDescription, previousReplacements, templateText);

    console.log('Loan doc generation request:', { templateName: templateName, pass: passNumber, templateLength: templateText.length, dataFields: Object.keys(formData).length, previouslyApplied: previousReplacements ? previousReplacements.length : 0 });

    // Helper: try to extract JSON from Claude response text
    function tryParseJSON(responseText) {
        try { return JSON.parse(responseText.trim()); } catch (e) { }
        var codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
            try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) { }
        }
        var startObj = responseText.indexOf('{');
        if (startObj !== -1) {
            try { return JSON.parse(responseText.substring(startObj, responseText.lastIndexOf('}') + 1)); } catch (e) { }
        }
        return null;
    }

    // Provider dispatch — Claude (default) nebo OpenAI (GPT-4o).
    // Martin má obě API aktivní, dle typu šablony volí lepší model.
    var providerRaw = (req.body && req.body.provider) || 'claude';
    var provider = (providerRaw === 'openai' || providerRaw === 'chatgpt' || providerRaw === 'gpt') ? 'openai' : 'claude';

    try {
        var rawText = '';
        var modelUsed = '';
        var usage = null;

        if (provider === 'openai') {
            var openaiKey = process.env.OPENAI_API_KEY;
            if (!openaiKey) {
                return res.status(500).json({ error: 'OPENAI_API_KEY není nastavený na Railway.' });
            }
            if (typeof OpenAI === 'undefined' || !OpenAI) {
                return res.status(500).json({ error: 'OpenAI SDK není dostupné na serveru.' });
            }
            var openaiClient = new OpenAI({ apiKey: openaiKey });
            modelUsed = 'gpt-4o';
            var completion = await openaiClient.chat.completions.create({
                model: modelUsed,
                temperature: 0,
                max_tokens: 16384,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            });
            rawText = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
            usage = {
                input_tokens: completion.usage && completion.usage.prompt_tokens,
                output_tokens: completion.usage && completion.usage.completion_tokens
            };
        } else {
            // Sonnet 4.6 je nejlepší dostupný balanced model k 2026 (lepší než
            // claude-sonnet-4-20250514 z května 2025). Opus 4.7 by byl chytřejší,
            // ale pomalejší a dražší — pro vyplňování smluv stačí Sonnet.
            modelUsed = 'claude-sonnet-4-6';
            var message = await client.messages.create({
                model: modelUsed,
                max_tokens: 16384,
                temperature: 0,
                messages: [
                    { role: 'user', content: userContent },
                    { role: 'assistant', content: '{' }
                ],
                system: systemPrompt
            });
            rawText = '{' + message.content[0].text;
            usage = {
                input_tokens: message.usage.input_tokens,
                output_tokens: message.usage.output_tokens
            };
        }

        console.log('Loan doc generation (' + provider + '/' + modelUsed + ') response length:', rawText.length);

        var parsed = tryParseJSON(rawText);

        if (parsed && parsed.replacements && Array.isArray(parsed.replacements)) {
            return res.status(200).json({
                success: true,
                replacements: parsed.replacements,
                notes: parsed.notes || null,
                provider: provider,
                model: modelUsed,
                pass: passNumber,
                usage: usage
            });
        } else {
            console.error('Invalid response format from ' + provider + ':', rawText.substring(0, 500));
            return res.status(200).json({
                success: false,
                error: (provider === 'openai' ? 'ChatGPT' : 'Claude') + ' nevrátil platný formát nahrazení. Zkuste to znovu.',
                provider: provider,
                model: modelUsed,
                raw: rawText.substring(0, 1000)
            });
        }
    } catch (err) {
        console.error('API error (loan doc, ' + provider + '):', err.message);
        var errorMsg = err.message || 'Neznámá chyba';
        var statusCode = 500;
        if (err.status === 401) { errorMsg = 'Neplatný API klíč (' + provider + ').'; statusCode = 401; }
        else if (err.status === 429) { errorMsg = 'Příliš mnoho požadavků na ' + provider + '. Počkejte chvíli.'; statusCode = 429; }
        else if (err.status === 529 || err.status === 503) { errorMsg = (provider === 'openai' ? 'ChatGPT' : 'Claude') + ' API je přetížené.'; statusCode = 503; }
        return res.status(statusCode).json({ error: errorMsg, provider: provider });
    }
});

// =============================================
// POST /api/marketing/generate — Marketing Agent text + image generation
// Uses Gemini 2.5 Flash (free tier) for text generation
// Uses Gemini Imagen for image generation (optional)
// =============================================
var { GoogleGenerativeAI } = require('@google/generative-ai');
var OpenAI;
try { OpenAI = require('openai'); } catch(e) { console.warn('openai package not available, image generation disabled'); }

// Debug endpoint - list available Gemini models
app.get('/api/marketing/models', async function (req, res) {
    var geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not set.' });
    }
    try {
        var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + geminiKey);
        var data = await response.json();
        var models = (data.models || []).filter(function(m) {
            return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
        }).map(function(m) {
            return { name: m.name, displayName: m.displayName, methods: m.supportedGenerationMethods };
        });
        res.json({ models: models });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================
// Marketing Agent — Brand Context Layer (Spec 1)
// Builds structured prompts from a complete brand preset.
// Replaces the previous flat-field, partly-hardcoded approach.
// =============================================

// Normalize old (flat) request body into a brandPreset shape (backwards compat).
// Old format: { prompt, brandDNA: {styleMain, antiPatterns, colors}, visualHook, ... }
// New format: { brandPreset: {schemaVersion, slug, displayName, identity, voice, visual, sources}, brief, options }
function normalizeImageRequest(body) {
    if (body.brandPreset && body.brandPreset.schemaVersion >= 2) {
        return {
            mode: 'v2',
            brandPreset: body.brandPreset,
            brief: body.brief || { topic: body.prompt || '', visualHook: body.visualHook || '' },
            options: body.options || { model: body.imageModel, size: body.size, quality: body.quality },
            referenceImages: body.referenceImages || []
        };
    }
    // Legacy: synthesize a minimal brandPreset from flat fields.
    var dna = body.brandDNA || {};
    return {
        mode: 'legacy',
        brandPreset: {
            schemaVersion: 1,
            slug: 'legacy',
            displayName: 'ProfiLend',
            identity: {
                shortDescription: 'Czech B2B private debt — secured real estate loans',
                colors: dna.colors || {},
                typography: { primaryFont: 'DM Sans', fallback: 'Inter, sans-serif' }
            },
            voice: { tone: '', bannedWords: [], approvedCTAs: [] },
            visual: {
                styleMain: dna.styleMain || '',
                antiPatterns: dna.antiPatterns || '',
                qualityChecklist: []
            }
        },
        brief: { topic: body.prompt || '', visualHook: body.visualHook || '' },
        options: { model: body.imageModel, size: body.size, quality: body.quality },
        referenceImages: body.referenceImages || []
    };
}

// Build a flat brand context object usable by prompt builders.
function buildBrandContext(brandPreset, brief) {
    var identity = brandPreset.identity || {};
    var voice = brandPreset.voice || {};
    var visual = brandPreset.visual || {};
    var colors = identity.colors || {};
    return {
        brandName: brandPreset.displayName || brandPreset.slug || 'Brand',
        shortDescription: identity.shortDescription || '',
        audienceShort: identity.audienceShort || '',
        languagePrimary: voice.languagePrimary || 'cs',
        tone: voice.tone || '',
        bannedWords: Array.isArray(voice.bannedWords) ? voice.bannedWords : [],
        approvedCTAs: Array.isArray(voice.approvedCTAs) ? voice.approvedCTAs : [],
        styleMain: visual.styleMain || '',
        antiPatterns: visual.antiPatterns || '',
        qualityChecklist: Array.isArray(visual.qualityChecklist) ? visual.qualityChecklist : (visual.qualityChecklist ? [visual.qualityChecklist] : []),
        layoutTemplates: visual.layoutTemplates || {},
        colors: {
            primary: colors.primary || colors.navy || '#0C2340',
            accent: colors.accent || colors.teal || '#00B4D8',
            background: colors.background || colors.gray || colors.white || '#F0F4F8',
            muted: colors.muted || '#94A3B8'
        },
        typography: identity.typography || { primaryFont: 'DM Sans', fallback: 'Inter, sans-serif' },
        brief: brief || {}
    };
}

function buildImageSystemPrompt(ctx) {
    var lines = [];
    lines.push('You are a senior brand designer producing a social-media post image for ' + ctx.brandName +
        (ctx.shortDescription ? ' (' + ctx.shortDescription + ')' : '') + '.');
    if (ctx.audienceShort) lines.push('Audience: ' + ctx.audienceShort + '.');
    lines.push('Your output must look as if it belongs to this brand\'s existing visual identity — never generic stock.');
    if (ctx.qualityChecklist.length > 0) {
        lines.push('\nQUALITY CHECKLIST (the result must satisfy each):');
        ctx.qualityChecklist.forEach(function (q, i) { lines.push((i + 1) + '. ' + q); });
    }
    lines.push('\nRULES:');
    lines.push('- Never include any logo or brand text — the logo will be added later as overlay.');
    lines.push('- Sans-serif typography only.');
    lines.push('- Maximum 2 font weights (bold for headlines, regular for body).');
    return lines.join('\n');
}

function buildImageUserPrompt(ctx) {
    var brief = ctx.brief || {};
    var parts = [];
    // Defensive truncation: if a caller sends a pre-assembled prompt as `topic`, it would blow
    // past promptMaxLength once we append brand context. Cap brief fields to safe lengths.
    function trim(s, max) { s = (s || '').toString(); return s.length > max ? s.substring(0, max) + '…' : s; }
    var topicShort = trim(brief.topic, 600);
    var creativeShort = trim(brief.creativeBrief, 600);
    parts.push('Create a professional social-media post image for ' + ctx.brandName + '.');
    if (topicShort) parts.push('Topic: ' + topicShort);
    if (brief.visualHook) {
        parts.push('Include this short text as prominent bold sans-serif typography (focal point of the composition): "' + trim(brief.visualHook, 200) + '".');
    }
    if (creativeShort && creativeShort !== topicShort) parts.push('Creative concept: ' + creativeShort);
    var layoutKey = brief.layout || brief.layoutKey;
    if (layoutKey && ctx.layoutTemplates[layoutKey]) {
        parts.push('LAYOUT TEMPLATE (follow precisely): ' + trim(ctx.layoutTemplates[layoutKey], 700));
    }
    if (ctx.styleMain) parts.push('BRAND VISUAL RULES: ' + trim(ctx.styleMain, 900));
    parts.push('EXACT COLORS: primary ' + ctx.colors.primary + ' (headings, dark surfaces), accent ' + ctx.colors.accent +
        ' (CTAs, lines, highlights), background ' + ctx.colors.background + ', muted text ' + ctx.colors.muted +
        '. Do not introduce other colors.');
    parts.push('TYPOGRAPHY: Use ' + (ctx.typography.primaryFont || 'DM Sans') + ' or ' + (ctx.typography.fallback || 'Inter, sans-serif') +
        ' only. Maximum 2 font weights (bold for headlines, regular for body).');
    if (ctx.tone) parts.push('VISUAL MOOD: ' + trim(ctx.tone, 200) + '.');
    if (ctx.bannedWords.length > 0) {
        parts.push('FORBIDDEN words and concepts: ' + ctx.bannedWords.slice(0, 20).join(', ') + '.');
    }
    if (ctx.antiPatterns) parts.push('ANTI-PATTERNS (never include): ' + trim(ctx.antiPatterns, 600));
    var format = brief.format || '1:1';
    parts.push('Format: ' + format + '. Clean scannable layout, generous whitespace, rounded cards, thin accent lines, simple linear icons. No 3D, no neon, no stock-photo cliches, no aggressive sales copy.');
    var assembled = parts.join('\n\n');
    // Hard cap as last-resort safety: if still over the limit, drop the longest section.
    var MAX = MARKETING_CONFIG.promptMaxLength - 200; // headroom for vision refinement step
    if (assembled.length > MAX) {
        console.warn('[marketing/image] prompt exceeded ' + MAX + ' chars (' + assembled.length + '); truncating');
        assembled = assembled.substring(0, MAX) + '…';
    }
    return assembled;
}

function buildTextSystemPrompt(ctx) {
    var lines = [];
    lines.push('You are a marketing copywriter for ' + ctx.brandName +
        (ctx.shortDescription ? ' (' + ctx.shortDescription + ')' : '') + '.');
    if (ctx.audienceShort) lines.push('Audience: ' + ctx.audienceShort + '.');
    lines.push('Primary language: ' + (ctx.languagePrimary === 'en' ? 'English' : 'Czech') + '. Always respond in this language.');
    if (ctx.tone) lines.push('TONE: ' + ctx.tone + '.');
    if (ctx.bannedWords.length > 0) {
        lines.push('BANNED WORDS — must never appear: ' + ctx.bannedWords.join(', ') + '.');
    }
    if (ctx.approvedCTAs.length > 0) {
        lines.push('APPROVED CTAs — use only one of these (verbatim): ' + ctx.approvedCTAs.join(' | ') + '.');
    }
    if (ctx.styleMain) lines.push('BRAND VOICE/STYLE NOTES: ' + ctx.styleMain.substring(0, 1500));
    lines.push('OUTPUT: write naturally, like a human professional, never AI-flavored phrases. No "In today\'s world", no "Did you know that".');
    return lines.join('\n');
}

function validatePromptLength(prompt) {
    if (!prompt || typeof prompt !== 'string') return { ok: false, reason: 'Prompt is empty.' };
    if (prompt.length < 10) return { ok: false, reason: 'Prompt is too short (min 10 chars).' };
    if (prompt.length > MARKETING_CONFIG.promptMaxLength) {
        return { ok: false, reason: 'Prompt exceeds ' + MARKETING_CONFIG.promptMaxLength + ' chars (got ' + prompt.length + ').' };
    }
    return { ok: true };
}

// Compress a base64 reference image to MARKETING_CONFIG.referenceCompressionPx square,
// returning a new data URL. If sharp is unavailable, returns the input unchanged.
async function compressReferenceImage(dataUrlOrBase64) {
    if (!sharp) return dataUrlOrBase64;
    try {
        var raw = dataUrlOrBase64;
        var mime = 'image/png';
        if (raw.indexOf('data:') === 0) {
            var commaIdx = raw.indexOf(',');
            var header = raw.substring(0, commaIdx);
            var mimeMatch = header.match(/data:([^;]+)/);
            if (mimeMatch) mime = mimeMatch[1];
            raw = raw.substring(commaIdx + 1);
        }
        var buf = Buffer.from(raw, 'base64');
        var px = MARKETING_CONFIG.referenceCompressionPx;
        var out = await sharp(buf).resize(px, px, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
        return 'data:image/jpeg;base64,' + out.toString('base64');
    } catch (e) {
        console.warn('[marketing] reference compression failed, sending uncompressed:', e.message);
        return dataUrlOrBase64;
    }
}

// =============================================
// POST /api/marketing/generate-image
// Supports both legacy flat body and v2 { brandPreset, brief, options } body.
// =============================================
app.post('/api/marketing/generate-image', async function (req, res) {
    var openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not set. Add it in Railway Variables.' });
    }
    if (!OpenAI) {
        return res.status(500).json({ error: 'openai package not installed.' });
    }

    var normalized = normalizeImageRequest(req.body || {});
    var brandPreset = normalized.brandPreset;
    var brief = normalized.brief;
    var options = normalized.options || {};
    var referenceImages = normalized.referenceImages || [];

    var allowedImageModels = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'];
    var imageModel = allowedImageModels.indexOf(options.model) !== -1 ? options.model : MARKETING_CONFIG.imageModelDefault;
    var size = options.size || '1024x1024';
    var quality = options.quality || MARKETING_CONFIG.imageQualityDefault;

    var ctx = buildBrandContext(brandPreset, brief);
    var systemPrompt = buildImageSystemPrompt(ctx);
    var userPrompt = buildImageUserPrompt(ctx);

    if (!brief.topic && !userPrompt) {
        return res.status(400).json({ error: 'Brief topic is required.' });
    }

    try {
        var openai = new OpenAI({ apiKey: openaiKey });
        var finalPrompt = userPrompt;

        // Vision refinement when references are provided
        if (referenceImages.length > 0) {
            console.log('[marketing/image] vision refine: ' + referenceImages.length + ' refs, brand=' + ctx.brandName);
            try {
                // Compress references to keep token usage and request size down
                var compressedRefs = [];
                for (var ci = 0; ci < referenceImages.length; ci++) {
                    compressedRefs.push(await compressReferenceImage(referenceImages[ci]));
                }
                var visionContent = [{
                    type: 'text',
                    text: systemPrompt + '\n\nCREATIVE BRIEF (image must communicate this):\n' + userPrompt +
                        '\n\nINSTRUCTIONS:\n- Analyze the reference images for exact visual patterns (colors, layout, typography, spacing).\n' +
                        '- Cross-reference with the rules above.\n' +
                        '- Produce a single PRECISE technical prompt for an image-generation model.\n' +
                        '- Output ONLY the prompt, in English, 300-500 words.\n' +
                        '- Be specific: exact HEX colors, positions (top-left/center/bottom), proportions, typography.\n' +
                        '- The result must look like it belongs in the same feed as these references.'
                }];
                for (var ri = 0; ri < compressedRefs.length; ri++) {
                    var imgData = compressedRefs[ri];
                    visionContent.push({
                        type: 'image_url',
                        image_url: { url: imgData.indexOf('data:') === 0 ? imgData : 'data:image/png;base64,' + imgData, detail: 'high' }
                    });
                }
                var visionResponse = await openai.chat.completions.create({
                    model: MARKETING_CONFIG.visionModel,
                    messages: [{ role: 'user', content: visionContent }],
                    max_tokens: MARKETING_CONFIG.visionMaxTokens,
                    temperature: MARKETING_CONFIG.visionTemperature
                });
                if (visionResponse.choices && visionResponse.choices[0] && visionResponse.choices[0].message) {
                    finalPrompt = visionResponse.choices[0].message.content;
                    console.log('[marketing/image] vision-refined prompt (' + finalPrompt.length + ' chars)');
                }
            } catch (visionErr) {
                console.error('[marketing/image] vision refine failed, falling back to user prompt:', visionErr.message);
            }
        }

        // Validate length before sending to image model
        var validation = validatePromptLength(finalPrompt);
        if (!validation.ok) {
            return res.status(400).json({ error: 'Prompt validation failed: ' + validation.reason, debug: { systemPrompt: systemPrompt, userPrompt: userPrompt, finalPrompt: finalPrompt } });
        }

        // Quality mapping
        var effectiveQuality = quality;
        if (imageModel === 'gpt-image-1') {
            if (quality === 'standard') effectiveQuality = 'medium';
            else if (quality === 'hd') effectiveQuality = 'high';
        }

        var genParams = { model: imageModel, prompt: finalPrompt, n: 1, size: size, quality: effectiveQuality };
        if (imageModel === 'dall-e-3') genParams.response_format = 'b64_json';

        var response = await openai.images.generate(genParams);
        var imageData = response.data[0];

        var costEstimate = (MARKETING_CONFIG.costPerImageGen[imageModel] || 0) +
            (referenceImages.length * MARKETING_CONFIG.costPerVisionImage);

        res.json({
            success: true,
            image: imageData.b64_json,
            revisedPrompt: imageData.revised_prompt || null,
            model: imageModel,
            usedReferenceImages: referenceImages.length > 0,
            debug: {
                systemPrompt: systemPrompt,
                userPrompt: userPrompt,
                finalPrompt: finalPrompt,
                costEstimate: Number(costEstimate.toFixed(4)),
                requestMode: normalized.mode
            }
        });
    } catch (err) {
        console.error('OpenAI image error:', err.message);
        var errorMsg = err.message || 'Unknown error';
        var statusCode = 500;
        if (err.message && err.message.includes('billing')) {
            errorMsg = 'OpenAI account needs billing setup. Visit platform.openai.com/billing';
            statusCode = 402;
        } else if (err.message && err.message.includes('rate')) {
            errorMsg = 'Rate limit exceeded. Try again in a moment.';
            statusCode = 429;
        }
        res.status(statusCode).json({ error: errorMsg });
    }
});

app.post('/api/marketing/generate', async function (req, res) {
    var openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not set. Add it in Railway → Variables.' });
    }
    if (!OpenAI) {
        return res.status(500).json({ error: 'openai package not installed.' });
    }

    var body = req.body || {};

    // ===== Dual-format support (Spec 1) =====
    // If body has brandPreset (schemaVersion>=2), pull legacy fields from it for compat
    // with the rest of this handler (which still uses flat variables internally).
    var v2BrandPreset = (body.brandPreset && body.brandPreset.schemaVersion >= 2) ? body.brandPreset : null;
    var requestMode = v2BrandPreset ? 'v2' : 'legacy';
    if (v2BrandPreset) {
        var ident = v2BrandPreset.identity || {};
        var voice2 = v2BrandPreset.voice || {};
        var visual2 = v2BrandPreset.visual || {};
        var c2 = ident.colors || {};
        body.brandId = body.brandId || v2BrandPreset.slug;
        body.brandName = body.brandName || v2BrandPreset.displayName;
        body.customBannedWords = body.customBannedWords || voice2.bannedWords || [];
        body.customCTAs = body.customCTAs || voice2.approvedCTAs || [];
        body.customTone = body.customTone || (voice2.tone ? [voice2.tone] : []);
        body.brandColors = body.brandColors || {
            navy: c2.primary || c2.navy, teal: c2.accent || c2.teal,
            white: c2.background || c2.white, gray: c2.muted || c2.gray,
            primary: c2.primary, secondary: c2.muted
        };
        body.brandStyleDesc = body.brandStyleDesc || visual2.styleMain || '';
        body.brandLayoutDescs = body.brandLayoutDescs || visual2.layoutTemplates || {};
        body.brandDNAFull = body.brandDNAFull || {
            styleMain: visual2.styleMain || '',
            antiPatterns: visual2.antiPatterns || ''
        };
    }

    var channel = body.channel || 'linkedin';
    var audience = body.audience || 'owners';
    var pillar = body.pillar || 'product';
    var postType = body.postType || 'social-post';
    var goal = body.goal || 'awareness';
    var theme = body.theme || (body.brief && body.brief.topic);
    var tone = body.tone || 'factual';
    var emojiLevel = body.emojiLevel || 'few';
    var hashtagLevel = body.hashtagLevel || 'few';
    var batchCount = Math.min(Math.max(parseInt(body.batchCount) || 1, 1), 5);
    // Reference posts from Google Drive (for style consistency)
    var referencePosts = Array.isArray(body.referencePosts) ? body.referencePosts.slice(0, 5) : [];
    var brandId = typeof body.brandId === 'string' ? body.brandId : 'profilend';
    var brandName = typeof body.brandName === 'string' ? body.brandName : 'ProfiLend';
    // Custom settings from frontend (user-configured in Nastavení)
    var customSystemPrompt = typeof body.customSystemPrompt === 'string' ? body.customSystemPrompt.trim() : '';
    var customBannedWords = Array.isArray(body.customBannedWords) ? body.customBannedWords : [];
    var customCTAs = Array.isArray(body.customCTAs) ? body.customCTAs : [];
    var customTone = Array.isArray(body.customTone) ? body.customTone : [];
    var generateImage = body.generateImage || false;
    var imageSettings = body.imageSettings || {};
    // Complete brand context from frontend
    var brandAudiences = Array.isArray(body.brandAudiences) ? body.brandAudiences : [];
    var brandPillars = body.brandPillars || {};
    var brandColors = body.brandColors || {};
    var brandStyleDesc = typeof body.brandStyleDesc === 'string' ? body.brandStyleDesc.trim() : '';
    var brandLayoutDescs = body.brandLayoutDescs || {};
    // Výběr OpenAI modelu pro text — default gpt-4o-mini, povolené i gpt-4o
    var brandDNAFull = body.brandDNAFull || {};
    var allowedTextModels = ['gpt-4o-mini', 'gpt-4o'];
    var textModel = allowedTextModels.indexOf(body.textModel) !== -1 ? body.textModel : 'gpt-4o-mini';

    if (!theme || theme.trim().length < 3) {
        return res.status(400).json({ error: 'Téma příspěvku je povinné (min. 3 znaky).' });
    }

    var openai = new OpenAI({ apiKey: openaiKey });

    // Build knowledge context from brand settings (dynamic, not hardcoded)
    var knowledgeBase = 'ZNALOSTNÍ BÁZE — ' + brandName + ':\n';
    
    // Audiences from brand settings
    if (brandAudiences.length > 0) {
        knowledgeBase += 'CÍLOVÉ SKUPINY:\n';
        brandAudiences.forEach(function(a) { knowledgeBase += '- ' + a + '\n'; });
    }
    
    // Content pillars with percentages
    var pillarKeys = Object.keys(brandPillars);
    if (pillarKeys.length > 0) {
        knowledgeBase += 'OBSAHOVÉ PILÍŘE: ';
        knowledgeBase += pillarKeys.map(function(k) { return k + ' ' + brandPillars[k] + '%'; }).join(', ');
        knowledgeBase += '\n';
    }
    
    // Brand colors
    if (brandColors && Object.keys(brandColors).length > 0) {
        knowledgeBase += 'FIREMNÍ BARVY: ';
        var colorParts = [];
        if (brandColors.navy) colorParts.push('Navy ' + brandColors.navy);
        if (brandColors.teal) colorParts.push('Teal ' + brandColors.teal);
        if (brandColors.white) colorParts.push('White ' + brandColors.white);
        if (brandColors.gray) colorParts.push('Gray ' + brandColors.gray);
        if (brandColors.primary) colorParts.push('Primary ' + brandColors.primary);
        if (brandColors.secondary) colorParts.push('Secondary ' + brandColors.secondary);
        knowledgeBase += colorParts.join(', ') + '\n';
    }
    
    // Visual style description from Brand Kit
    if (brandStyleDesc) {
        knowledgeBase += 'VIZUÁLNÍ STYL ZNAČKY: ' + brandStyleDesc + '\n';
    }
    
    // Layout descriptions from Brand Kit
    var layoutParts = [];
    ['A','B','C','D','E'].forEach(function(key) {
        if (brandLayoutDescs[key]) layoutParts.push('Layout ' + key + ': ' + brandLayoutDescs[key]);
    });
    if (layoutParts.length > 0) {
        knowledgeBase += 'POPISY LAYOUTŮ PRO OBRÁZKY:\n' + layoutParts.join('\n') + '\n';
    }
    
    knowledgeBase += '\n';

    var channelRules = {
        instagram: 'Kanál Instagram: tykání, max 2200 znaků, emoji přípustné dle nastavení, hashtagy na konci.',
        linkedin: 'Kanál LinkedIn: vykání, profesionální tón, bez emoji pokud není výslovně povoleno, minimální hashtagy.',
        facebook: 'Kanál Facebook: mix tykání/vykání dle kontextu, delší posty OK, emotivnější tón.',
        youtube: 'Kanál YouTube: scénář pro krátké video, hook v prvních 3 sekundách, CTA na konci.'
    };

    var emojiRules = {
        none: 'ŽÁDNÉ emoji v celém textu.',
        few: 'Maximálně 1–2 emoji v celém příspěvku, pouze na klíčových místech.',
        moderate: 'Přiměřeně 2–3 emoji, pro zvýraznění klíčových bodů.'
    };

    // Brand-derived hashtag (lowercase, no diacritics, no spaces)
    var brandHashtag = '#' + (brandName || 'Brand').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
    var hashtagRules = {
        none: 'Žádné hashtagy.',
        few: 'Na konec příspěvku přidej 3–5 relevantních hashtagů (vždy ' + brandHashtag + ' jako první).',
        many: 'Na konec příspěvku přidej 5–8 hashtagů (vždy ' + brandHashtag + ' jako první).'
    };

    var goalMap = {
        awareness: 'Cíl: zvýšit povědomí o značce ' + brandName + '.',
        leads: 'Cíl: získat poptávky a leady — příspěvek musí motivovat k akci.',
        trust: 'Cíl: budovat důvěru a expertizu — ukázat odbornost.',
        educate: 'Cíl: edukovat publikum o tématech relevantních značce.',
        engagement: 'Cíl: zvýšit zapojení — otázky, ankety, interakce.',
        partners: 'Cíl: oslovit potenciální partnery a spolupracovníky.'
    };

    // Build system prompt — combine base instructions with custom settings
    // In v2 mode (brandPreset), prefer the structured brand-context-based base prompt.
    var baseSystemPrompt;
    if (v2BrandPreset && !customSystemPrompt) {
        var v2Ctx = buildBrandContext(v2BrandPreset, { topic: theme });
        baseSystemPrompt = buildTextSystemPrompt(v2Ctx);
    } else {
        baseSystemPrompt = customSystemPrompt || ('Jsi marketingový copywriter pro ' + brandName + '. Generuješ příspěvky na sociální sítě.');
    }
    
    // Custom banned words override or extend defaults
    var bannedWordsText = '';
    if (customBannedWords.length > 0) {
        bannedWordsText = '\nZAKÁZANÁ SLOVA (přesný seznam od klienta): ' + customBannedWords.join(', ') + '\n';
    }
    
    // Custom CTAs override defaults
    var ctaText = '';
    if (customCTAs.length > 0) {
        ctaText = '\nPOVOLENÁ CTA (používej POUZE tato): ' + customCTAs.join(' | ') + '\n';
    }
    
    // Custom tone
    var toneText = '';
    if (customTone.length > 0) {
        toneText = '\nTÓN KOMUNIKACE: ' + customTone.join(', ') + '\n';
    }
    
    // Reference posts for style consistency
    var referenceText = '';
    if (referencePosts.length > 0) {
        referenceText = '\n\nREFERENČNÍ PŘÍSPĚVKY — Toto jsou dříve schválené příspěvky. ' +
            'Zachovej jejich styl, tón a strukturu. Nový příspěvek musí vypadat jako by patřil do stejné série. ' +
            'NEKOPÍRUJ je doslovně, ale inspiruj se stylem, délkou a formátem:\n\n';
        referencePosts.forEach(function(post, idx) {
            // Truncate each post to max 500 chars to save tokens
            var truncated = post.length > 500 ? post.substring(0, 500) + '...' : post;
            referenceText += '--- Příspěvek ' + (idx + 1) + ' ---\n' + truncated + '\n\n';
        });
    }

    var systemPrompt = baseSystemPrompt + '\n\n' +
        knowledgeBase + '\n' +
        (channelRules[channel] || '') + '\n' +
        (emojiRules[emojiLevel] || '') + '\n' +
        (hashtagRules[hashtagLevel] || '') + '\n' +
        (goalMap[goal] || '') + '\n' +
        toneText + bannedWordsText + ctaText + referenceText + '\n' +
        'PRAVIDLA:\n' +
        '- Piš přirozeně, NE jako AI. Žádné fráze jako "V dnešní době", "Věděli jste, že".\n' +
        '- Nepoužívej zakázaná slova.\n' +
        '- Každý příspěvek MUSÍ obsahovat jedno z povolených CTA.\n' +
        '- Formát: hook (první věta chytlavá) → hlavní sdělení → CTA.\n' +
        '- DŮLEŽITÉ: Vrať POUZE platný JSON, žádný markdown.\n';

    // Visual type to Brand DNA template mapping
    var templateMap = {
        'typ1': 'D', 'typ2': 'A', 'typ3': 'A', 'typ4': 'B', 'typ5a': 'E', 'typ5b': 'E'
    };
    var selectedTemplate = templateMap[imageSettings.visualType] || 'D';
    var selectedLayoutDesc = brandDNAFull['layoutDesc' + selectedTemplate] || brandLayoutDescs[selectedTemplate] || '';

    // Image-related pole jen kdyz uzivatel chce obrazek
    var imageFieldSpec = generateImage
        ? ',\n' +
          '      "visualHook": "KRATKA hlaska 3-8 slov urcena k vlozeni PRIMO DO OBRAZKU (bez hashtagu, bez CTA; konkretni, citelna, bez diakritiky pokud to zlepsi citelnost)",\n' +
          '      "creativeBrief": "DETAILNI cesky popis co ma obrazek komunikovat, jaka je nalada, co je hlavni sdeleni, pro koho je urcen. 3-5 vet."'
        : '';

    var imageInstructions = generateImage
        ? '\n\nOBRAZEK: Ke kazdemu prispevku VRAT pole "visualHook" a "creativeBrief". visualHook = kratka uderna veta/slogan pro vlozeni do obrazku. creativeBrief = detailni popis CO ma obrazek komunikovat a JAKA nalada ma byt (NE technicke instrukce pro AI, ale kreativni zadani). Server sam sestavi technicky prompt z Brand DNA.'
        : '';

    var userPrompt = 'Vygeneruj ' + batchCount + ' ' + (batchCount === 1 ? 'příspěvek' : 'příspěvky') +
        ' na téma: "' + theme + '".\n' +
        'Tón: ' + tone + '\n' +
        'Typ obsahu: ' + postType + '\n' +
        'Cílová skupina: ' + audience + '\n' +
        'Obsahový pilíř: ' + pillar + '\n' +
        imageInstructions + '\n\n' +
        'Vrať JSON v tomto formátu:\n' +
        '{\n' +
        '  "posts": [\n' +
        '    {\n' +
        '      "text": "plný text příspěvku včetně hashtagů",\n' +
        '      "hook": "první věta / hook",\n' +
        '      "cta": "použité CTA"' +
        imageFieldSpec + '\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        'Každý příspěvek musí být ODLIŠNÝ — jiný úhel pohledu, jiné CTA, jiný hook.';

    console.log('Marketing generate request:', { channel: channel, theme: theme, batchCount: batchCount, generateImage: generateImage, textModel: textModel, brandId: brandId, brandName: brandName, referencePosts: referencePosts.length, hasCustomPrompt: !!customSystemPrompt });

    try {
        var completion = await openai.chat.completions.create({
            model: textModel,
            temperature: 0.9,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        });

        var responseText = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
        console.log('OpenAI response length:', responseText.length, 'model:', textModel);

        var parsed = null;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            var startObj = responseText.indexOf('{');
            if (startObj !== -1) {
                try {
                    parsed = JSON.parse(responseText.substring(startObj, responseText.lastIndexOf('}') + 1));
                } catch (e2) { }
            }
        }

        if (parsed && parsed.posts && Array.isArray(parsed.posts)) {
            // Příspěvky + imagePrompt (preferenčně z GPT, fallback na pravidlové složení)
            var posts = parsed.posts.map(function(post, idx) {
                var imgPrompt = null;
                var visualHook = post.visualHook || post.hook || '';
                if (generateImage) {
                    // SERVER-SIDE PROMPT ASSEMBLY from Brand DNA
                    // Instead of relying on GPT to write image prompts, we build them here
                    var fullBrandStyle = brandDNAFull.styleMain || brandStyleDesc || '';
                    var fullAntiPatterns = brandDNAFull.antiPatterns || '';
                    var creativeBrief = post.creativeBrief || post.imagePrompt || theme;
                    
                    var promptParts = [];
                    promptParts.push('Create a professional social-media post image for ' + brandName + '.');
                    
                    // Visual hook as typography
                    if (visualHook) {
                        promptParts.push('The image MUST contain this text as prominent bold sans-serif typography: "' + visualHook + '". This text should be the visual focal point.');
                    }
                    
                    // Creative context from GPT
                    if (creativeBrief && creativeBrief !== theme) {
                        promptParts.push('Creative concept: ' + creativeBrief);
                    }
                    promptParts.push('Topic: ' + theme);
                    
                    // Layout template from Brand DNA
                    if (selectedLayoutDesc) {
                        promptParts.push('LAYOUT TEMPLATE (follow precisely): ' + selectedLayoutDesc);
                    }
                    
                    // Full Brand DNA style
                    if (fullBrandStyle) {
                        promptParts.push('BRAND VISUAL RULES: ' + fullBrandStyle);
                    }
                    
                    // Exact colors
                    var nc = brandColors.navy || '#0B1F4D';
                    var tc = brandColors.teal || '#26C9E5';
                    var gc = brandColors.gray || '#F5F6F7';
                    promptParts.push('EXACT COLORS: Navy ' + nc + ' for headings and dark backgrounds. Turquoise ' + tc + ' for accents, CTA buttons, icons, lines. Light background ' + gc + ' to #FAFAFA. CTA gradient #2BB9D5 to #63D9DB. Secondary text #5A5A5A to #6A6A6A. White #FFFFFF for cards and text on dark backgrounds.');
                    
                    // Scene and people from image settings
                    var sceneDesc = imageSettings.scene || 'abstract';
                    var peopleDesc = imageSettings.people || 'none';
                    if (peopleDesc === 'none') promptParts.push('No people. Pure typographic and geometric design.');
                    else if (peopleDesc === 'silhouette') promptParts.push('Abstract silhouetted figure, no facial features.');
                    else if (peopleDesc === 'realistic') promptParts.push('Professional businessperson, realistic photography with dark overlay where text appears.');
                    
                    // Anti-patterns (critical)
                    if (fullAntiPatterns) {
                        promptParts.push('FORBIDDEN (never include): ' + fullAntiPatterns);
                    } else {
                        promptParts.push('FORBIDDEN: No red/orange urgency colors. No neon. No 3D effects. No stock photo cliches (handshakes, piggy banks, falling money). No cluttered layouts. No weak contrast. No aggressive sales copy.');
                    }
                    
                    // Format
                    var format = imageSettings.format || '1:1';
                    promptParts.push('Format: ' + format + '. Modern sans-serif typography. Clean scannable layout. Generous whitespace. Rounded cards with subtle shadows. Thin turquoise accent lines. Simple linear icons.');
                    
                    imgPrompt = promptParts.join('\n\n');
                }
                return {
                    index: idx + 1,
                    text: post.text,
                    hook: post.hook || '',
                    cta: post.cta || '',
                    visualHook: visualHook,
                    imagePrompt: imgPrompt,
                    creativeBrief: post.creativeBrief || ''
                };
            });

            var costEstimateText = (MARKETING_CONFIG.costPerTextGen[textModel] || 0) * batchCount;
            return res.status(200).json({
                success: true,
                posts: posts,
                model: textModel,
                cached: false,
                debug: {
                    requestMode: requestMode,
                    systemPrompt: systemPrompt,
                    userPrompt: userPrompt,
                    costEstimate: Number(costEstimateText.toFixed(4))
                }
            });
        } else {
            console.error('Invalid OpenAI response:', responseText.substring(0, 500));
            return res.status(200).json({ success: false, error: 'AI nevrátilo platný formát. Zkuste to znovu.', debug: { requestMode: requestMode, systemPrompt: systemPrompt, userPrompt: userPrompt } });
        }
    } catch (err) {
        console.error('OpenAI API error:', err.message);
        var errorMsg = err.message || 'Neznámá chyba';
        var statusCode = 500;
        if (err.status === 401 || (err.message && err.message.toLowerCase().includes('api key'))) {
            errorMsg = 'Neplatný OpenAI API klíč. Zkontrolujte OPENAI_API_KEY v Railway Variables.';
            statusCode = 401;
        } else if (err.status === 429 || (err.message && err.message.toLowerCase().includes('rate'))) {
            errorMsg = 'OpenAI rate limit nebo kvóta vyčerpána. Zkuste to za chvíli nebo navyšte limity.';
            statusCode = 429;
        } else if (err.message && err.message.toLowerCase().includes('billing')) {
            errorMsg = 'OpenAI účet vyžaduje platbu. Nabijte kredit na platform.openai.com/billing.';
            statusCode = 402;
        }
        return res.status(statusCode).json({ error: errorMsg });
    }
});

function buildServerImagePrompt(visualType, people, scene, mood, format, theme, variationIdx) {
    var typeMap = {
        'typ1': 'clean minimalist banner design with headline text area, subtle geometric corner elements in turquoise, ',
        'typ2': 'structured infographic layout with timeline, numbered cards, connecting lines, ',
        'typ3': 'educational single-concept card with turquoise accent stripe at top, centered typography, ',
        'typ4': 'myth vs reality split layout with turquoise vertical stripe dividing two zones, ',
        'typ5a': 'professional photograph with clean text strip at bottom, ',
        'typ5b': 'full-bleed photograph with headline overlay in bottom corner, semi-transparent dark gradient, '
    };
    var peopleMap = {
        'none': 'no people, purely typographic and geometric design, ',
        'silhouette': 'abstract silhouetted figure, no facial features, ',
        'realistic': 'professional businessperson, realistic photography style, '
    };
    var sceneMap = {
        'office': 'modern office interior, ',
        'property': 'commercial property exterior, ',
        'construction': 'construction site, ',
        'city': 'Prague cityscape, ',
        'abstract': 'abstract geometric background, ',
        'typo': 'pure typography layout, '
    };
    var moodMap = {
        'professional': 'calm professional atmosphere, ',
        'dynamic': 'energetic dynamic composition, ',
        'calm': 'serene stable composition, '
    };
    var variations = [
        'primary composition, balanced. ',
        'different angle, depth and perspective. ',
        'closer crop, detail-focused. ',
        'wider view, architectural lines. ',
        'editorial style, bold typography. '
    ];

    return 'Professional B2B financial services ' +
        (typeMap[visualType] || '') +
        (peopleMap[people] || '') +
        (sceneMap[scene] || '') +
        (moodMap[mood] || '') +
        'Color palette: turquoise #00B4D8, navy #1A2B4A, white, light gray. ' +
        'Format: ' + format + '. ' +
        'Sans-serif typography, clean modern design. ' +
        'No stock photo clichés, no neon colors. ' +
        'Topic: "' + theme + '". ' +
        variations[variationIdx % variations.length];
}

// =============================================
// POST /api/database/find-contacts — AI discovery pro Database (F2.1-3)
// Tři módy:
//   mode='contacts' — vyhledá nové kontakty pro segment ze známých zdrojů
//   mode='sources'  — najde DALŠÍ zdroje (weby, registry, asociace) pro segment
//   mode='deep'     — z 1 existujícího kontaktu vytáhne víc info (LinkedIn, email, board, atd.)
// Volá paralelně Claude Sonnet 4 + GPT-4o, oba s web search tool.
// Deduplikuje výsledky napříč modely + proti existujícím záznamům.
// Vyžaduje session token z /api/verify-pin v X-Database-Token header.
// =============================================
app.post('/api/database/find-contacts', async function (req, res) {
    try {
    if (!verifyDatabaseToken(req)) {
        return res.status(401).json({ error: 'Unauthorized — chybí nebo neplatný session token. Přihlas se znovu.' });
    }

    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    var openaiKey = process.env.OPENAI_API_KEY;
    // Gemini odebráno z auto módu — Martin ho používá výhradně manuálně (frontend-only,
    // kompletně bez API nákladů). Tím se auto request zrychlí (2 paralelní modely místo 3).
    if (!anthropicKey && !openaiKey) {
        return res.status(500).json({ error: 'Žádný AI API klíč není nakonfigurovaný na serveru.' });
    }

    var body = req.body || {};
    var mode = (body.mode || 'contacts').toString();
    if (['contacts', 'sources', 'deep'].indexOf(mode) === -1) {
        return res.status(400).json({ error: 'mode musí být contacts | sources | deep.' });
    }

    var segmentNazev = (body.segmentNazev || '').toString().trim();
    var segmentUseCase = (body.segmentUseCase || '').toString().trim();
    var sources = Array.isArray(body.sources) ? body.sources : [];
    var existingKeys = body.existingContactsKeys || {};
    var existingSourceUrls = body.existingSourceUrls || [];
    var region = (body.region || 'celá ČR').toString().trim();
    var maxResults = Math.min(80, Math.max(5, parseInt(body.maxResults) || 20));
    var thorough = !!body.thorough; // hloubkový průzkum — vyšší max_uses + max_tokens + agresivnější prompt
    var preferLinkedIn = !!body.preferLinkedIn; // jen mode=contacts — AI cílí jen na osoby s veřejným LinkedIn profilem
    var targetContact = body.targetContact || null; // pro mode=deep

    // Validace mode-specific inputů
    if (mode === 'contacts') {
        if (!segmentNazev) return res.status(400).json({ error: 'segmentNazev je povinný pro mode=contacts.' });
        if (sources.length === 0) return res.status(400).json({ error: 'Žádné zdroje pro tento segment. Doplň je v Google Sheets.' });
    } else if (mode === 'sources') {
        if (!segmentNazev) return res.status(400).json({ error: 'segmentNazev je povinný pro mode=sources.' });
    } else if (mode === 'deep') {
        if (!targetContact || !targetContact.firma) {
            return res.status(400).json({ error: 'targetContact (s firma minimum) je povinný pro mode=deep.' });
        }
    }

    var prompt = buildAIDiscoveryPrompt(mode, {
        segmentNazev: segmentNazev,
        segmentUseCase: segmentUseCase,
        sources: sources,
        region: region,
        maxResults: maxResults,
        targetContact: targetContact,
        thorough: thorough,
        preferLinkedIn: preferLinkedIn,
        existingContactsSummary: body.existingContactsSummary || [],
        existingSourceUrls: existingSourceUrls
    });

    console.log('[find-contacts] mode=' + mode + ' segment="' + segmentNazev + '" max=' + maxResults + ' thorough=' + thorough + ' START');
    var tStart = Date.now();

    // Per-model timeout: 80s standard, 120s thorough.
    // Bezpečně pod typickými edge/CDN timeoutmi (Cloudflare 100s, Railway edge ~150s),
    // aby jeden pomalý model neshodil celý request.
    var perModelTimeout = thorough ? 120000 : 80000;

    // KRITICKÉ: withTimeout MUSÍ zachytit i reject z `p` (druhý argument .then()).
    // Bez něj API errors (rate limit, invalid key, network) propagují do Promise.all,
    // celý handler crashne → klient dostane "Failed to fetch" místo strukturované chyby.
    function withTimeout(p, ms, name) {
        return Promise.race([
            p.then(
                function (v) { return { ok: true, value: v }; },
                function (err) { return { ok: false, error: name + ' API selhalo: ' + (err && err.message || String(err)) }; }
            ),
            new Promise(function (resolve) {
                setTimeout(function () {
                    resolve({ ok: false, error: name + ' timeout po ' + Math.round(ms / 1000) + 's' });
                }, ms);
            })
        ]);
    }

    function timed(p, name) {
        var t0 = Date.now();
        return p.then(function (v) {
            console.log('[' + name + '] dokončeno za ' + (Date.now() - t0) + 'ms, items=' + (v && v.items ? v.items.length : 0));
            return v;
        }, function (err) {
            console.log('[' + name + '] selhalo za ' + (Date.now() - t0) + 'ms: ' + (err && err.message || err));
            throw err;
        });
    }

    var promises = [];
    promises.push(anthropicKey
        ? withTimeout(timed(callClaudeWithWebSearch(anthropicKey, prompt, mode, thorough), 'claude'), perModelTimeout, 'Claude')
        : Promise.resolve({ ok: true, value: { items: [], skipped: 'no key' } }));
    promises.push(openaiKey
        ? withTimeout(timed(callOpenAIWithWebSearch(openaiKey, prompt, mode, thorough), 'openai'), perModelTimeout, 'OpenAI')
        : Promise.resolve({ ok: true, value: { items: [], skipped: 'no key' } }));

    var raceResults = await Promise.all(promises);

    function extractRace(r, name) {
        if (r.ok && r.value) return r.value;
        return { items: [], error: r.error || (name + ' selhalo') };
    }
    var claudeResult = extractRace(raceResults[0], 'Claude');
    var openaiResult = extractRace(raceResults[1], 'OpenAI');

    var tTotal = Date.now() - tStart;
    console.log('[find-contacts] mode=' + mode + ' DONE in ' + tTotal + 'ms — ' +
        'claude=' + claudeResult.items.length + (claudeResult.error ? ' (ERR: ' + claudeResult.error + ')' : '') +
        ' openai=' + openaiResult.items.length + (openaiResult.error ? ' (ERR: ' + openaiResult.error + ')' : ''));

    var allArrays = [
        { items: claudeResult.items, source: 'claude' },
        { items: openaiResult.items, source: 'openai' }
    ];
    var merged;
    if (mode === 'contacts') {
        merged = mergeAndDedupeContacts(allArrays, existingKeys);
    } else if (mode === 'sources') {
        merged = mergeAndDedupeSources(allArrays, existingSourceUrls);
    } else { // deep
        merged = mergeDeepEnrichment(allArrays);
    }

    var totalFromAI = claudeResult.items.length + openaiResult.items.length;
    return res.json({
        mode: mode,
        suggestions: merged,
        stats: {
            claudeCount: claudeResult.items.length,
            openaiCount: openaiResult.items.length,
            mergedCount: merged.length,
            duplicates: totalFromAI - merged.length,
            claudeError: claudeResult.error || null,
            openaiError: openaiResult.error || null,
            totalTimeMs: tTotal
        }
    });
    } catch (handlerErr) {
        // Defensivní safety net — pokud cokoli unexpected throws (parsing, DB, atd.),
        // vrátíme strukturovanou JSON chybu místo aby Express crashnul a klient dostal
        // "Failed to fetch" connection reset.
        console.error('[find-contacts] uncaught handler error:', handlerErr && handlerErr.stack || handlerErr);
        return res.status(500).json({
            error: 'Server error: ' + (handlerErr && handlerErr.message || String(handlerErr)),
            stack: process.env.NODE_ENV === 'production' ? undefined : (handlerErr && handlerErr.stack)
        });
    }
});

// =============================================
// Prompt builders pro 3 módy (+ thorough variant)
// Exposed jako endpoint pro manuální copy-paste mode (frontend volá GET /prompt-only).
// =============================================
app.post('/api/database/build-prompt', function (req, res) {
    if (!verifyDatabaseToken(req)) {
        return res.status(401).json({ error: 'Unauthorized — chybí nebo neplatný session token.' });
    }
    var body = req.body || {};
    var mode = body.mode || 'contacts';
    if (['contacts', 'sources', 'deep'].indexOf(mode) === -1) {
        return res.status(400).json({ error: 'mode musí být contacts | sources | deep.' });
    }
    var prompt = buildAIDiscoveryPrompt(mode, {
        segmentNazev: body.segmentNazev || '',
        segmentUseCase: body.segmentUseCase || '',
        sources: body.sources || [],
        region: body.region || 'celá ČR',
        maxResults: Math.min(80, Math.max(5, parseInt(body.maxResults) || 20)),
        targetContact: body.targetContact || null,
        thorough: !!body.thorough,
        manual: true // přidá explicit instrukce pro chat UI
    });
    res.json({ prompt: prompt });
});

function buildAIDiscoveryPrompt(mode, ctx) {
    var header = 'Jsi expert na vyhledávání B2B kontaktů a zdrojů v České republice pro investiční firmu ProfiLend ' +
        '(HNWI debt financing, úvěry 10–250M CZK proti komerčním nemovitostem v ČR).';

    var manualInstr = ctx.manual
        ? '\n\nJAK VRÁTIT ODPOVĚĎ (důležité pro strojové zpracování):\n' +
          '- Pokud máš dostupný web search / browsing tool, použij ho pro maximální přesnost.\n' +
          '- Hotový JSON (podle struktury výše) ZABAL do markdown code bloku takto:\n\n' +
          '```json\n' +
          '{ ... JSON podle struktury výše ... }\n' +
          '```\n\n' +
          '- Mimo code block nepiš ŽÁDNÝ další text — žádný úvod, komentáře ani závěr.\n' +
          '- Aplikace přečte pouze obsah code bloku, všechno ostatní bude ignorovat.'
        : '';

    var thoroughInstr = ctx.thorough
        ? '\n\nHLOUBKOVÝ PRŮZKUM: Toto je důkladná verze. Projdi VŠECHNY uvedené zdroje detailně, ' +
          'hledej i okrajové weby (eventy, články, profil pages, ranking žebříčky). ' +
          'Cílíme na ' + ctx.maxResults + '+ návrhů — kvalita stále důležitá, ale nebrn se rozsahu. ' +
          'Spotřebuj víc web search dotazů, projdi víc stránek.'
        : '';

    if (mode === 'contacts') {
        var sourcesText = ctx.sources.map(function (s, i) {
            var line = (i + 1) + '. ' + (s.nazev || 'Zdroj');
            if (s.url) line += ' — ' + s.url;
            if (s.poznamka) line += ' (' + s.poznamka + ')';
            return line;
        }).join('\n');

        // Existing kontakty v tomto segmentu — ať AI nehledá to, co už máme.
        var existing = (ctx.existingContactsSummary || []).filter(function (c) { return c && (c.firma || c.kontaktniOsoba); });
        var existingCap = 80;
        var existingText = existing.length > 0
            ? '\n\nKONTAKTY KTERÉ UŽ MÁM V DATABÁZI PRO TENTO SEGMENT (NEHLEDEJ tyto, najdi DALŠÍ):\n' +
              existing.slice(0, existingCap).map(function (c) {
                return '- ' + (c.firma || '?') + (c.kontaktniOsoba ? ' (' + c.kontaktniOsoba + ')' : '');
              }).join('\n') +
              (existing.length > existingCap ? '\n... a dalších ' + (existing.length - existingCap) + ' kontaktů (z prostorových důvodů zde nezahrnuto).' : '')
            : '';

        return [
            header, '',
            'CÍL: Najdi konkrétní reálné kontakty pro segment "' + ctx.segmentNazev + '" v regionu ' + ctx.region + '.',
            '',
            'USE-CASE SEGMENTU: ' + (ctx.segmentUseCase || 'Zprostředkovatelé obchodů pro debt financing.'),
            '',
            'ZDROJE K PROZKOUMÁNÍ (použij web search pokud máš tool dostupný):',
            sourcesText,
            existingText,
            '',
            'INSTRUKCE:',
            '- Použij web search pro každý zdroj a vytahej konkrétní jména + role + kontakty',
            '- Vrať MAX ' + ctx.maxResults + ' nejlepších kontaktů (kvalita > kvantita)',
            '- KAŽDÝ kontakt MUSÍ být ověřitelný v reálu — žádné halucinace',
            '- Cílíme na decision-makery: Partner, Managing Partner, Director, CEO, Owner, Head of, Senior',
            '- Vyhni se juniorům, asistentům, info@/contact@ adresám',
            '- Email/telefon/LinkedIn = jen pokud je v reálu veřejně dostupné. Jinak null.',
            (ctx.preferLinkedIn
                ? '- PRIORITA LINKEDIN: Vrať POUZE kontakty s veřejně dohledatelným LinkedIn profilem. Pokud kontakt LinkedIn nemá nebo ho nedohledáš, raději ho vynech a najdi jiného. LinkedIn URL je v této variantě POVINNÉ pole (nesmí být null).'
                : ''),
            thoroughInstr,
            '',
            (ctx.manual ? 'STRUKTURA JSON ODPOVĚDI (jak ji obalit viz pokyn na konci):' : 'FORMÁT ODPOVĚDI: vrať POUZE platný JSON, bez markdown obalu.'),
            '{',
            '  "contacts": [',
            '    {',
            '      "firma": "název s.r.o./a.s. (povinné)",',
            '      "ico": "8místné IČO | null",',
            '      "kontaktniOsoba": "Jméno Příjmení | null",',
            '      "role": "Managing Partner | null",',
            '      "email": "veřejný email | null",',
            '      "telefon": "veřejný tel | null",',
            '      "web": "https://… | null",',
            (ctx.preferLinkedIn
                ? '      "linkedinUrl": "https://linkedin.com/in/… (POVINNÉ pro tuto variantu — nesmí být null)",'
                : '      "linkedinUrl": "https://linkedin.com/in/… | null",'),
            '      "sidlo": "adresa | null",',
            '      "zdrojUrl": "URL zdroje kde jsi to našel | null"',
            '    }',
            '  ]',
            '}',
            manualInstr
        ].join('\n');
    }

    if (mode === 'sources') {
        // Existing zdroje pro tento segment — ať AI nehledá to, co už máme.
        var existingUrls = (ctx.existingSourceUrls || []).filter(Boolean);
        var existingCap = 50;
        var existingText = existingUrls.length > 0
            ? '\n\nZDROJE KTERÉ UŽ MÁM PRO TENTO SEGMENT (NEHLEDEJ tyto, najdi DALŠÍ):\n' +
              existingUrls.slice(0, existingCap).map(function (u) { return '- ' + u; }).join('\n') +
              (existingUrls.length > existingCap ? '\n... a dalších ' + (existingUrls.length - existingCap) + ' URL.' : '')
            : '';

        return [
            header, '',
            'CÍL: Najdi DALŠÍ relevantní zdroje (weby, registry, asociace, žebříčky, eventy, oborové publikace) ',
            'pro segment "' + ctx.segmentNazev + '" v ČR. Žádné kontakty osob — jen zdroje.',
            '',
            'USE-CASE SEGMENTU: ' + (ctx.segmentUseCase || 'Zprostředkovatelé obchodů.'),
            existingText,
            '',
            'INSTRUKCE:',
            '- Použij web search a najdi nové weby/registry, které se dají využít jako zdroj kontaktů',
            '- Vrať MAX ' + ctx.maxResults + ' zdrojů',
            '- Pro každý zdroj uveď jeho URL, krátký název, popis (co konkrétně se tam dá vytěžit)',
            '- Typy: profesní registr, oborová asociace, žebříček/ranking, konferenční speakers, oborový časopis, deal feed',
            '- Vyhni se Wikipedii, obecným adresářům typu Firmy.cz (ledaže by měly specifickou kategorii)',
            '- Pro každý zdroj odhadni jeho "kvalitu" (high / mid / low) — kolik kvalitních kontaktů z něj půjde získat',
            thoroughInstr,
            '',
            (ctx.manual ? 'STRUKTURA JSON ODPOVĚDI (jak ji obalit viz pokyn na konci):' : 'FORMÁT ODPOVĚDI: vrať POUZE platný JSON, bez markdown obalu.'),
            '{',
            '  "sources": [',
            '    {',
            '      "nazev": "Krátký název zdroje (povinné)",',
            '      "url": "https://… (povinné)",',
            '      "poznamka": "Co se tam dá vytěžit, koho hledat",',
            '      "typZdroje": "registr | asociace | ranking | konference | publikace | dealfeed",',
            '      "kvalita": "high | mid | low"',
            '    }',
            '  ]',
            '}',
            manualInstr
        ].join('\n');
    }

    if (mode === 'deep') {
        var t = ctx.targetContact;
        return [
            header, '',
            'CÍL: Hloubkový průzkum konkrétního kontaktu. Najdi co nejvíc informací o této osobě / firmě.',
            '',
            'CÍLOVÝ KONTAKT:',
            '- Firma: ' + (t.firma || '?'),
            '- IČO: ' + (t.ico || '?'),
            '- Osoba: ' + (t.kontaktniOsoba || '?'),
            '- Role: ' + (t.role || '?'),
            '- Web: ' + (t.web || '?'),
            '- LinkedIn: ' + (t.linkedinUrl || '?'),
            '',
            'INSTRUKCE:',
            '- Použij web search pro hledání: LinkedIn profil, email, telefon, board memberships, historie pozic, news mentions, kontroverze',
            '- Najdi i jiné firmy, kde tato osoba sedí v boardu nebo má vlastnický podíl',
            '- Najdi recent news o této osobě nebo firmě (poslední 12 měsíců)',
            '- Pokud kontakt neexistuje v reálu, vrať prázdné pole',
            thoroughInstr,
            '',
            (ctx.manual ? 'STRUKTURA JSON ODPOVĚDI (jak ji obalit viz pokyn na konci):' : 'FORMÁT ODPOVĚDI: vrať POUZE platný JSON, bez markdown obalu.'),
            '{',
            '  "enrichments": [',
            '    {',
            '      "kategorie": "kontakt | role | board | news | warning",',
            '      "klic": "stručný popis (např. \'LinkedIn URL\', \'Board člen XY\', \'Akvizice 2024\')",',
            '      "hodnota": "konkrétní info / URL / popis",',
            '      "zdrojUrl": "URL zdroje pokud znáš | null",',
            '      "datum": "YYYY-MM nebo YYYY pokud relevantní | null"',
            '    }',
            '  ]',
            '}',
            manualInstr
        ].join('\n');
    }

    return header;
}

// =============================================
// Claude — multi-block content extraction with web search
// =============================================
async function callClaudeWithWebSearch(apiKey, prompt, mode, thorough) {
    var client = new Anthropic({ apiKey: apiKey });
    var maxTokens = thorough ? 16000 : 8000;
    var maxUses = thorough ? 25 : 8;

    // web_search tool je beta — pokud Anthropic účet nemá přístup, fallback bez toolu
    var tools = [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: maxUses
    }];

    var msg;
    try {
        msg = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            temperature: 0.4,
            tools: tools,
            messages: [{ role: 'user', content: prompt }]
        });
    } catch (toolErr) {
        // Fallback: bez web search (např. tool není povolený na účtu)
        console.warn('[claude] web_search tool nedostupný, fallback bez něj:', toolErr.message);
        msg = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            temperature: 0.4,
            messages: [{ role: 'user', content: prompt }]
        });
    }

    // Claude content je array bloků: text, server_tool_use, web_search_tool_result, …
    // Concatenate všechny text bloky a hledej JSON
    var allText = '';
    if (Array.isArray(msg.content)) {
        msg.content.forEach(function (block) {
            if (block.type === 'text' && block.text) allText += block.text + '\n';
        });
    }
    var parsed = tryParseAIResponse(allText, mode);
    return { items: parsed };
}

// =============================================
// OpenAI — Responses API s web_search_preview, fallback na chat.completions bez search
// =============================================
async function callOpenAIWithWebSearch(apiKey, prompt, mode, thorough) {
    if (!OpenAI) throw new Error('OpenAI SDK not loaded on server');
    var openai = new OpenAI({ apiKey: apiKey });
    var maxTokens = thorough ? 16000 : 4096;

    // Pokus 1: Responses API s web_search_preview
    if (typeof openai.responses !== 'undefined' && typeof openai.responses.create === 'function') {
        try {
            var r = await openai.responses.create({
                model: 'gpt-4o',
                tools: [{ type: 'web_search_preview' }],
                input: prompt + '\n\nDŮLEŽITÉ: Odpověz POUZE platným JSON. Žádný markdown.'
            });
            // Najdi text v output array
            var text = '';
            if (typeof r.output_text === 'string') {
                text = r.output_text;
            } else if (Array.isArray(r.output)) {
                r.output.forEach(function (item) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        item.content.forEach(function (c) {
                            if (c.type === 'output_text' && c.text) text += c.text + '\n';
                        });
                    }
                });
            }
            var parsed = tryParseAIResponse(text, mode);
            return { items: parsed };
        } catch (respErr) {
            console.warn('[openai] Responses API selhalo, fallback na chat.completions:', respErr.message);
        }
    }

    // Pokus 2: chat.completions bez web search (fallback)
    var completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: 'Jsi vyhledávač B2B kontaktů a zdrojů. Vrať POUZE platný JSON podle schématu v promptu.' },
            { role: 'user', content: prompt }
        ]
    });
    var content = completion.choices[0].message.content;
    var parsed2 = tryParseAIResponse(content, mode);
    return { items: parsed2 };
}

// =============================================
// Gemini — generative-ai SDK s Google search retrieval tool
// =============================================
async function callGeminiWithWebSearch(apiKey, prompt, mode, thorough) {
    var genAI = new GoogleGenerativeAI(apiKey);
    var maxTokens = thorough ? 16000 : 8000;

    // Gemini 2.0 Flash s google_search tool (preview od 2024-12)
    // Fallback bez search tool, pokud SDK nepodporuje
    var modelConfig = {
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.4
        }
    };

    var result;
    try {
        // Pokus 1: s google_search tool
        var modelWithSearch = genAI.getGenerativeModel(Object.assign({}, modelConfig, {
            tools: [{ googleSearch: {} }]
        }));
        result = await modelWithSearch.generateContent(prompt);
    } catch (toolErr) {
        console.warn('[gemini] google_search tool nedostupný, fallback bez něj:', toolErr.message);
        try {
            var model = genAI.getGenerativeModel(modelConfig);
            result = await model.generateContent(prompt);
        } catch (fallbackErr) {
            // Fallback na starší model
            console.warn('[gemini] gemini-2.0-flash-exp selhalo, fallback na gemini-1.5-flash:', fallbackErr.message);
            var oldModel = genAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
                generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 }
            });
            result = await oldModel.generateContent(prompt);
        }
    }

    var text = '';
    if (result && result.response) {
        text = typeof result.response.text === 'function' ? result.response.text() : '';
    }
    var parsed = tryParseAIResponse(text, mode);
    return { items: parsed };
}

// =============================================
// JSON extraction — robust proti markdown obalům, partial responses, multiple objects
// =============================================
function tryParseAIResponse(text, mode) {
    if (!text) return [];
    var key = mode === 'contacts' ? 'contacts' : mode === 'sources' ? 'sources' : 'enrichments';

    function pull(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj[key])) return obj[key];
        // Sometimes AI nests it
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            var v = obj[keys[i]];
            if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return v;
        }
        return null;
    }

    // Strategy 1: Direct parse
    try {
        var p = JSON.parse(text.trim());
        var r = pull(p);
        if (r) return r;
    } catch (e) { }

    // Strategy 2: Markdown code block
    var codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
        try {
            var p2 = JSON.parse(codeBlockMatch[1].trim());
            var r2 = pull(p2);
            if (r2) return r2;
        } catch (e) { }
    }

    // Strategy 3: First { to last }
    var startObj = text.indexOf('{');
    var lastBrace = text.lastIndexOf('}');
    if (startObj !== -1 && lastBrace > startObj) {
        try {
            var p3 = JSON.parse(text.substring(startObj, lastBrace + 1));
            var r3 = pull(p3);
            if (r3) return r3;
        } catch (e) { }
    }

    return [];
}

function normalizeKey(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\/+$/, '');
}

// =============================================
// Dedupe — contacts (přijímá pole { items, source } pro N modelů)
// =============================================
function mergeAndDedupeContacts(arrays, existingKeys) {
    var existingIcos = new Set((existingKeys.icos || []).map(normalizeKey).filter(Boolean));
    var existingEmails = new Set((existingKeys.emails || []).map(normalizeKey).filter(Boolean));
    var existingLinkedins = new Set((existingKeys.linkedins || []).map(normalizeKey).filter(Boolean));
    var existingNameFirma = new Set((existingKeys.namesFirmas || []).map(normalizeKey).filter(Boolean));

    var seenIcos = {}, seenEmails = {}, seenLinkedins = {}, seenNameFirma = {};
    var output = [];

    function processOne(c, sourceModel) {
        if (!c || !c.firma) return;
        var ico = normalizeKey(c.ico);
        var email = normalizeKey(c.email);
        var lin = normalizeKey(c.linkedinUrl);
        var nf = c.kontaktniOsoba && c.firma ? normalizeKey(c.kontaktniOsoba + '|' + c.firma) : '';

        if (ico && existingIcos.has(ico)) return;
        if (email && existingEmails.has(email)) return;
        if (lin && existingLinkedins.has(lin)) return;
        if (nf && existingNameFirma.has(nf)) return;

        var idx = -1;
        if (ico && seenIcos[ico] !== undefined) idx = seenIcos[ico];
        else if (email && seenEmails[email] !== undefined) idx = seenEmails[email];
        else if (lin && seenLinkedins[lin] !== undefined) idx = seenLinkedins[lin];
        else if (nf && seenNameFirma[nf] !== undefined) idx = seenNameFirma[nf];

        if (idx >= 0) {
            if (output[idx]._sources.indexOf(sourceModel) === -1) output[idx]._sources.push(sourceModel);
            ['ico', 'email', 'telefon', 'linkedinUrl', 'web', 'sidlo', 'role', 'zdrojUrl', 'kontaktniOsoba'].forEach(function (f) {
                if (!output[idx][f] && c[f]) output[idx][f] = c[f];
            });
        } else {
            var newC = Object.assign({}, c, { _sources: [sourceModel] });
            var newIdx = output.push(newC) - 1;
            if (ico) seenIcos[ico] = newIdx;
            if (email) seenEmails[email] = newIdx;
            if (lin) seenLinkedins[lin] = newIdx;
            if (nf) seenNameFirma[nf] = newIdx;
        }
    }

    (arrays || []).forEach(function (a) {
        (a.items || []).forEach(function (c) { processOne(c, a.source); });
    });

    output.sort(function (a, b) {
        if (b._sources.length !== a._sources.length) return b._sources.length - a._sources.length;
        return String(a.firma || '').localeCompare(String(b.firma || ''), 'cs');
    });
    return output;
}

// =============================================
// Dedupe — sources (deduplikuje podle hostname URL)
// =============================================
function urlHostname(u) {
    if (!u) return '';
    try {
        var withProto = /^https?:\/\//i.test(u) ? u : 'https://' + u;
        var url = new URL(withProto);
        return url.hostname.replace(/^www\./, '').toLowerCase();
    } catch (e) {
        return String(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

function mergeAndDedupeSources(arrays, existingSourceUrls) {
    var existingHosts = new Set((existingSourceUrls || []).map(urlHostname).filter(Boolean));
    var seenHosts = {};
    var output = [];

    function processOne(s, sourceModel) {
        if (!s || !s.url || !s.nazev) return;
        var host = urlHostname(s.url);
        if (!host) return;
        if (existingHosts.has(host)) return;
        if (seenHosts[host] !== undefined) {
            var existing = output[seenHosts[host]];
            if (existing._sources.indexOf(sourceModel) === -1) existing._sources.push(sourceModel);
            ['poznamka', 'typZdroje', 'kvalita'].forEach(function (f) {
                if (!existing[f] && s[f]) existing[f] = s[f];
            });
            return;
        }
        var newS = Object.assign({}, s, { _sources: [sourceModel] });
        seenHosts[host] = output.push(newS) - 1;
    }

    (arrays || []).forEach(function (a) {
        (a.items || []).forEach(function (s) { processOne(s, a.source); });
    });

    var qualOrder = { 'high': 0, 'mid': 1, 'low': 2 };
    output.sort(function (a, b) {
        if (b._sources.length !== a._sources.length) return b._sources.length - a._sources.length;
        var qa = qualOrder[(a.kvalita || '').toLowerCase()] != null ? qualOrder[(a.kvalita || '').toLowerCase()] : 3;
        var qb = qualOrder[(b.kvalita || '').toLowerCase()] != null ? qualOrder[(b.kvalita || '').toLowerCase()] : 3;
        if (qa !== qb) return qa - qb;
        return String(a.nazev || '').localeCompare(String(b.nazev || ''), 'cs');
    });
    return output;
}

// =============================================
// Merge — deep enrichment (1 contact → many findings)
// =============================================
function mergeDeepEnrichment(arrays) {
    var seen = {};
    var output = [];

    function processOne(f, sourceModel) {
        if (!f || !f.hodnota) return;
        var key = normalizeKey((f.kategorie || '') + '|' + (f.klic || '') + '|' + (f.hodnota || ''));
        if (seen[key] !== undefined) {
            var existing = output[seen[key]];
            if (existing._sources.indexOf(sourceModel) === -1) existing._sources.push(sourceModel);
            if (!existing.zdrojUrl && f.zdrojUrl) existing.zdrojUrl = f.zdrojUrl;
            if (!existing.datum && f.datum) existing.datum = f.datum;
            return;
        }
        var newF = Object.assign({}, f, { _sources: [sourceModel] });
        seen[key] = output.push(newF) - 1;
    }

    (arrays || []).forEach(function (a) {
        (a.items || []).forEach(function (f) { processOne(f, a.source); });
    });

    var catOrder = { 'news': 0, 'role': 1, 'board': 2, 'kontakt': 3, 'warning': 4 };
    output.sort(function (a, b) {
        if (b._sources.length !== a._sources.length) return b._sources.length - a._sources.length;
        var ca = catOrder[(a.kategorie || '').toLowerCase()] != null ? catOrder[(a.kategorie || '').toLowerCase()] : 5;
        var cb = catOrder[(b.kategorie || '').toLowerCase()] != null ? catOrder[(b.kategorie || '').toLowerCase()] : 5;
        return ca - cb;
    });
    return output;
}

app.listen(PORT, function () {
    console.log('Investment Tools API running on port ' + PORT);
});
