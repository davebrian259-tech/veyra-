# Veyra Heist: art direction

## Mood

**After hours in the vault room.** Dark steel, one lit door, money that glints. The player is
a safecracker working against a machine that is calm, exact and fair. The interface stays quiet
so the vaults and the money can be loud.

Not the generic web3 look: no purple-to-pink gradients, no glassmorphism stacks, no neon grid.
Light comes from the vault you are facing, not from the page.

## Palette

| Role | Token | Value | Rule |
|---|---|---|---|
| Ground | `--bg`, `--bg-2`, `--bg-3` | `#0b0b10`, `#14141b`, `#1c1c25` | Three steps of steel. Panels sit one step above the page. |
| Ink | `--fg` … `--fg-4` | `#f4f4f6` → `#5d5d6b` | `--fg-3` is the lowest tone allowed for text (AA on `--bg-2`). `--fg-4` is for borders and disabled glyphs only. |
| Lines | `--line`, `--line-2` | `#24242e`, `#31313d` | Hairlines, never shadows, separate things at rest. |
| You | `--accent` | `#8ea2ff` | The player's own moves, selections and focus rings. |
| Money | `--gold` | `#f5c451` | Pots, loot, fees, the ranked button. Nothing else is gold. |
| Vault tones | `TONES` in `game/art.tsx` | mint, sky, violet, amber, crimson | One per vault, used for its door, its glow and its shields. The difficulty ladder reads as colour temperature: cool and easy to hot and hard. |
| Status | `--good`, `--warn`, `--bad` | green, amber, rose | Transaction states and errors only. Always paired with a word or an icon. |

## Type

- **Geist** for everything you read. Tight tracking on headings (−0.03em to −0.045em).
- **Geist Mono** for everything you count: pots, fees, hashes, ranks, shortcuts.
- Scale (minor third, 15px base): `--fs-xs` 12 · `--fs-sm` 13.6 · `--fs-md` 15.2 · `--fs-lg` 17.6 · `--fs-xl` 21.6 · `--fs-2xl` 28 · display `clamp(2rem, 4vw, 3rem)`.
- Sentence case everywhere. Buttons say what happens: "Run the heist", "Back vault 3".

## Shape and depth

- Panels: 28px radius on desktop, 22px on phones. Cards inside panels: 16–24px. Pills: full.
- Depth comes from a soft coloured glow behind the active vault (`--glow`), not from drop shadows.
- Elevation tokens exist only for things that float: sheets, the palette, toasts (`--elev-1…3`).

## Motion

- **Mechanical, short, and earned.** UI responds in 120ms (`--t-fast`), panels move in 200ms
  (`--t-med`), the Heist Cam ticks at 520ms per beat (`--t-beat`).
- Springs only for rewards: the verdict card, the loot counter, confetti on a crack.
- Sheets slide from the edge they belong to (right on desktop, bottom on phones).
- Everything respects `prefers-reduced-motion`: motion's `MotionConfig reducedMotion="user"`,
  no confetti, and the Heist Cam shows every beat at once.

## Sound

Off by default. Four short synthesized cues (tick, hold, crack, unlock) under 0.4s each,
played through howler.js once the player turns sound on. The toggle persists.

## Icons

Hugeicons stroke set at 1.5px, one style everywhere. The brief suggested lucide-react; the
project already uses one consistent stroke family across about 60 screens and icons, so
switching would add a second dependency and change nothing a player sees.

## Components

The arena reuses the console's primitives (`ui.tsx`) under a scoped dark theme (`.arena` in
`game/game.css`), so a button, a field or a dialog behaves the same everywhere. Radix provides
the accessible primitives (Dialog, Popover, Tooltip); cmdk the palette; sonner the toasts;
driver.js the tour; Recharts the charts, styled with these tokens.

Every interactive element has hover, `:focus-visible` (2px accent ring), `:active` (1px press),
`:disabled` (50% and `not-allowed`) and a loading state (`aria-busy` with a spinner).
