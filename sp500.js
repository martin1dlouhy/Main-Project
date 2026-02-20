const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Cache at Vercel CDN edge for 24 hours, serve stale up to 1h while revalidating
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

    try {
        const response = await fetch('https://www.slickcharts.com/sp500', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });

        if (!response.ok) {
            throw new Error(`Slickcharts returned HTTP ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const data = [];

        // Parse the S&P 500 table - each row has: #, Company, Symbol, Weight, Price, Chg, %Chg
        $('table.table-hover tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 5) {
                const rank = parseInt($(cols[0]).text().trim());
                const name = $(cols[1]).text().trim();
                const ticker = $(cols[2]).text().trim();
                const weightText = $(cols[3]).text().trim().replace('%', '');
                const priceText = $(cols[4]).text().trim().replace(/,/g, '');

                const weight = parseFloat(weightText);
                const price = parseFloat(priceText);

                if (ticker && !isNaN(weight) && !isNaN(price) && weight > 0) {
                    data.push({
                        t: ticker,
                        n: name,
                        w: weight,
                        p: price
                    });
                }
            }
        });

        // Fallback: if table selector didn't work, try broader selectors
        if (data.length === 0) {
            $('table tbody tr').each((i, row) => {
                const cols = $(row).find('td');
                if (cols.length >= 5) {
                    const name = $(cols[1]).text().trim();
                    const ticker = $(cols[2]).text().trim();
                    const weightText = $(cols[3]).text().trim().replace('%', '');
                    const priceText = $(cols[4]).text().trim().replace(/,/g, '');

                    const weight = parseFloat(weightText);
                    const price = parseFloat(priceText);

                    if (ticker && ticker.length <= 5 && !isNaN(weight) && !isNaN(price) && weight > 0) {
                        data.push({
                            t: ticker,
                            n: name,
                            w: weight,
                            p: price
                        });
                    }
                }
            });
        }

        if (data.length < 400) {
            throw new Error(`Only parsed ${data.length} companies — expected 500+. HTML structure may have changed.`);
        }

        const totalWeight = data.reduce((sum, d) => sum + d.w, 0);

        res.status(200).json({
            updated: new Date().toISOString(),
            source: 'slickcharts.com/sp500',
            count: data.length,
            totalWeight: Math.round(totalWeight * 100) / 100,
            data
        });

    } catch (error) {
        console.error('S&P 500 scrape failed:', error.message);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
