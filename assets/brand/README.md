# Gemach Brand Assets

Official Gemach branding for GDEX apps and integrations. Use these so everything built
on the GDEX stack looks on-brand from the start.

## Logo

`gemach-lion.png` — the white Gemach lion mark (use on dark backgrounds). Pair it with the
`GEMACH` / `GDEX` wordmark set in **Inter** (700–800).

- On **dark** surfaces: white mark.
- On **light** surfaces: black mark (invert).
- Clear space: at least `x/2` on every side, where `x` is the mark height.

## Colour

| Name | Hex | Role |
|------|-----|------|
| Rich Black | `#060A17` | App background (dark, default) |
| Majorelle Blue | `#704FF6` | Primary accent · Vaults |
| Argentinian Blue | `#61B8FF` | Secondary accent · Loans |
| Emerald | `#49B875` | Long / positive · Index Funds |
| Rojo | `#DF2E2E` | Short / negative · GBOT |

Neutral ramp (navy → white):

`#161D2F #152037 #162139 #192843 #2E4164 #4D5972 #697083 #81899F #A1A5B3 #D5D9E1 #FFFFFF`

## Typography

**Inter** — weights 400 / 500 / 600 / 700 / 800. Load via Google Fonts or self-host.
Use a monospace (e.g. JetBrains Mono) for numeric/price data.

## Using it in a UI

The `gdex-ui-theming` skill ships these tokens as CSS custom properties (dark theme is the
Gemach default). The `examples/gemach-agent-demo` app is a full reference implementation.
