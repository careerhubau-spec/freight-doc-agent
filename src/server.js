// Local demo: node src/server.js, then open http://localhost:4321
// Shows the two documents (editable), then streams each agent step as it happens.
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processShipment } from './agent.js';

const PORT = Number(process.env.PORT ?? 4321);
const root = join(import.meta.dirname, '..');
const casesDir = join(root, 'eval', 'cases');

const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/') return send(res, 200, readFileSync(join(root, 'demo', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
        if (req.method === 'GET' && req.url === '/cases') {
            const ids = readdirSync(casesDir).filter((d) => d.startsWith('case-')).sort();
            return send(res, 200, ids.map((id) => ({ id, expected: JSON.parse(readFileSync(join(casesDir, id, 'truth.json'), 'utf8')).expected_flags })));
        }
        const m = req.url.match(/^\/case\/(case-\d{3})$/);
        if (req.method === 'GET' && m) {
            const read = (f) => readFileSync(join(casesDir, m[1], f), 'utf8');
            return send(res, 200, { invoice: read('commercial_invoice.txt'), packing: read('packing_list.txt') });
        }
        if (req.method === 'POST' && req.url === '/run') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { invoice, packing } = JSON.parse(body);
            res.writeHead(200, { 'content-type': 'application/x-ndjson' });
            const emit = (o) => res.write(JSON.stringify(o) + '\n');
            try {
                const out = await processShipment([{ name: 'commercial_invoice.txt', text: invoice }, { name: 'packing_list.txt', text: packing }], { onStep: emit });
                emit({ step: 'done', ...out });
            } catch (e) {
                emit({ step: 'error', message: e.message });
            }
            return res.end();
        }
        send(res, 404, { error: 'not found' });
    } catch (e) {
        send(res, 500, { error: e.message });
    }
}).listen(PORT, () => console.log(`Freight Doc Agent demo: http://localhost:${PORT}`));
