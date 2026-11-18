// Builds a labelled test set of synthetic shipments: a commercial invoice and a packing list per case,
// in several real-world layouts and number formats, with known discrepancies planted in some of them.
// truth.json holds what the documents PRINT (so a planted error is part of the truth) and the flags a
// careful forwarder should raise. All companies, ABNs and numbers are invented.
//
// Usage: node eval/generate.js [count=50] [seed=7]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COUNT = Number(process.argv[2] ?? 50);
let seed = Number(process.argv[3] ?? 7);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const r2 = (n) => Math.round(n * 100) / 100;

const SHIPPERS = [
    { name: 'Ningbo Everbright Housewares Co., Ltd', country: 'CN', cname: 'China', port: 'Ningbo', ccy: 'USD', fmt: 'en' },
    { name: 'Shenzhen Brightpath Electronics Ltd', country: 'CN', cname: 'China', port: 'Shenzhen (Yantian)', ccy: 'USD', fmt: 'en' },
    { name: 'Saigon Timberline Furniture JSC', country: 'VN', cname: 'Viet Nam', port: 'Ho Chi Minh City (Cat Lai)', ccy: 'USD', fmt: 'en' },
    { name: 'Bremer Küchentechnik GmbH', country: 'DE', cname: 'Germany', port: 'Hamburg', ccy: 'EUR', fmt: 'eu' },
    { name: 'Calzaturificio Monteverde S.r.l.', country: 'IT', cname: 'Italy', port: 'La Spezia', ccy: 'EUR', fmt: 'eu' },
    { name: 'Siam Coastal Textiles Co., Ltd', country: 'TH', cname: 'Thailand', port: 'Laem Chabang', ccy: 'USD', fmt: 'en' },
    { name: 'Tirupur Organic Knits Pvt Ltd', country: 'IN', cname: 'India', port: 'Chennai', ccy: 'USD', fmt: 'en' },
    { name: 'Osaka Precision Tools K.K.', country: 'JP', cname: 'Japan', port: 'Osaka', ccy: 'JPY', fmt: 'en' },
];
const CONSIGNEES = ['Southbank Home Goods Pty Ltd', 'Dandenong Trade Supplies Pty Ltd', 'Coastline Retail Group Pty Ltd', 'Westgate Kitchen Co Pty Ltd', 'Ironbark Outdoor Pty Ltd', 'Harbourline Imports Pty Ltd'];
const DISCHARGE = ['Melbourne', 'Sydney (Port Botany)', 'Brisbane', 'Fremantle'];
const PRODUCTS = [ // illustrative tariff codes
    { d: 'Stainless steel cookware set, 5 pc', hs: '7323.93.00', u: 'SET', p: [18, 45], kg: 4.2 },
    { d: 'Electric drip coffee maker 1.5L', hs: '8516.71.00', u: 'PCS', p: [11, 29], kg: 2.1 },
    { d: 'Laptop power adapter 65W', hs: '8504.40.90', u: 'PCS', p: [3, 9], kg: 0.35 },
    { d: 'Solid acacia dining table 180cm', hs: '9403.60.00', u: 'PCS', p: [95, 210], kg: 38 },
    { d: "Men's leather derby shoe", hs: '6403.99.00', u: 'PRS', p: [22, 60], kg: 1.1 },
    { d: 'Cotton crew-neck T-shirt', hs: '6109.10.00', u: 'PCS', p: [1.8, 5.5], kg: 0.2 },
    { d: 'Polyester travel backpack 30L', hs: '4202.92.00', u: 'PCS', p: [6, 17], kg: 0.9 },
    { d: 'Plastic storage container 12L', hs: '3926.90.99', u: 'PCS', p: [0.9, 3.2], kg: 0.6 },
    { d: 'Cordless drill driver 18V', hs: '8467.21.00', u: 'PCS', p: [21, 48], kg: 1.8 },
    { d: 'Wooden toy train set', hs: '9503.00.90', u: 'SET', p: [4, 12], kg: 1.3 },
];
const INCOTERMS = ['FOB', 'FOB', 'CIF', 'CFR', 'EXW', 'FCA', 'DAP'];
const ERRORS = ['line_math', 'total_mismatch', 'weight_mismatch', 'package_mismatch', 'bad_hs', 'bad_abn', 'gross_lt_net', 'missing_origin'];

