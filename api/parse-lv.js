const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
    // CORS headers
    var allowedOrigins = ['https://main-five-alpha.vercel.app', 'http://localhost:3000'];
    var origin = req.headers.origin || '';
    if (allowedOrigins.indexOf(origin) !== -1) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY není nastavený na serveru. Přidejte ho ve Vercel → Settings → Environment Variables.' });
    }

    var text = req.body && req.body.text;
    var fileName = req.body && req.body.fileName;
    var instructions = req.body && req.body.instructions;

    if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: 'Z dokumentu se nepodařilo extrahovat dostatek textu. PDF může být naskenované (obrázek místo textu).' });
    }

    // Limit text length to prevent excessive API costs
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
            errorMsg = 'Neplatný API klíč. Zkontrolujte ANTHROPIC_API_KEY na Vercelu.';
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
};
