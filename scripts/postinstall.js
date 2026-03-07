#!/usr/bin/env node

// Skip ASCII art in CI or when not in a TTY
if (process.env.CI || !process.stdout.isTTY) {
  process.exit(0);
}

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[96m';
const GREEN  = '\x1b[92m';
const YELLOW = '\x1b[93m';
const WHITE  = '\x1b[97m';

const banner = `
${CYAN}${BOLD}
  ██████╗ ██████╗ ███████╗██╗  ██╗   ██████╗ ██████╗  ██████╗
 ██╔════╝ ██╔══██╗██╔════╝╚██╗██╔╝   ██╔══██╗██╔══██╗██╔═══██╗
 ██║  ███╗██║  ██║█████╗   ╚███╔╝    ██████╔╝██████╔╝██║   ██║
 ██║   ██║██║  ██║██╔══╝   ██╔██╗    ██╔═══╝ ██╔══██╗██║   ██║
 ╚██████╔╝██████╔╝███████╗██╔╝ ██╗   ██║     ██║  ██║╚██████╔╝
  ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝     ╚═╝  ╚═╝ ╚═════╝
${RESET}${DIM}                   · p r o ·    powered by GEMACH${RESET}
`;

const divider = `${DIM}  ${'─'.repeat(60)}${RESET}`;

console.log(banner);
console.log(divider);
console.log(`  ${GREEN}✓${RESET}  ${WHITE}@gdexsdk/gdex-skill${RESET} installed successfully`);
console.log(`  ${GREEN}✓${RESET}  ${WHITE}Cross-chain DeFi trading${RESET} ${DIM}— Solana, Sui, 12 EVM chains${RESET}`);
console.log(`  ${GREEN}✓${RESET}  ${WHITE}Perpetual futures${RESET} ${DIM}— HyperLiquid, up to 50x leverage${RESET}`);
console.log(`  ${GREEN}✓${RESET}  ${WHITE}No wallet signing needed${RESET} ${DIM}— shared API keys pre-configured${RESET}`);
console.log(divider);
console.log();
console.log(`  ${YELLOW}Quick start:${RESET}`);
console.log();
console.log(`  ${DIM}import${RESET} { GdexSkill, GDEX_API_KEY_PRIMARY } ${DIM}from${RESET} ${GREEN}'@gdexsdk/gdex-skill'${RESET}${DIM};${RESET}`);
console.log(`  ${DIM}const${RESET} skill ${DIM}=${RESET} ${DIM}new${RESET} GdexSkill()${DIM};${RESET}`);
console.log(`  skill${DIM}.${RESET}loginWithApiKey(GDEX_API_KEY_PRIMARY)${DIM};${RESET}  ${DIM}// ready to trade${RESET}`);
console.log();
console.log(`  ${YELLOW}Install as an agent skill:${RESET}`);
console.log();
console.log(`  ${GREEN}npx skills add GemachDAO/gdex-skill${RESET}`);
console.log();
console.log(`  ${YELLOW}Docs:${RESET} ${DIM}https://github.com/GemachDAO/gdex-skill#readme${RESET}`);
console.log(`  ${YELLOW}API: ${RESET} ${DIM}https://trade-api.gemach.io/v1${RESET}`);
console.log();
console.log(divider);
console.log();
