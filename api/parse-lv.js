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
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    }

    var text = req.body && req.body.text;
    var fileName = req.body && req.body.fileName;

    if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: 'No text content provided or text is too short.' });
    }

    // Limit text length to prevent excessive API costs
    if (text.length > 100000) {
        return res.status(400).json({ error: 'Text is too long (max 100 000 characters).' });
    }

    var client = new Anthropic({ apiKey: apiKey });

    var systemPrompt = `Jsi expert na analýzu českých katastrálních dokumentů — Listů vlastnictví (LV).
Tvým úkolem je z poskytnutého textu extrahovat strukturovaná data.

VŽDY vrať POUZE platný JSON objekt (žádný markdown, žádný text okolo). Formát:
{
  "lv_cislo": "číslo LV nebo null",
  "katastralni_uzemi": "název katastrálního území nebo null",
  "obec": "název obce nebo null",
  "vlastnici": ["jméno vlastníka 1", "jméno vlastníka 2"],
  "parcely": [
    {
      "typ": "pozemek nebo stavba",
      "parcelni_cislo": "číslo parcely (např. st. 123 nebo 456/2)",
      "vymera": "výměra v m² nebo null",
      "druh": "druh pozemku nebo typ stavby nebo null",
      "zpusob_vyuziti": "způsob využití nebo null"
    }
  ],
  "zastavni_prava": [
    {
      "typ": "Zástavní právo smluvní / exekutorské / soudcovské",
      "oprávněný": "název oprávněného subjektu",
      "castka": "částka pohledávky nebo null"
    }
  ],
  "vecna_bremena": [
    {
      "typ": "popis věcného břemene",
      "oprávněný": "oprávněný subjekt nebo null"
    }
  ],
  "omezeni": ["další omezení vlastnického práva - textové popisy"],
  "collateral_summary": "Stručný jednořádkový popis pro pole zajištění v Term Sheetu, např: LV 303, kú Čečovice — pozemky p.č. 456/2, 456/3 (celkem 2 500 m²)"
}

Pokud některé údaje v textu nejsou, vrať null nebo prázdné pole.
Pokud text obsahuje více LV, vrať pole JSON objektů.
Klíč "collateral_summary" je nejdůležitější — měl by obsahovat stručný popis vhodný do Term Sheetu.`;

    try {
        var message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: 'Analyzuj tento List vlastnictví z katastru nemovitostí (soubor: ' + (fileName || 'neznámý') + '):\n\n' + text.substring(0, 30000)
                }
            ],
            system: systemPrompt
        });

        var responseText = message.content[0].text;

        // Try to parse JSON from response
        var jsonMatch = responseText.match(/\[[\s\S]*\]/) || responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            var parsed = JSON.parse(jsonMatch[0]);
            // Normalize to array
            var results = Array.isArray(parsed) ? parsed : [parsed];
            return res.status(200).json({ success: true, data: results });
        } else {
            return res.status(200).json({ success: false, error: 'Could not parse structured data from response.', raw: responseText });
        }
    } catch (err) {
        console.error('Claude API error:', err);
        return res.status(500).json({ error: 'Claude API error: ' + (err.message || 'Unknown error') });
    }
};