function abn(valid = true) {
    for (;;) {
        const d = Array.from({ length: 11 }, (_, i) => (i === 0 ? int(1, 9) : int(0, 9)));
        const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
        const ok = d.reduce((s, x, i) => s + (i === 0 ? x - 1 : x) * w[i], 0) % 89 === 0;
        if (ok === valid) return d.join('');
    }
}
const spacedAbn = (a) => `${a.slice(0, 2)} ${a.slice(2, 5)} ${a.slice(5, 8)} ${a.slice(8)}`;
const num = (n, fmt, dp = 2) => {
    const s = n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return fmt === 'eu' ? s.replace(/,/g, '§').replace(/\./g, ',').replace(/§/g, '.') : s;
};
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function makeCase(i) {
    const sh = pick(SHIPPERS);
    const nErr = rnd() < 0.4 ? 0 : rnd() < 0.75 ? 1 : 2;
    const errors = [];
    while (errors.length < nErr) {
        const e = pick(ERRORS);
        if (!errors.includes(e)) errors.push(e);
    }
    const has = (e) => errors.includes(e);
    const dp = sh.ccy === 'JPY' ? 0 : 2;
    const round = (n) => (dp ? r2(n) : Math.round(n));

    const nLines = int(1, 5);
    const products = [...PRODUCTS].sort(() => rnd() - 0.5).slice(0, nLines);
    const lines = products.map((p) => {
        const quantity = p.kg > 20 ? pick([4, 6, 8, 10, 12, 20, 24]) : pick([24, 48, 50, 60, 100, 120, 200, 240, 300, 500]);
        let unit_price = r2(p.p[0] + rnd() * (p.p[1] - p.p[0]));
        if (sh.ccy === 'EUR') unit_price = r2(unit_price * 0.92);
        if (sh.ccy === 'JPY') unit_price = Math.round(unit_price * 150);
        return { description: p.d, hs_code: p.hs, quantity, unit: p.u, unit_price, line_total: round(quantity * unit_price), origin_country: sh.country, kg: p.kg };
    });
    if (has('line_math')) {
        const l = pick(lines);
        l.line_total = round(l.line_total + (dp ? pick([10, 100, -50, 9.9]) : pick([1000, -1500])));
    }
    if (has('bad_hs')) {
        const l = pick(lines);
        l.hs_code = l.hs_code.slice(0, 7); // 6 digits, e.g. 8516.71
    }
    let total = round(lines.reduce((s, l) => s + l.line_total, 0));
    if (has('total_mismatch')) total = round(total + (dp ? pick([100, 250, -120, 1000]) : pick([10000, -20000])));

    const net = r2(lines.reduce((s, l) => s + l.kg * l.quantity, 0));
    const packages = Math.max(1, Math.ceil(lines.reduce((s, l) => s + l.quantity, 0) / pick([6, 10, 12, 20])));
    const gross = r2(net * 1.12 + packages * 0.8);
    const pk = { packages, package_type: pick(['CTN', 'CTN', 'PLT', 'CRATE']), gross_weight_kg: gross, net_weight_kg: net, volume_cbm: r2(packages * pick([0.04, 0.06, 0.09, 0.3])) };
    if (has('gross_lt_net')) pk.net_weight_kg = r2(gross + int(5, 60));
    const invPackages = has('package_mismatch') ? (packages > 2 ? packages + pick([-2, -1, 1, 3]) : packages + pick([1, 2, 5])) : packages;
    const invGross = has('weight_mismatch') ? r2(gross + pick([-0.3, 0.25, 0.4, 1.1]) * gross) : gross;

    const consAbn = abn(!has('bad_abn'));
    const missingOrigin = has('missing_origin');
    const date = `2026-${String(int(6, 11)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
    const truth = {
        invoice_number: `${pick(['INV', 'CI', 'EXP', 'PI'])}-${int(2026000, 2026999)}`,
        invoice_date: date,
        shipper: { name: sh.name, country: sh.country },
        consignee: { name: pick(CONSIGNEES), abn: consAbn },
        incoterm: pick(INCOTERMS),
        currency: sh.ccy,
        total_invoice_value: total,
        port_of_loading: sh.port,
        port_of_discharge: pick(DISCHARGE),
        origin_country: missingOrigin ? null : sh.country,
        invoice_packages: invPackages,
        invoice_gross_weight_kg: invGross,
        packing: pk,
        lines: lines.map(({ kg, ...l }) => ({ ...l, origin_country: missingOrigin ? null : l.origin_country })),
    };
    return { id: `case-${String(i + 1).padStart(3, '0')}`, truth, expected_flags: errors.sort(), docs: render(truth, sh, dp) };
}

function render(t, sh, dp) {
    const f = (n, d = dp) => num(n, sh.fmt, d);
    const [y, m, d] = t.invoice_date.split('-');
    const dateText = pick([`${d}/${m}/${y}`, `${d}.${m}.${y}`, `${Number(d)} ${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m)]} ${y}`, t.invoice_date]);
    const abnText = rnd() < 0.5 ? spacedAbn(t.consignee.abn) : t.consignee.abn;
    const origin = t.origin_country ? `Country of Origin: ${sh.cname}` : '';
    const layout = pick(['table', 'blocks', 'compact']);
    let inv;
    if (layout === 'table') {
        inv = `COMMERCIAL INVOICE
