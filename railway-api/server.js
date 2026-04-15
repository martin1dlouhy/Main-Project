const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

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

// DALL-E Image Generation endpoint
app.post('/api/marketing/generate-image', async function (req, res) {
    var openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not set. Add it in Railway → Variables.' });
    }
    if (!OpenAI) {
        return res.status(500).json({ error: 'openai package not installed.' });
    }

    var body = req.body || {};
    var prompt = body.prompt || '';
    var size = body.size || '1024x1024';
    var quality = body.quality || 'standard';
    // Povolené modely — default gpt-image-1 (novější, umí text v obrázku), fallback dall-e-3
    var allowedImageModels = ['gpt-image-1', 'dall-e-3'];
    var imageModel = allowedImageModels.indexOf(body.imageModel) !== -1 ? body.imageModel : 'gpt-image-1';

    if (!prompt || prompt.length < 10) {
        return res.status(400).json({ error: 'Image prompt is required (min 10 chars).' });
    }

    try {
        var openai = new OpenAI({ apiKey: openaiKey });
        // Quality mapping — gpt-image-1 používá 'low'/'medium'/'high', dall-e-3 používá 'standard'/'hd'
        var effectiveQuality = quality;
        if (imageModel === 'gpt-image-1') {
            if (quality === 'standard') effectiveQuality = 'medium';
            else if (quality === 'hd') effectiveQuality = 'high';
        }

        var genParams = {
            model: imageModel,
            prompt: prompt,
            n: 1,
            size: size,
            quality: effectiveQuality
        };
        // dall-e-3 podporuje response_format, gpt-image-1 vrací b64_json defaultně
        if (imageModel === 'dall-e-3') {
            genParams.response_format = 'b64_json';
        }

        var response = await openai.images.generate(genParams);

        var imageData = response.data[0];
        res.json({
            success: true,
            image: imageData.b64_json,
            revisedPrompt: imageData.revised_prompt || null,
            model: imageModel
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
    var channel = body.channel || 'linkedin';
    var audience = body.audience || 'owners';
    var pillar = body.pillar || 'product';
    var postType = body.postType || 'social-post';
    var goal = body.goal || 'awareness';
    var theme = body.theme;
    var tone = body.tone || 'factual';
    var emojiLevel = body.emojiLevel || 'few';
    var hashtagLevel = body.hashtagLevel || 'few';
    var batchCount = Math.min(Math.max(parseInt(body.batchCount) || 1, 1), 5);
    var generateImage = body.generateImage || false;
    var imageSettings = body.imageSettings || {};
    // Výběr OpenAI modelu pro text — default gpt-4o-mini, povolené i gpt-4o
    var allowedTextModels = ['gpt-4o-mini', 'gpt-4o'];
    var textModel = allowedTextModels.indexOf(body.textModel) !== -1 ? body.textModel : 'gpt-4o-mini';

    if (!theme || theme.trim().length < 3) {
        return res.status(400).json({ error: 'Téma příspěvku je povinné (min. 3 znaky).' });
    }

    var openai = new OpenAI({ apiKey: openaiKey });

    // Build ProfiLend knowledge context
    var knowledgeBase = 'ZNALOSTNÍ BÁZE — ProfiLend:\n' +
        '- ProfiLend poskytuje nebankovní financování zajištěné nemovitostmi v ČR\n' +
        '- Objem: 10–250 mil. Kč, LTV max 70%, sazba od 9% p.a., splatnost 1–20 let\n' +
        '- Portfolio přesáhlo 1,3 mld. Kč, rozhodnutí do 48 hodin\n' +
        '- Pouze právnické osoby, pouze české nemovitosti\n' +
        '- Tón komunikace: věcný, sebevědomý, lidský, přímý, expertní\n' +
        '- Obsahové pilíře: Produkt/proces 30%, Případovka 25%, Edukace 25%, Značka 20%\n' +
        '- Schválené CTA: "Zjistit více na ProfiLend.cz", "Napište nám", "Konzultace zdarma", "Začněte s ProfiLend dnes", "Nezávazná konzultace"\n' +
        '- ZAKÁZANÁ slova: "nejlevnější", "garantujeme", "bez rizika", "100%", "okamžitě", "senzační", "revoluční", "převratný", "bombastický", "neuvěřitelný", "fantastický", "zázračný", "exkluzivní nabídka"\n' +
        '- Web: profilend.cz\n';

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

    var hashtagRules = {
        none: 'Žádné hashtagy.',
        few: 'Na konec příspěvku přidej 3–5 relevantních hashtagů (vždy #ProfiLend jako první).',
        many: 'Na konec příspěvku přidej 5–8 hashtagů (vždy #ProfiLend jako první).'
    };

    var goalMap = {
        awareness: 'Cíl: zvýšit povědomí o značce ProfiLend.',
        leads: 'Cíl: získat poptávky a leady — příspěvek musí motivovat k akci.',
        trust: 'Cíl: budovat důvěru a expertizu — ukázat odbornost.',
        educate: 'Cíl: edukovat publikum o financování nemovitostí.',
        engagement: 'Cíl: zvýšit zapojení — otázky, ankety, interakce.',
        partners: 'Cíl: oslovit potenciální partnery (makléře, poradce, právníky).'
    };

    var systemPrompt = 'Jsi marketingový copywriter pro ProfiLend. Generuješ příspěvky na sociální sítě.\n\n' +
        knowledgeBase + '\n' +
        (channelRules[channel] || '') + '\n' +
        (emojiRules[emojiLevel] || '') + '\n' +
        (hashtagRules[hashtagLevel] || '') + '\n' +
        (goalMap[goal] || '') + '\n\n' +
        'PRAVIDLA:\n' +
        '- Piš přirozeně, NE jako AI. Žádné fráze jako "V dnešní době", "Věděli jste, že".\n' +
        '- Nepoužívej zakázaná slova.\n' +
        '- Každý příspěvek MUSÍ obsahovat jedno z povolených CTA.\n' +
        '- Formát: hook (první věta chytlavá) → hlavní sdělení → CTA.\n' +
        '- DŮLEŽITÉ: Vrať POUZE platný JSON, žádný markdown.\n';

    // Image-related pole jen když uživatel chce obrázek
    var imageFieldSpec = generateImage
        ? ',\n' +
          '      "visualHook": "KRÁTKÁ hláška 3–8 slov určená k vložení PŘÍMO DO OBRÁZKU (bez hashtagů, bez CTA; konkrétní, čitelná, bez diakritiky pokud to zlepší čitelnost)",\n' +
          '      "imagePrompt": "ANGLICKÝ popis obrázku pro DALL·E/gpt-image-1 (1–3 věty). MUSÍ obsahovat pokyn, že text \\"VISUAL_HOOK\\" má být vysazen jako typografie uvnitř kompozice (bold sans-serif). Styl: profesionální B2B finanční služby, minimalistický design, barvy tyrkysová (#00B4D8), navy (#1A2B4A), bílá. Bez stock photo klišé, bez neonových barev."'
        : '';

    var imageInstructions = generateImage
        ? '\n\nOBRÁZEK: Ke každému příspěvku VRAŤ pole "visualHook" a "imagePrompt". visualHook = krátká, úderná věta/slogan, která se vloží PŘÍMO do obrázku jako viditelný text (např. "Rozhodnutí do 48 hodin", "Financování do 250 mil. Kč"). imagePrompt = anglický popis kompozice pro image generátor, který EXPLICITNĚ řekne modelu, že "VISUAL_HOOK" má být vysazen jako typografie v obrázku.'
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

    console.log('Marketing generate request:', { channel: channel, theme: theme, batchCount: batchCount, generateImage: generateImage, textModel: textModel });

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
                    if (post.imagePrompt && String(post.imagePrompt).length > 20) {
                        // Nahradíme placeholder VISUAL_HOOK, pokud ho GPT ponechalo
                        imgPrompt = String(post.imagePrompt).replace(/VISUAL_HOOK/g, visualHook);
                    } else {
                        // Fallback — sestavíme deterministický prompt ze settings + visualHook
                        var visualType = imageSettings.visualType || 'typ1';
                        var people = imageSettings.people || 'none';
                        var scene = imageSettings.scene || 'abstract';
                        var mood = imageSettings.mood || 'professional';
                        var format = imageSettings.format || '1:1';
                        imgPrompt = buildServerImagePrompt(visualType, people, scene, mood, format, theme, idx);
                        if (visualHook) {
                            imgPrompt += ' Include the text "' + visualHook + '" prominently as bold sans-serif typography within the composition.';
                        }
                    }
                }
                return {
                    index: idx + 1,
                    text: post.text,
                    hook: post.hook || '',
                    cta: post.cta || '',
                    visualHook: visualHook,
                    imagePrompt: imgPrompt
                };
            });

            return res.status(200).json({
                success: true,
                posts: posts,
                model: textModel,
                cached: false
            });
        } else {
            console.error('Invalid OpenAI response:', responseText.substring(0, 500));
            return res.status(200).json({ success: false, error: 'AI nevrátilo platný formát. Zkuste to znovu.' });
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
