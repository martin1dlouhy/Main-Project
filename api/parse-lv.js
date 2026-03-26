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
        'VŽDY vrať POUZE platný JSON objekt (žádný markdown, žádný text okolo). Formát:\n' +
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
        'Text může být špatně extrahovaný z PDF — pokus se i tak rozpoznat klíčové údaje (číslo LV, katastrální území, parcely).';

    try {
        var message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: 'Analyzuj tento List vlastnictví z katastru nemovitostí (soubor: ' + (fileName || 'neznámý') + '):\n\n' +
                        (instructions ? 'POKYN OD UŽIVATELE: ' + instructions + '\n\n' : '') +
                        text.substring(0, 30000)
                }
            ],
            system: systemPrompt
        });

        var responseText = message.content[0].text;

        // Try to parse JSON from response — multiple strategies
        var parsed = null;

        // Strategy 1: Try direct parse (Claude returned pure JSON)
        try {
            parsed = JSON.parse(responseText.trim());
        } catch (e) { /* not pure JSON */ }

        // Strategy 2: Extract from markdown code block ```json ... ```
        if (!parsed) {
            var codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
            if (codeBlockMatch) {
                try {
                    parsed = JSON.parse(codeBlockMatch[1].trim());
                } catch (e) { /* invalid JSON in code block */ }
            }
        }

        // Strategy 3: Find JSON object or array with balanced braces
        if (!parsed) {
            // Try array first, then object
            var jsonStr = null;
            var startIdx = responseText.indexOf('[');
            var startObj = responseText.indexOf('{');

            // Use whichever comes first, prefer array if both exist
            if (startIdx !== -1 && (startObj === -1 || startIdx < startObj)) {
                jsonStr = responseText.substring(startIdx, responseText.lastIndexOf(']') + 1);
            } else if (startObj !== -1) {
                jsonStr = responseText.substring(startObj, responseText.lastIndexOf('}') + 1);
            }

            if (jsonStr) {
                try {
                    parsed = JSON.parse(jsonStr);
                } catch (e) { /* still invalid */ }
            }
        }

        if (parsed) {
            // Normalize to array
            var results = Array.isArray(parsed) ? parsed : [parsed];
            return res.status(200).json({ success: true, data: results });
        } else {
            console.error('Failed to parse JSON from Claude response:', responseText.substring(0, 500));
            return res.status(200).json({ success: false, error: 'Claude nedokázal z textu extrahovat strukturovaná data.', raw: responseText.substring(0, 1000) });
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
