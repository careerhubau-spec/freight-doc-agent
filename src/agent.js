// The agent: extract -> check -> re-read what failed -> check again -> decide.
//
// The key decision is telling "I misread the document" apart from "the document is wrong".
// A forwarder who keys the wrong number creates a customs problem; a forwarder who silently
// "fixes" a supplier's wrong number hides one. So when a check fails, the agent goes back to
// the document for those specific fields and must quote the printed text. If the printed text
// confirms the value, the discrepancy is real and goes to a human with the evidence attached.
import { askJson, stats } from './llm.js';
import { runChecks } from './checks.js';
import { EntrySchema, PatchSchema } from './schema.js';

const SYSTEM = `You are an experienced Australian freight forwarder keying a shipment entry from supplier documents.
Record every value exactly as the documents print it. Never correct the supplier's arithmetic, weights or codes:
if the document is internally inconsistent, keep the printed values - inconsistencies are flagged downstream.
Normalise formats only: numbers as plain decimals (European "1.234,50" -> 1234.5), dates as YYYY-MM-DD,
countries as ISO 3166-1 alpha-2, currencies as ISO 4217. Numeric dates on these
documents are day-first (DD/MM/YYYY) unless the document clearly says otherwise. Use null when a value is not stated anywhere.`;

const docsBlock = (docs) => docs.map((d) => `<document name="${d.name}">\n${d.text}\n</document>`).join('\n\n');

function getPath(obj, path) {
    return path.split(/[.[\]]/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
    const keys = path.split(/[.[\]]/).filter(Boolean);
    const last = keys.pop();
    const parent = keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (parent == null || !(last in parent)) return false;
    parent[last] = value;
    return true;
}

/**
 * @param {{name: string, text: string}[]} docs  Commercial invoice, packing list (plain text).
 * @param {{reread?: boolean}} opts  reread=false skips the self-check step (used for the ablation in the eval).
 */
export async function processShipment(docs, { reread = true, onStep = () => {} } = {}) {
    const before = { ...stats };
    const trace = [];

    onStep({ step: 'extract' });
    const entry = await askJson(SYSTEM, `Key the shipment entry from these documents.\n\n${docsBlock(docs)}`, EntrySchema);
    let issues = runChecks(entry);
    trace.push({ step: 'extract', issues: issues.map((i) => i.type) });
    onStep({ step: 'checked', entry, issues });

    const evidence = {};
    const toReread = issues.filter((i) => i.rereadable);
    if (reread && toReread.length) {
        const fields = [...new Set(toReread.flatMap((i) => relatedPaths(i, entry)))];
        onStep({ step: 'reread', fields });
        const current = Object.fromEntries(fields.map((p) => [p, getPath(entry, p)]));
        const patch = await askJson(SYSTEM, `${docsBlock(docs)}

These values were keyed from the documents above, and they fail a consistency check:
${toReread.map((i) => `- ${i.message}`).join('\n')}

Current values: ${JSON.stringify(current, null, 1)}

Look at each listed field again on the document itself. For each one, either confirm the current value
(quote the exact printed text) or correct it to what is actually printed (quote the exact printed text).
Do not make the numbers agree if the document itself does not.`, PatchSchema);

        const changed = [];
        for (const c of patch.corrections) {
            if (typeof getPath(entry, c.path) === 'number' && typeof c.value === 'string') c.value = Number(c.value.replace(/,/g, ''));
            if (fields.includes(c.path) && getPath(entry, c.path) !== c.value && setPath(entry, c.path, c.value)) changed.push(c.path);
            evidence[c.path] = c.printed_text;
        }
        for (const c of patch.confirmed) evidence[c.path] = c.printed_text;
        issues = runChecks(entry);
        trace.push({ step: 'reread', fields, corrected: changed, issues: issues.map((i) => i.type) });
        onStep({ step: 'rechecked', corrected: changed, issues });
    }

    // Quote both sides of a mismatch, e.g. "Pkgs 48" on the invoice and "TOTAL: 47 PLT" on the packing list.
    const flags = issues.map((i) => {
        const all = [...new Set(relatedPaths(i, entry).map((p) => evidence[p]).filter(Boolean))];
        const quotes = all.filter((q) => !all.some((o) => o !== q && o.includes(q))); // drop quotes already inside a longer one
        return { ...i, evidence: quotes.length ? quotes.join('  |  ') : null };
    });
    return {
        entry,
        flags,
        status: flags.some((f) => f.severity === 'error') ? 'needs_review' : 'ready',
        trace,
        usage: { calls: stats.calls - before.calls, input_tokens: stats.inputTokens - before.inputTokens, output_tokens: stats.outputTokens - before.outputTokens, ms: stats.ms - before.ms },
    };
}

/** The fields worth re-reading for a failed check (a mismatch can come from either side). */
function relatedPaths(issue, entry) {
    const m = issue.path.match(/^lines\[(\d+)\]\.line_total$/);
    if (m) return [`lines[${m[1]}].quantity`, `lines[${m[1]}].unit_price`, `lines[${m[1]}].line_total`];
    if (issue.type === 'total_mismatch') return ['total_invoice_value', ...entry.lines.map((_, i) => `lines[${i}].line_total`)];
    if (issue.type === 'weight_mismatch') return ['invoice_gross_weight_kg', 'packing.gross_weight_kg'];
    if (issue.type === 'package_mismatch') return ['invoice_packages', 'packing.packages'];
    if (issue.type === 'gross_lt_net') return ['packing.gross_weight_kg', 'packing.net_weight_kg'];
    return [issue.path];
}
