const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', function (req, res) {
    res.json({ status: 'ok', service: 'Investment Tools API', timestamp: new Date().toISOString() });
});

app.get('/health', function (req, res) {
    res.json({ status: 'ok' });
});

// =============================================
// POST /api/verify-pin — Server-side PIN verification
// PIN hash stored in env variable PIN_HASH (bcrypt)
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
    var pinHash = process.env.PIN_HASH;
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

    try {
        var match = await bcrypt.compare(pin, pinHash);
        if (match) {
            // Reset attempts on success
            delete pinAttempts[ip];
            return res.status(200).json({ success: true });
        } else {
            return res.status(200).json({ success: false, error: 'Nesprávný PIN.' });
        }
    } catch (err) {
        console.error('PIN verification error:', err.message);
        return res.status(500).json({ success: false, error: 'Chyba při ověřování PINu.' });
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
    var fileName = req.body && req.body.fileName;
    var instructions = req.body && req.body.instructions;

    if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: 'Z dokumentu se nepodařilo extrahovat dostatek textu. PDF může být naskenované (obrázek místo textu).' });
    }

    if (text.length > 100000) {
        return res.status(400).json({ error: 'Text je příliš dlouhý (max 100 000 znaků).' });
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
        'U velkých LV s mnoha parcelami uveď VŠECHNY parcely — nevynechávej žádnou.';

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

        return null;
    }

    var inputText = text.substring(0, 30000);
    console.log('LV parse request:', { fileName: fileName, textLength: text.length, trimmedLength: inputText.length });

    try {
        var userContent = 'Analyzuj tento List vlastnictví z katastru nemovitostí (soubor: ' + (fileName || 'neznámý') + '):\n\n' +
            (instructions ? 'POKYN OD UŽIVATELE: ' + instructions + '\n\n' : '') +
            inputText;

        // Use assistant prefill to force JSON output — Claude must continue from "{"
        var message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8192,
            messages: [
                { role: 'user', content: userContent },
                { role: 'assistant', content: '{' }
            ],
            system: systemPrompt
        });

        // Reconstruct full JSON — prefill "{" + Claude's continuation
        var responseText = '{' + message.content[0].text;
        console.log('Claude response length:', responseText.length, 'first 100 chars:', responseText.substring(0, 100));

        var parsed = tryParseJSON(responseText);

        if (parsed) {
            var results = Array.isArray(parsed) ? parsed : [parsed];
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

app.listen(PORT, function () {
    console.log('Investment Tools API running on port ' + PORT);
});
