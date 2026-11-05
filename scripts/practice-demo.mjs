#!/usr/bin/env node
/**
 * Two-host practice demo over real MCP stdio, no account, no network trading:
 *
 *   Host A: makes a standalone challenge (preview → confirm → export).
 *   Host B: a separate server process with its own empty GDEX_HOME and invites turned off
 *           (GDEX_INVITES=off), receives only the copied message text, runs the challenge
 *           and returns a debrief.
 *
 * Usage: npm run build:mcp && node scripts/practice-demo.mjs [scenarioId] [targetPct] [stopPct]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..', 'mcp-server', 'dist', 'index.js');
const [scenarioId = 'eth-short-target-vs-stop-01', targetPct = '2.5', stopPct = '1.8'] = process.argv.slice(2);

async function host(name, env) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, GDEX_HOME: mkdtempSync(join(tmpdir(), `${name}-`)), ...env } }));
  const call = async (tool, args) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const body = JSON.parse(r.content[0].text);
    if (r.isError) throw new Error(`${tool}: ${JSON.stringify(body)}`);
    return body;
  };
  return { client, call };
}

const say = (who, text) => console.log(`\n── ${who} ──\n${text}`);

const A = await host('host-a', {});
const B = await host('host-b', { GDEX_INVITES: 'off' });
const bTools = (await B.client.listTools()).tools.map((t) => t.name);
say('Host B tools', `practice: ${['gdex_run_challenge', 'gdex_replay_trade'].filter((t) => bTools.includes(t)).join(', ')}; invite tool present: ${bTools.includes('gdex_invite')}`);

say('User A', '"Make an agent challenge for my friend."');
const pv = await A.call('gdex_make_challenge', { scenarioId });
say('Agent A (preview shown to user)', `${pv.message}\n\nExcluded: ${pv.excluded}`);
say('User A', '"Looks good, export it."');
const ex = await A.call('gdex_make_challenge', { scenarioId, confirmExport: true, exportToken: pv.exportToken });
say('Agent A', `Preview and export identical: ${ex.message === pv.message}. Copy this message; it has not been sent anywhere.`);

say('User B (pastes the message)', '"Run this in practice mode."');
const start = await B.call('gdex_run_challenge', { stage: 'start', capsule: ex.message });
say('Agent B (pre-decision view)', `${start.title}\n${start.task}\nSetup bars: ${start.setupBars.length}, hidden bars: ${start.hiddenBars}, reference ${start.referencePrice}\nRules: risk limit ${start.rules.riskLimitPct}% of $${start.account.equityUsd} at ${start.account.leverage}x; baseline target ${start.baseline.targetPct}% / stop ${start.baseline.stopPct}%\nOutcome tape in response: ${JSON.stringify(start).includes('"tape"') ? 'YES (bug)' : 'no'}`);
say('Agent B', `Plan: target ${targetPct}% / stop ${stopPct}%.`);
const done = await B.call('gdex_run_challenge', { stage: 'submit', capsule: ex.message, decision: { targetPct, stopPct } });
say('Agent B (debrief)', done.text);
say('Agent B (result to send back)', done.resultMessage);

await A.client.close();
await B.client.close();
