// Deterministic checks a customs broker or forwarder would run before lodging an entry.
// No model involved: each rule is plain code, so every flag is explainable and repeatable.

export const INCOTERMS_2020 = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
const CURRENCIES = ['AUD', 'USD', 'EUR', 'CNY', 'JPY', 'GBP', 'NZD', 'SGD', 'HKD', 'THB', 'VND', 'INR', 'KRW', 'MYR', 'IDR', 'CAD', 'CHF'];

const close = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
const round2 = (n) => Math.round(n * 100) / 100;

/** Australian Business Number checksum (ATO algorithm). */
export function validAbn(abn) {
    const d = String(abn ?? '').replace(/\s/g, '');
    if (!/^\d{11}$/.test(d)) return false;
    const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const digits = [...d].map(Number);
    digits[0] -= 1;
    return digits.reduce((s, x, i) => s + x * w[i], 0) % 89 === 0;
}

/** Australian tariff classification: 8 digits (e.g. 8471.30.00). */
export const validHs = (code) => /^\d{8}$/.test(String(code ?? '').replace(/\./g, ''));

/**
 * Returns a list of issues: { type, path, message, severity, rereadable }.
 * `rereadable` marks issues that could be a misread by the extractor rather than a fault in the document,
 * so the agent re-reads those fields once before deciding.
 */
export function runChecks(e) {
    const issues = [];
    const add = (type, path, message, { severity = 'error', rereadable = true } = {}) => issues.push({ type, path, message, severity, rereadable });

    e.lines.forEach((l, i) => {
        const expect = round2(l.quantity * l.unit_price);
        if (!close(expect, l.line_total)) add('line_math', `lines[${i}].line_total`, `Line ${i + 1}: ${l.quantity} x ${l.unit_price} = ${expect}, but the invoice shows ${l.line_total}`);
        if (!validHs(l.hs_code)) add('bad_hs', `lines[${i}].hs_code`, `Line ${i + 1}: tariff code "${l.hs_code}" is not a full 8-digit Australian classification`);
    });

    const sum = round2(e.lines.reduce((s, l) => s + l.line_total, 0));
    if (e.lines.length && !close(sum, e.total_invoice_value, 0.05)) add('total_mismatch', 'total_invoice_value', `Lines add up to ${sum}, but the invoice total is ${e.total_invoice_value}`);

    const pk = e.packing ?? {};
    if (e.invoice_gross_weight_kg != null && pk.gross_weight_kg != null && !close(e.invoice_gross_weight_kg, pk.gross_weight_kg, 0.5)) {
        add('weight_mismatch', 'packing.gross_weight_kg', `Invoice says ${e.invoice_gross_weight_kg} kg gross, packing list says ${pk.gross_weight_kg} kg`);
    }
    if (e.invoice_packages != null && pk.packages != null && e.invoice_packages !== pk.packages) {
        add('package_mismatch', 'packing.packages', `Invoice says ${e.invoice_packages} packages, packing list says ${pk.packages}`);
    }
    if (pk.gross_weight_kg != null && pk.net_weight_kg != null && pk.net_weight_kg > pk.gross_weight_kg) {
        add('gross_lt_net', 'packing.net_weight_kg', `Net weight ${pk.net_weight_kg} kg is more than gross weight ${pk.gross_weight_kg} kg`);
    }
    if (e.consignee?.abn && !validAbn(e.consignee.abn)) add('bad_abn', 'consignee.abn', `Consignee ABN ${e.consignee.abn} fails the ATO checksum`);
    if (!e.origin_country && e.lines.every((l) => !l.origin_country)) {
        add('missing_origin', 'origin_country', 'No country of origin stated - required for the entry and any FTA preference claim', { rereadable: false });
    }
    if (!INCOTERMS_2020.includes(String(e.incoterm).toUpperCase())) add('bad_incoterm', 'incoterm', `"${e.incoterm}" is not an Incoterms 2020 rule`, { severity: 'warning' });
    if (!CURRENCIES.includes(String(e.currency).toUpperCase())) add('bad_currency', 'currency', `Unrecognised currency "${e.currency}"`, { severity: 'warning' });
    return issues;
}
