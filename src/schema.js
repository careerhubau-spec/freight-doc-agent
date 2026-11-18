// The shipment entry the agent produces. Values are recorded exactly as the documents print them
// (normalised to plain numbers, ISO dates and ISO country codes) - the agent never "fixes" a document.
import { z } from 'zod';

const nullableNumber = z.number().nullable();

export const LineSchema = z.object({
    description: z.string(),
    hs_code: z.string().describe('Tariff code exactly as printed, digits and dots only'),
    quantity: z.number(),
    unit: z.string(),
    unit_price: z.number(),
    line_total: z.number().describe('Line total as printed, even if it does not equal quantity x unit price'),
    origin_country: z.string().nullable().describe('ISO 3166-1 alpha-2, or null if the document does not state it'),
});

export const EntrySchema = z.object({
    invoice_number: z.string(),
    invoice_date: z.string().describe('YYYY-MM-DD'),
    shipper: z.object({ name: z.string(), country: z.string().describe('ISO 3166-1 alpha-2') }),
    consignee: z.object({ name: z.string(), abn: z.string().nullable().describe('11 digits, no spaces, as printed') }),
    incoterm: z.string().describe('Three-letter Incoterm as printed, e.g. FOB'),
    currency: z.string().describe('ISO 4217 code'),
    total_invoice_value: z.number().describe('Invoice total as printed'),
    port_of_loading: z.string().nullable(),
    port_of_discharge: z.string().nullable(),
    origin_country: z.string().nullable().describe('Country of origin stated for the goods (ISO alpha-2), or null if not stated'),
    invoice_packages: z.number().int().nullable().describe('Package count stated on the commercial invoice'),
    invoice_gross_weight_kg: nullableNumber.describe('Gross weight stated on the commercial invoice, in kg'),
    packing: z.object({
        packages: z.number().int().nullable(),
        package_type: z.string().nullable(),
        gross_weight_kg: nullableNumber,
        net_weight_kg: nullableNumber,
        volume_cbm: nullableNumber,
    }).describe('Totals stated on the packing list'),
    lines: z.array(LineSchema),
    uncertain_fields: z.array(z.string()).describe('Paths of any values that were hard to read or ambiguous'),
});

// The re-read step returns targeted corrections only.
export const PatchSchema = z.object({
    corrections: z.array(z.object({
        path: z.string().describe('Field path, e.g. lines[2].line_total or packing.gross_weight_kg'),
        value: z.union([z.string(), z.number(), z.null()]),
        printed_text: z.string().describe('The exact text on the document that this value comes from'),
    })),
    confirmed: z.array(z.object({
        path: z.string(),
        printed_text: z.string().describe('The exact text on the document confirming the current value'),
    })),
});
