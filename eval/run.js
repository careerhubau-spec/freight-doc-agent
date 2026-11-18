// Runs the agent over the labelled cases and scores it.
//   Field accuracy: share of key fields keyed exactly as printed (numbers within 0.01).
//   Flag precision / recall: did it raise the planted discrepancies, and only those?
//   Clean pass rate: share of error-free shipments marked ready with no false alarms.
//
// Usage: node eval/run.js [--limit N] [--no-reread] [--concurrency 3]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processShipment } from '../src/agent.js';
import { ENGINE } from '../src/llm.js';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const LIMIT = Number(arg('--limit', 1e9));
const CONC = Number(arg('--concurrency', 3));
const REREAD = !process.argv.includes('--no-reread');
const dir = join(import.meta.dirname, 'cases');

const FIELDS = ['invoice_number', 'invoice_date', 'shipper.name', 'shipper.country', 'consignee.name', 'consignee.abn', 'incoterm', 'currency',
    'total_invoice_value', 'port_of_loading', 'port_of_discharge', 'origin_country', 'invoice_packages', 'invoice_gross_weight_kg',
    'packing.packages', 'packing.gross_weight_kg', 'packing.net_weight_kg', 'packing.volume_cbm'];
const LINE_FIELDS = ['hs_code', 'quantity', 'unit_price', 'line_total', 'origin_country'];

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const norm = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : v);
function same(a, b) {
    if (typeof b === 'number') return typeof a === 'number' && Math.abs(a - b) < 0.011;
    if (b == null) return a == null || a === '';
    // Port and company names: accept the printed name with or without a qualifier, e.g. "Sydney" vs "Sydney (Port Botany)".
    const x = norm(a ?? '');
    const y = norm(b);
    return x === y || (x.length >= 4 && (y.startsWith(x) || x.startsWith(y)));
}

function score(c, out) {
    const misses = [];
    let right = 0;
    let total = 0;
    for (const f of FIELDS) {
        total++;
        if (same(get(out.entry, f), get(c.truth, f))) right++;
        else misses.push(`${f}: got ${JSON.stringify(get(out.entry, f))}, printed ${JSON.stringify(get(c.truth, f))}`);
    }
    c.truth.lines.forEach((tl, i) => {
        const ol = out.entry.lines[i] ?? {};
        for (const f of LINE_FIELDS) {
            total++;
            if (same(ol[f], tl[f])) right++;
            else misses.push(`lines[${i}].${f}: got ${JSON.stringify(ol[f])}, printed ${JSON.stringify(tl[f])}`);
        }
    });
    if (out.entry.lines.length !== c.truth.lines.length) misses.push(`line count: got ${out.entry.lines.length}, printed ${c.truth.lines.length}`);
    const raised = [...new Set(out.flags.filter((f) => f.severity === 'error').map((f) => f.type))];
    return {
        right, total, misses,
        tp: raised.filter((t) => c.expected_flags.includes(t)).length,
        fp: raised.filter((t) => !c.expected_flags.includes(t)),
        fn: c.expected_flags.filter((t) => !raised.includes(t)),
        clean: c.expected_flags.length === 0,
        cleanPass: c.expected_flags.length === 0 && out.status === 'ready',
    };
}

const ids = readdirSync(dir).filter((d) => d.startsWith('case-')).sort().slice(0, LIMIT);
const results = [];
let next = 0;
async function worker() {
    while (next < ids.length) {
        const id = ids[next++];
        const c = JSON.parse(readFileSync(join(dir, id, 'truth.json'), 'utf8'));
        const docs = ['commercial_invoice.txt', 'packing_list.txt'].map((name) => ({ name, text: readFileSync(join(dir, id, name), 'utf8') }));
        try {
            const out = await processShipment(docs, { reread: REREAD });
            const s = score(c, out);
            results.push({ id, ...s, usage: out.usage, trace: out.trace });
            console.log(`${id}  fields ${s.right}/${s.total}  flags +${s.tp} fp[${s.fp}] fn[${s.fn}]  ${(out.usage.ms / 1000).toFixed(0)}s`);
        } catch (e) {
            results.push({ id, error: e.message });
            console.log(`${id}  ERROR ${e.message}`);
        }
    }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, worker));

const ok = results.filter((r) => !r.error);
const sum = (k) => ok.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : r[k].length), 0);
const tp = sum('tp');
const fp = sum('fp');
const fn = sum('fn');
const clean = ok.filter((r) => r.clean);
const corrected = ok.reduce((s, r) => s + (r.trace.find((t) => t.step === 'reread')?.corrected.length ?? 0), 0);
const report = {
    run_at: new Date().toISOString(), engine: ENGINE, reread: REREAD, cases: results.length, errors: results.length - ok.length,
    field_accuracy: +(sum('right') / sum('total')).toFixed(4),
    perfect_entries: ok.filter((r) => r.misses.length === 0).length,
    flag_precision: tp + fp ? +(tp / (tp + fp)).toFixed(4) : null,
    flag_recall: tp + fn ? +(tp / (tp + fn)).toFixed(4) : null,
    clean_pass_rate: clean.length ? +(clean.filter((r) => r.cleanPass).length / clean.length).toFixed(4) : null,
    misreads_fixed_by_reread: corrected,
    avg_seconds_per_shipment: +(ok.reduce((s, r) => s + r.usage.ms, 0) / ok.length / 1000).toFixed(1),
    avg_calls_per_shipment: +(ok.reduce((s, r) => s + r.usage.calls, 0) / ok.length).toFixed(2),
    wall_clock_minutes: +((Date.now() - t0) / 60000).toFixed(1),
    results: results.sort((a, b) => a.id.localeCompare(b.id)),
};
mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
const file = join(import.meta.dirname, 'results', `${report.run_at.slice(0, 16).replace(':', '')}${REREAD ? '' : '-no-reread'}.json`);
writeFileSync(file, JSON.stringify(report, null, 1));
const { results: _, ...headline } = report;
console.log(headline);
console.log(`Saved ${file}`);
