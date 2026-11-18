// One function, two engines:
//  - Claude API (@anthropic-ai/sdk) when ANTHROPIC_API_KEY is set: structured outputs guarantee schema-valid JSON.
//  - Claude Code headless (`claude -p`) otherwise, so the project runs on a Claude subscription with no API key.
//    Its JSON is validated with the same zod schema and retried once if it does not parse.
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const ENGINE = process.env.ANTHROPIC_API_KEY ? 'api' : 'claude-cli';
const API_MODEL = process.env.FDA_MODEL || 'claude-opus-5-5';
const CLI_MODEL = process.env.FDA_CLI_MODEL || 'sonnet';

export const stats = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 };

let client;
async function viaApi(system, prompt, schema) {
    client ??= new Anthropic();
    const res = await client.messages.parse({
        model: API_MODEL,
        max_tokens: 16000,
        system,
        output_config: { effort: 'medium', format: zodOutputFormat(schema) },
        messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new Error(`model declined: ${res.stop_details?.explanation ?? 'no detail'}`);
    if (res.stop_reason === 'max_tokens') throw new Error('response cut off at max_tokens');
    stats.inputTokens += res.usage.input_tokens;
    stats.outputTokens += res.usage.output_tokens;
    if (!res.parsed_output) throw new Error('response did not match the schema');
    return res.parsed_output;
}

function runCli(text, timeoutMs = 240_000) {
    return new Promise((resolve, reject) => {
        const child = spawn('claude', ['-p', '--output-format', 'json', '--model', CLI_MODEL, '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Read,Glob,Grep,Task'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => (child.kill('SIGTERM'), reject(new Error('claude -p timed out'))), timeoutMs);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`claude -p exit ${code}: ${(err || out).slice(0, 300)}`));
            try {
                const res = JSON.parse(out);
                if (res.is_error) return reject(new Error(`claude -p: ${String(res.result).slice(0, 300)}`));
                stats.inputTokens += (res.usage?.input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0);
                stats.outputTokens += res.usage?.output_tokens ?? 0;
                resolve(String(res.result));
            } catch (e) {
                reject(new Error(`claude -p returned non-JSON: ${e.message}`));
            }
        });
        child.stdin.end(text);
    });
}

function parseJson(text) {
    // Tolerates a code fence or a stray sentence around the object.
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

async function viaCli(system, prompt, schema) {
    const shape = JSON.stringify(z.toJSONSchema(schema));
    const text = `${system}\n\n${prompt}\n\nReply with ONLY a JSON object matching this JSON Schema, no prose:\n${shape}`;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            return schema.parse(parseJson(await runCli(attempt ? `${text}\n\nYour previous reply was not valid JSON for the schema (${lastErr.message.slice(0, 200)}). Try again.` : text)));
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr;
}

/** Ask Claude for JSON matching a zod schema. */
export async function askJson(system, prompt, schema) {
    const t0 = Date.now();
    stats.calls++;
    try {
        return await (ENGINE === 'api' ? viaApi : viaCli)(system, prompt, schema);
    } finally {
        stats.ms += Date.now() - t0;
    }
}
