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
    imageModelDefault: 'gpt-image-1',
    imageQualityDefault: 'hd',
    promptMaxLength: 4000,
    referenceCompressionPx: 512,
    costPerVisionImage: 0.01,
    costPerImageGen: { 'gpt-image-1': 0.04, 'dall-e-3': 0.08 },
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
    allowedHeaders: ['Content-Type']
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
// POST /api/verify-pin — Server-side PIN verification
// PIN hash stored in env variable PIN_HASH (SHA-256)
// Rate limited: max 5 attempts per IP per 5 minutes
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
        return res.status(200).json({ success: true });
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

// =============================================
// POST /api/generate-loan-doc — Loan document generation
// Claude fills in a contract template with provided data
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

    if (!templateText || templateText.trim().length < 50) {
        return res.status(400).json({ error: 'Šablona je prázdná nebo příliš krátká.' });
    }

    if (!formData) {
        return res.status(400).json({ error: 'Chybí data pro vyplnění smlouvy.' });
    }

    var client = new Anthropic({ apiKey: apiKey });

    var systemPrompt = 'Jsi právní asistent specializovaný na vyplňování smluvní dokumentace.\n\n' +
        'KRITICKÉ PRAVIDLO: Zachovej 100% právní znění šablony. Měň POUZE místa s proměnnými daty (jména, částky, data, adresy, čísla účtů, IČO, atd.). NIKDY neupravuj právní formulace, neměň strukturu článků, nevynechávej žádné články ani odstavce.\n\n' +
        'Tvým úkolem je analyzovat šablonu smlouvy a poskytnout seznam přesných nahrazení textu.\n\n' +
        'FORMÁT ODPOVĚDI — vrať POUZE platný JSON, žádný markdown:\n' +
        '{\n' +
        '  "replacements": [\n' +
        '    {"find": "přesný text v šabloně", "replace": "nový text"},\n' +
        '    ...\n' +
        '  ],\n' +
        '  "notes": "volitelné poznámky k vyplnění"\n' +
        '}\n\n' +
        'PRAVIDLA PRO NAHRAZENÍ:\n' +
        '- Pole "find" musí obsahovat PŘESNÝ text, který se nachází v šabloně.\n' +
        '- Nahrazuj pouze proměnná data — jména společností, IČO, adresy, částky, data, čísla účtů, úrokové sazby, poplatky, jména osob, kontakty.\n' +
        '- NIKDY nenahrazuj právní formulace, standardní články, definice ani obecná ustanovení.\n' +
        '- Pokud některý údaj v poskytnutých datech chybí, NENAHRAZUJ příslušné místo — nech původní text.\n' +
        '- Částky formátuj s tečkami jako oddělovači tisíců (např. 5.000.000 Kč).\n' +
        '- Data formátuj jako DD.MM.YYYY.\n' +
        '- Pokud šablona obsahuje údaje z Listů vlastnictví (přílohy s nemovitostmi), nahraď je pouze pokud máš odpovídající data v collateralItems.\n' +
        '- U podpisové strany nahraď jména a funkce zástupců obou stran.';

    // Build user message with all form data
    var dataDescription = 'DATA PRO VYPLNĚNÍ SMLOUVY:\n\n';
    dataDescription += '=== DLUŽNÍK ===\n';
    if (formData.borrower) dataDescription += 'Název: ' + formData.borrower + '\n';
    if (formData.ico) dataDescription += 'IČO: ' + formData.ico + '\n';
    if (formData.spisovaZnacka) dataDescription += 'Spisová značka: ' + formData.spisovaZnacka + '\n';
    if (formData.sidlo) dataDescription += 'Sídlo: ' + formData.sidlo + '\n';

    dataDescription += '\n=== PARAMETRY ÚVĚRU ===\n';
    if (formData.purpose) dataDescription += 'Účel úvěru: ' + formData.purpose + '\n';
    if (formData.amount) dataDescription += 'Výše úvěru: ' + formData.amount + ' ' + (formData.currency || 'CZK') + '\n';
    if (formData.currency) dataDescription += 'Měna: ' + formData.currency + '\n';
    if (formData.drawdownDate) dataDescription += 'Datum čerpání: ' + formData.drawdownDate + '\n';
    if (formData.drawdownType) dataDescription += 'Typ čerpání: ' + formData.drawdownType + '\n';
    if (formData.interest) dataDescription += 'Úroková sazba: ' + formData.interest + ' % p.a.\n';
    if (formData.interestPayment) dataDescription += 'Placení úroků: ' + formData.interestPayment + '\n';
    if (formData.maturity) dataDescription += 'Doba splatnosti: ' + formData.maturity + ' ' + (formData.maturityUnit || 'let') + '\n';
    if (formData.maturityDate) dataDescription += 'Datum splatnosti (Den konečné splatnosti): ' + formData.maturityDate + '\n';
    if (formData.earlyRepayment) dataDescription += 'Předčasné splacení: ' + formData.earlyRepayment + '\n';

    dataDescription += '\n=== POPLATKY ===\n';
    if (formData.originationFee) dataDescription += 'Poplatek za sjednání: ' + formData.originationFee + (formData.originationFeeType === 'percent' ? ' %' : ' ' + (formData.currency || 'CZK')) + '\n';
    if (formData.otherCosts) dataDescription += 'Ostatní náklady: ' + formData.otherCosts + '\n';

    dataDescription += '\n=== ZAJIŠTĚNÍ ===\n';
    if (formData.collateralValue) dataDescription += 'Hodnota zajištění: ' + formData.collateralValue + '\n';
    if (formData.collateralItems) dataDescription += 'Položky zajištění:\n' + formData.collateralItems + '\n';

    dataDescription += '\n=== DODATEČNÉ ÚDAJE ===\n';
    if (formData.representativeName) dataDescription += 'Jednatel/zástupce dlužníka: ' + formData.representativeName + ', funkce: ' + (formData.representativeRole || '') + '\n';
    if (formData.contactName) dataDescription += 'Kontaktní osoba: ' + formData.contactName + ', tel: ' + (formData.contactPhone || '') + ', e-mail: ' + (formData.contactEmail || '') + '\n';
    if (formData.deliveryAddress) dataDescription += 'Adresa pro doručování: ' + formData.deliveryAddress + '\n';
    if (formData.borrowerAccount) dataDescription += 'Účet dlužníka: ' + formData.borrowerAccount + ' u ' + (formData.borrowerBank || '') + '\n';
    if (formData.lenderAccount) dataDescription += 'Účet věřitele: ' + formData.lenderAccount + ' u ' + (formData.lenderBank || '') + '\n';
    if (formData.appraisalRef) dataDescription += 'Odhad: ' + formData.appraisalRef + '\n';
    if (formData.appraisalAuthor) dataDescription += 'Odhadce: ' + formData.appraisalAuthor + '\n';
    if (formData.appraisalDate) dataDescription += 'Datum odhadu: ' + formData.appraisalDate + '\n';
    if (formData.appraisalValue) dataDescription += 'Hodnota z odhadu: ' + formData.appraisalValue + '\n';
    if (formData.existingPledge) dataDescription += 'Existující zástavní právo k výmazu: ' + formData.existingPledge + '\n';
    if (formData.propertyOwners) dataDescription += 'Vlastníci nemovitostí: ' + formData.propertyOwners + '\n';
    if (formData.defaultInterest) dataDescription += 'Úrok z prodlení: ' + formData.defaultInterest + ' % p.a.\n';
    if (formData.accelerationPenalty) dataDescription += 'Smluvní pokuta při zesplatnění: ' + formData.accelerationPenalty + ' %\n';
    if (formData.breachPenalty) dataDescription += 'Smluvní pokuta za porušení: ' + formData.breachPenalty + ' %\n';
    if (formData.signDate) dataDescription += 'Datum podpisu: ' + formData.signDate + '\n';
    if (formData.signPlace) dataDescription += 'Místo podpisu: ' + formData.signPlace + '\n';

    var userContent = 'Vyplň následující šablonu smlouvy (' + (templateName || 'smlouva') + ') poskytnutými daty.\n\n' +
        dataDescription + '\n\n' +
        '=== ŠABLONA SMLOUVY ===\n\n' +
        templateText.substring(0, 50000);

    console.log('Loan doc generation request:', { templateName: templateName, templateLength: templateText.length, dataFields: Object.keys(formData).length });

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

    try {
        var message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 16384,
            temperature: 0,
            messages: [
                { role: 'user', content: userContent },
                { role: 'assistant', content: '{' }
            ],
            system: systemPrompt
        });

        var responseText = '{' + message.content[0].text;
        console.log('Loan doc response length:', responseText.length);

        var parsed = tryParseJSON(responseText);

        if (parsed && parsed.replacements && Array.isArray(parsed.replacements)) {
            return res.status(200).json({
                success: true,
                replacements: parsed.replacements,
                notes: parsed.notes || null,
                usage: {
                    input_tokens: message.usage.input_tokens,
                    output_tokens: message.usage.output_tokens
                }
            });
        } else {
            console.error('Invalid response format:', responseText.substring(0, 500));
            return res.status(200).json({
                success: false,
                error: 'Claude nevrátil platný formát nahrazení. Zkuste to znovu.',
                raw: responseText.substring(0, 1000)
            });
        }
    } catch (err) {
        console.error('Claude API error (loan doc):', err.message);
        var errorMsg = err.message || 'Neznámá chyba';
        var statusCode = 500;
        if (err.status === 401) { errorMsg = 'Neplatný API klíč.'; statusCode = 401; }
        else if (err.status === 429) { errorMsg = 'Příliš mnoho požadavků. Počkejte chvíli.'; statusCode = 429; }
        else if (err.status === 529 || err.status === 503) { errorMsg = 'Claude API je přetížené.'; statusCode = 503; }
        return res.status(statusCode).json({ error: errorMsg });
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
    parts.push('Create a professional social-media post image for ' + ctx.brandName + '.');
    if (brief.topic) parts.push('Topic: ' + brief.topic);
    if (brief.visualHook) {
        parts.push('Include this short text as prominent bold sans-serif typography (focal point of the composition): "' + brief.visualHook + '".');
    }
    if (brief.creativeBrief) parts.push('Creative concept: ' + brief.creativeBrief);
    var layoutKey = brief.layout || brief.layoutKey;
    if (layoutKey && ctx.layoutTemplates[layoutKey]) {
        parts.push('LAYOUT TEMPLATE (follow precisely): ' + ctx.layoutTemplates[layoutKey]);
    }
    if (ctx.styleMain) parts.push('BRAND VISUAL RULES (full): ' + ctx.styleMain);
    parts.push('EXACT COLORS: primary ' + ctx.colors.primary + ' (headings, dark surfaces), accent ' + ctx.colors.accent +
        ' (CTAs, lines, highlights), background ' + ctx.colors.background + ', muted text ' + ctx.colors.muted +
        '. Do not introduce other colors.');
    parts.push('TYPOGRAPHY: Use ' + (ctx.typography.primaryFont || 'DM Sans') + ' or ' + (ctx.typography.fallback || 'Inter, sans-serif') +
        ' only. Maximum 2 font weights (bold for headlines, regular for body).');
    if (ctx.tone) parts.push('VISUAL MOOD (matches brand voice): ' + ctx.tone + '.');
    if (ctx.bannedWords.length > 0) {
        parts.push('FORBIDDEN words and concepts (must not appear as typography or imagery): ' + ctx.bannedWords.join(', ') + '.');
    }
    if (ctx.antiPatterns) parts.push('ANTI-PATTERNS (never include any of these): ' + ctx.antiPatterns);
    var format = brief.format || '1:1';
    parts.push('Format: ' + format + '. Clean scannable layout, generous whitespace, rounded cards with subtle shadows, thin accent lines, simple linear icons. No 3D effects, no neon, no stock-photo cliches, no aggressive sales copy.');
    return parts.join('\n\n');
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

    var allowedImageModels = ['gpt-image-1', 'dall-e-3'];
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

app.listen(PORT, function () {
    console.log('Investment Tools API running on port ' + PORT);
});
