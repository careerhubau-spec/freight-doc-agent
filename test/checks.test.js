import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks, validAbn, validHs } from '../src/checks.js';

const base = () => ({
    invoice_number: 'INV-1', invoice_date: '2026-10-01', shipper: { name: 'S', country: 'CN' },
    consignee: { name: 'C', abn: '51824753556' }, incoterm: 'FOB', currency: 'USD', total_invoice_value: 250,
    port_of_loading: 'Ningbo', port_of_discharge: 'Melbourne', origin_country: 'CN', invoice_packages: 10, invoice_gross_weight_kg: 120,
    packing: { packages: 10, package_type: 'CTN', gross_weight_kg: 120, net_weight_kg: 100, volume_cbm: 1 },
    lines: [{ description: 'x', hs_code: '8516.71.00', quantity: 10, unit: 'PCS', unit_price: 25, line_total: 250, origin_country: 'CN' }],
    uncertain_fields: [],
});
const types = (e) => runChecks(e).map((i) => i.type);

test('ABN checksum', () => {
    assert.equal(validAbn('51 824 753 556'), true); // ATO's published example
    assert.equal(validAbn('51824753557'), false);
    assert.equal(validAbn('123'), false);
});
test('tariff code needs 8 digits', () => {
    assert.equal(validHs('8516.71.00'), true);
    assert.equal(validHs('8516.71'), false);
});
test('a consistent shipment raises nothing', () => assert.deepEqual(types(base()), []));
test('each planted fault is caught', () => {
    const cases = {
        line_math: (e) => (e.lines[0].line_total = 260),
        total_mismatch: (e) => (e.total_invoice_value = 300),
        weight_mismatch: (e) => (e.invoice_gross_weight_kg = 150),
        package_mismatch: (e) => (e.invoice_packages = 12),
        gross_lt_net: (e) => (e.packing.net_weight_kg = 130),
        bad_abn: (e) => (e.consignee.abn = '51824753557'),
        bad_hs: (e) => (e.lines[0].hs_code = '8516.71'),
        missing_origin: (e) => ((e.origin_country = null), (e.lines[0].origin_country = null)),
        bad_incoterm: (e) => (e.incoterm = 'FOT'),
    };
    for (const [type, mutate] of Object.entries(cases)) {
        const e = base();
        mutate(e);
        assert.ok(types(e).includes(type), `${type} not raised`);
    }
});
test('a wrong line total alone does not also raise a total mismatch when the total matches the printed lines', () => {
    const e = base();
    e.lines[0].line_total = 260;
    e.total_invoice_value = 260;
    assert.deepEqual(types(e), ['line_math']);
});
