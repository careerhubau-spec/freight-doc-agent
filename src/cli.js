#!/usr/bin/env node
// Usage: node src/cli.js <commercial_invoice.txt> <packing_list.txt> [--json]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { processShipment } from './agent.js';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
    console.error('Usage: node src/cli.js <commercial_invoice.txt> <packing_list.txt> [--json]');
    process.exit(1);
}
const out = await processShipment(files.map((f) => ({ name: basename(f), text: readFileSync(f, 'utf8') })));
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
} else {
    const e = out.entry;
    console.log(`\n${e.invoice_number}  ${e.shipper.name} -> ${e.consignee.name}`);
    console.log(`${e.incoterm} ${e.port_of_loading} -> ${e.port_of_discharge}   ${e.currency} ${e.total_invoice_value}   ${e.lines.length} line(s)`);
    console.log(`Status: ${out.status === 'ready' ? 'READY to lodge' : 'NEEDS REVIEW'}`);
    for (const f of out.flags) console.log(`  [${f.severity}] ${f.message}${f.evidence ? `\n           document shows: "${f.evidence}"` : ''}`);
    console.log(`(${out.usage.calls} model call(s), ${(out.usage.ms / 1000).toFixed(1)}s)`);
}