Seller / Exporter: ${t.shipper.name}, ${sh.cname}
Buyer / Importer: ${t.consignee.name}, Victoria, Australia   ABN ${abnText}
Invoice No: ${t.invoice_number}      Date: ${dateText}
Terms of Delivery: ${t.incoterm} ${t.incoterm.startsWith('F') || t.incoterm === 'EXW' ? t.port_of_loading : t.port_of_discharge}      Currency: ${t.currency}
Port of Loading: ${t.port_of_loading}      Port of Discharge: ${t.port_of_discharge}, Australia
${origin}

${pad('Description', 36)}${pad('HS Code', 12)}${lpad('Qty', 7)} ${pad('Unit', 5)}${lpad('Unit Price', 12)}${lpad('Amount', 14)}
${'-'.repeat(86)}
${t.lines.map((l) => `${pad(l.description, 36)}${pad(l.hs_code, 12)}${lpad(l.quantity, 7)} ${pad(l.unit, 5)}${lpad(f(l.unit_price), 12)}${lpad(f(l.line_total), 14)}`).join('\n')}
${'-'.repeat(86)}
${lpad(`TOTAL ${t.incoterm} ${t.currency}`, 72)}${lpad(f(t.total_invoice_value), 14)}

Total packages: ${t.invoice_packages}     Total gross weight: ${f(t.invoice_gross_weight_kg, 2)} kg
We certify this invoice is true and correct.`;
    } else if (layout === 'blocks') {
        inv = `${t.shipper.name.toUpperCase()}
EXPORT INVOICE

Invoice number ........ ${t.invoice_number}
Invoice date .......... ${dateText}
Consignee ............. ${t.consignee.name}
                        ABN: ${abnText}
Incoterm .............. ${t.incoterm}
Currency .............. ${t.currency}
Loading port .......... ${t.port_of_loading}
Destination port ...... ${t.port_of_discharge}
${t.origin_country ? `Origin of goods ....... ${sh.cname}` : ''}

${t.lines.map((l, i) => `Item ${i + 1}: ${l.description}
   Tariff ${l.hs_code} | ${l.quantity} ${l.unit} @ ${f(l.unit_price)} = ${f(l.line_total)}`).join('\n')}

Invoice total (${t.currency}): ${f(t.total_invoice_value)}
Shipment: ${t.invoice_packages} packages, gross ${f(t.invoice_gross_weight_kg, 2)} KGS`;
    } else {
        inv = `INVOICE ${t.invoice_number} | ${dateText} | ${t.incoterm} | ${t.currency}
From: ${t.shipper.name} (${sh.cname})  To: ${t.consignee.name} ABN ${abnText}
Route: ${t.port_of_loading} -> ${t.port_of_discharge}${t.origin_country ? ` | Made in ${sh.cname}` : ''}
${t.lines.map((l) => `* ${l.description}; HS ${l.hs_code}; ${l.quantity} ${l.unit} x ${f(l.unit_price)} = ${f(l.line_total)}`).join('\n')}
Amount due: ${t.currency} ${f(t.total_invoice_value)}
Pkgs ${t.invoice_packages} / G.W. ${f(t.invoice_gross_weight_kg, 2)} kg`;
    }
    const p = t.packing;
    const pl = `PACKING LIST
Ref: ${t.invoice_number}     Shipper: ${t.shipper.name}     Consignee: ${t.consignee.name}
Marks & numbers: ${t.consignee.name.split(' ')[0].toUpperCase()} / ${t.port_of_discharge.split(' ')[0].toUpperCase()} / 1-${p.packages}

${t.lines.map((l) => `${pad(l.description, 36)} ${lpad(l.quantity, 6)} ${l.unit}`).join('\n')}

TOTAL: ${p.packages} ${p.package_type}
Gross weight: ${f(p.gross_weight_kg, 2)} kg    Net weight: ${f(p.net_weight_kg, 2)} kg    Measurement: ${f(p.volume_cbm, 2)} CBM`;
    return [{ name: 'commercial_invoice.txt', text: inv.replace(/\n{3,}/g, '\n\n') }, { name: 'packing_list.txt', text: pl }];
}

const out = join(import.meta.dirname, 'cases');
rmSync(out, { recursive: true, force: true });
const summary = {};
for (let i = 0; i < COUNT; i++) {
    const c = makeCase(i);
    const dir = join(out, c.id);
    mkdirSync(dir, { recursive: true });
    for (const d of c.docs) writeFileSync(join(dir, d.name), d.text + '\n');
    writeFileSync(join(dir, 'truth.json'), JSON.stringify({ truth: c.truth, expected_flags: c.expected_flags }, null, 1));
    for (const f of c.expected_flags.length ? c.expected_flags : ['(clean)']) summary[f] = (summary[f] ?? 0) + 1;
}
console.log(`Wrote ${COUNT} cases to eval/cases`, summary);
