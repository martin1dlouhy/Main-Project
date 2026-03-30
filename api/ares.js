// Timeout helper compatible with Node 16+
function createTimeout(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        return AbortSignal.timeout(ms);
    }
    var controller = new AbortController();
    setTimeout(function() { controller.abort(); }, ms);
    return controller.signal;
}

module.exports = async function handler(req, res) {
    // CORS headers
    var allowedOrigins = ['https://main-five-alpha.vercel.app', 'http://localhost:3000'];
    var origin = req.headers.origin || '';
    if (allowedOrigins.indexOf(origin) !== -1) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    var ico = (req.query.ico || '').trim();
    var name = (req.query.name || '').trim();

    if (!ico && !name) {
        return res.status(400).json({ error: 'Zadejte parametr ico nebo name.' });
    }

    var ARES_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';

    try {
        var results = [];

        if (ico) {
            // Direct lookup by IČO
            var cleanIco = ico.replace(/\s/g, '');
            if (!/^\d{1,8}$/.test(cleanIco)) {
                return res.status(400).json({ error: 'IČO musí být číslo (max 8 číslic).' });
            }

            var response = await fetch(ARES_BASE + '/ekonomicke-subjekty/' + cleanIco, {
                headers: { 'Accept': 'application/json' },
                signal: createTimeout(10000)
            });

            if (response.status === 404) {
                return res.status(200).json({ success: true, data: [], message: 'Subjekt s IČO ' + cleanIco + ' nebyl nalezen.' });
            }

            if (!response.ok) {
                return res.status(502).json({ error: 'ARES API vrátilo chybu ' + response.status });
            }

            var data = await response.json();
            var parsed = parseSubject(data);
            if (parsed) results.push(parsed);

        } else if (name) {
            // Search by company name
            if (name.length < 3) {
                return res.status(400).json({ error: 'Název musí mít alespoň 3 znaky.' });
            }

            var searchBody = {
                obchodniJmeno: name,
                start: 0,
                pocet: 10
            };

            var response = await fetch(ARES_BASE + '/ekonomicke-subjekty/vyhledat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(searchBody),
                signal: createTimeout(10000)
            });

            if (!response.ok) {
                return res.status(502).json({ error: 'ARES API vrátilo chybu ' + response.status });
            }

            var data = await response.json();

            // Response structure: { pocetCelkem, ekonomickeSubjekty: [...] }
            var subjects = data.ekonomickeSubjekty || [];
            subjects.forEach(function(subj) {
                var parsed = parseSubject(subj);
                if (parsed) results.push(parsed);
            });
        }

        return res.status(200).json({ success: true, data: results });

    } catch (err) {
        console.error('ARES API error:', err.message);
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            return res.status(504).json({ error: 'ARES API neodpověděl včas (timeout 10s). Zkuste to znovu.' });
        }
        return res.status(500).json({ error: 'Chyba při komunikaci s ARES: ' + err.message });
    }
};

// Parse ARES subject into simplified format
function parseSubject(subj) {
    if (!subj) return null;

    var ico = subj.ico || subj.icoId || null;
    var nazev = subj.obchodniJmeno || subj.nazev || null;

    // Address — try textovaAdresa first, then build from parts
    var sidlo = '';
    if (subj.sidlo) {
        if (subj.sidlo.textovaAdresa) {
            sidlo = subj.sidlo.textovaAdresa;
        } else {
            var parts = [];
            if (subj.sidlo.nazevUlice) {
                parts.push(subj.sidlo.nazevUlice);
                var cislo = '';
                if (subj.sidlo.cisloDomovni) cislo += subj.sidlo.cisloDomovni;
                if (subj.sidlo.cisloOrientacni) cislo += '/' + subj.sidlo.cisloOrientacni;
                if (subj.sidlo.cisloOrientacniPismeno) cislo += subj.sidlo.cisloOrientacniPismeno;
                if (cislo) parts[parts.length - 1] += ' ' + cislo;
            } else if (subj.sidlo.cisloDomovni) {
                parts.push('č.p. ' + subj.sidlo.cisloDomovni);
            }
            if (subj.sidlo.nazevCastiObce && subj.sidlo.nazevCastiObce !== subj.sidlo.nazevObce) {
                parts.push(subj.sidlo.nazevCastiObce);
            }
            if (subj.sidlo.psc) {
                var pscStr = String(subj.sidlo.psc);
                if (pscStr.length === 5) pscStr = pscStr.substring(0, 3) + ' ' + pscStr.substring(3);
                parts.push(pscStr + (subj.sidlo.nazevObce ? ' ' + subj.sidlo.nazevObce : ''));
            } else if (subj.sidlo.nazevObce) {
                parts.push(subj.sidlo.nazevObce);
            }
            sidlo = parts.join(', ');
        }
    }

    // Spisová značka — from VR registry data
    var spisovaZnacka = extractSpisovaZnacka(subj);

    // Právní forma
    var pravniForma = null;
    if (subj.pravniForma) {
        pravniForma = subj.pravniForma.nazev || subj.pravniForma || null;
    }

    return {
        nazev: nazev,
        ico: ico,
        sidlo: sidlo || null,
        spisovaZnacka: spisovaZnacka,
        pravniForma: typeof pravniForma === 'string' ? pravniForma : null
    };
}

// Extract spisová značka from various possible locations in ARES response
function extractSpisovaZnacka(subj) {
    // Try seznamRegistraci → VR records → spisová značka
    if (subj.seznamRegistraci) {
        // Could be array or object with stavZdrojeVr, etc.
        var vr = subj.seznamRegistraci.stavZdrojeVr ||
                 subj.seznamRegistraci.vr ||
                 null;

        if (vr && vr.spisovaZnacka) {
            return formatSpisovaZnacka(vr.spisovaZnacka);
        }

        // Try nested structures
        if (subj.seznamRegistraci.registrace) {
            var regs = Array.isArray(subj.seznamRegistraci.registrace)
                ? subj.seznamRegistraci.registrace
                : [subj.seznamRegistraci.registrace];
            for (var i = 0; i < regs.length; i++) {
                if (regs[i].spisovaZnacka) {
                    return formatSpisovaZnacka(regs[i].spisovaZnacka);
                }
            }
        }
    }

    // Try direct field
    if (subj.spisovaZnacka) {
        return formatSpisovaZnacka(subj.spisovaZnacka);
    }

    // Try dalsiUdaje array
    if (subj.dalsiUdaje && Array.isArray(subj.dalsiUdaje)) {
        for (var i = 0; i < subj.dalsiUdaje.length; i++) {
            var ud = subj.dalsiUdaje[i];
            if (ud.spisovaZnacka) {
                return formatSpisovaZnacka(ud.spisovaZnacka);
            }
        }
    }

    return null;
}

function formatSpisovaZnacka(sz) {
    if (typeof sz === 'string') return sz;
    if (sz && typeof sz === 'object') {
        var parts = [];
        if (sz.oddil) parts.push(sz.oddil);
        if (sz.vlozka) parts.push(sz.vlozka);
        var result = parts.join(' ');
        if (sz.soud) result += ' vedená u ' + sz.soud;
        return result || null;
    }
    return null;
}
