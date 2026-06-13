# APMCB Design System

> Adapted from Apple's premium minimalist philosophy + APMCB institutional brand.
> Five UX Laws applied: Fitts, Hick, Miller, Jakob, Gestalt.

---

## 1. Visual Theme & Atmosphere

**Mood:** Institutional precision meets premium restraint. The UI disappears — only the data and the mission matter.

**Philosophy:** Photography-first for military profiles. UI chrome recedes. Every pixel earns its place.

**Density:** Generous white space at marketing/auth surfaces. Compact-but-breathable at data-dense dashboard views.

**Design laws applied:**
- **Fitts's Law** — all tap targets ≥ 44px, primary actions always rightmost/largest
- **Hick's Law** — max 5 nav items per role, progressive disclosure everywhere
- **Miller's Law** — dashboard cards ≤ 7 data points, tables paginated at 10-20
- **Jakob's Law** — familiar sidebar + top header pattern, standard form conventions
- **Gestalt** — proximity groups related data, similarity unifies same-role actions

---

## 2. Color Palette

### Brand
| Token | Hex | Role |
|---|---|---|
| `--brand-blue` | `#1B3A8C` | Primary interactive: buttons, links, active nav, rings |
| `--brand-red` | `#C8102E` | Destructive, alerts, PMBA accent, badge danger |
| `--brand-white` | `#FFFFFF` | Primary surface |

### Surfaces (Light)
| Token | Hex | Role |
|---|---|---|
| `--background` | `#F5F5F7` | Page canvas (Apple parchment) |
| `--surface` | `#FFFFFF` | Cards, panels, modals |
| `--surface-raised` | `#FFFFFF` | Elevated cards (via shadow only) |
| `--surface-subtle` | `#F0F2F5` | Input bg, muted sections |

### Surfaces (Dark)
| Token | Hex | Role |
|---|---|---|
| `--background` | `#0A0A0F` | Page canvas |
| `--surface` | `#111118` | Cards, panels |
| `--surface-raised` | `#18181F` | Elevated cards |
| `--surface-subtle` | `#1C1C26` | Muted sections |

### Text
| Token | Light | Dark | Role |
|---|---|---|---|
| `--foreground` | `#1A1A2E` | `#F0F0F5` | Primary text |
| `--muted-foreground` | `#6B7280` | `#8B8FA8` | Secondary/meta text |
| `--placeholder` | `#9CA3AF` | `#6B7280` | Input placeholders |

### Semantic
| Token | Hex | Role |
|---|---|---|
| `--success` | `#0A7B3E` | Confirmations, "armado", "completo" |
| `--warning` | `#B45309` | Pendente, estoque baixo |
| `--info` | `#1B3A8C` | Same as brand-blue |
| `--danger` | `#C8102E` | Same as brand-red |

---

## 3. Typography

**Primary font:** Inter (variable, Google Fonts) — geometric, institutional, readable at all sizes.

**Rule:** Weights 300 / 400 / 600 / 700 only. Never 500 — it muddies the tonal ladder.

| Role | Size | Weight | Tracking | Line-height |
|---|---|---|---|---|
| Display hero | 48–64px | 700 | −2px | 1.1 |
| Page title | 28–32px | 700 | −1px | 1.2 |
| Section heading | 20–24px | 600 | −0.5px | 1.3 |
| Card title | 16–18px | 600 | −0.2px | 1.4 |
| Body / label | 14–16px | 400 | 0 | 1.5 |
| Caption / meta | 12px | 400 | +0.2px | 1.5 |
| Badge / pill | 11–12px | 600 | +0.5px | 1 |

---

## 4. Component Styling

### Buttons
```
Primary:   bg=brand-blue  text=white   radius=9999px  px=20 py=10  weight=600  scale(0.97) on press
Secondary: bg=transparent border=1px   text=brand-blue radius=9999px  px=20 py=10
Danger:    bg=brand-red   text=white   radius=9999px  px=20 py=10
Ghost:     bg=transparent text=foreground  hover=surface-subtle  radius=8px
Icon-only: 36×36px  radius=8px  ghost bg
```
**Fitts law:** primary CTA always ≥ 44px tall, never grouped more than 2 primary buttons.

### Cards
```
bg: surface (white)
border: none
border-radius: 16px
shadow: 0 2px 16px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)
padding: 24px
hover: shadow lifts → 0 8px 32px rgba(0,0,0,0.12)
transition: shadow 200ms ease, transform 150ms ease
hover transform: translateY(-1px)
```
**One shadow rule (Apple):** cards get the only drop-shadow in the system. Everything else uses border or background differentiation.

### Inputs
```
bg: surface-subtle (#F0F2F5 light / #1C1C26 dark)
border: 1px solid border-color (transparent default, visible on focus)
border-radius: 10px
padding: 10px 14px
font-size: 15px weight 400
focus-ring: 2px brand-blue, offset 2px
placeholder: muted-foreground
height: 44px (Fitts minimum touch target)
```

### Tables
```
header: bg=surface-subtle, text=muted-foreground weight=600 size=12px uppercase tracking=0.5px
rows: alternating bg (white / #FAFAFA light, #111118 / #13131A dark)
row-hover: bg=brand-blue/5
border: 1px solid border-color (horizontal only — no vertical lines)
cell padding: 12px 16px
```

### Badges / Status pills
```
radius: 9999px
padding: 2px 10px
font: 11px weight=600 tracking=0.5px
colors:
  ativo/complete:   bg=#DCFCE7 text=#166534 (light) | bg=#14532D text=#4ADE80 (dark)
  pending:          bg=#FEF3C7 text=#92400E (light) | bg=#451A03 text=#FCD34D (dark)
  devolvido:        bg=#F3F4F6 text=#6B7280
  danger/armado:    bg=#FEE2E2 text=#991B1B (light) | bg=#450A0A text=#FCA5A5 (dark)
```

### Navigation sidebar
```
width open: 224px | collapsed: 64px
bg: surface (white/dark)
border-right: 1px solid border-color
active item: bg=brand-blue/8 text=brand-blue radius=10px weight=600
inactive item: text=muted-foreground hover=surface-subtle radius=10px
icon size: 18px
transition: width 250ms cubic-bezier(0.4,0,0.2,1)
```

---

## 5. Layout Principles

**Base unit:** 4px.

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Tight gaps within components |
| `sm` | 8px | Component internal padding |
| `md` | 16px | Card internal padding (mobile) |
| `lg` | 24px | Card internal padding (desktop) |
| `xl` | 32px | Section gaps |
| `2xl` | 48px | Page section padding |
| `3xl` | 80px | Marketing/auth vertical padding |

**Page shell:**
- Sidebar 224px (desktop) + main content flex-1
- Top header 56px fixed
- Content area: max-width 1280px, padding 24px–48px
- Bottom nav 64px (mobile only, fixed)

**Grid:** 12-column. Cards use 3-up (lg) → 2-up (md) → 1-up (sm).

---

## 6. Depth & Elevation

**The one-shadow rule (Apple-derived):** Only cards receive `box-shadow`. Everything else uses background or border.

```
Level 0 (flat):   no shadow — inputs, badges, nav items
Level 1 (card):   0 2px 16px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)
Level 2 (hover):  0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)
Level 3 (modal):  0 24px 64px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.08)
```

Dark mode: replace rgba(0,0,0,...) with rgba(0,0,0,...) × 2 (shadows more prominent on dark).

---

## 7. Motion

```
Micro (button press, hover):  150ms ease
Standard (panel, card):       200ms ease
Layout (sidebar collapse):    250ms cubic-bezier(0.4,0,0.2,1)
Page transition:              300ms ease
```

Button press: `transform: scale(0.97)` — the single system-wide micro-interaction.

---

## 8. Do's and Don'ts

### Do
- Use brand-blue for ONE primary action per screen section
- Use brand-red exclusively for destructive/danger/alert states
- Allow generous white space — empty space is not wasted space
- Use card shadow as the only depth signal
- Keep navigation ≤ 5 items per role (Hick's Law)
- Show status via badge only — no full-sentence alerts for common states
- Use Inter at −0.5px to −2px tracking for all headings

### Don't
- Never use more than 2 primary buttons in the same viewport section
- Never use decorative gradients (not institutional)
- Never use shadow on inputs, nav items, or badges
- Never mix red and blue in the same button row
- Never use weight 500 (blur the type hierarchy)
- Never show more than 7 data points on a dashboard card (Miller's Law)
- Never use pure black (#000) — use `#1A1A2E` instead

---

## 9. Responsive Behavior

| Breakpoint | Width | Layout change |
|---|---|---|
| Mobile | < 768px | Sidebar hidden, bottom-nav visible, 1-col grid |
| Tablet | 768–1024px | Sidebar collapsed (64px), 2-col grid |
| Desktop | > 1024px | Sidebar open (224px), 3-col grid |

Touch targets: minimum 44×44px everywhere (Fitts's Law).

---

## 10. Agent Prompt Guide

**Primary color:** `#1B3A8C` (brand-blue)
**Danger color:** `#C8102E` (brand-red)
**Canvas:** `#F5F5F7` (light) / `#0A0A0F` (dark)
**Card:** white with `box-shadow: 0 2px 16px rgba(0,0,0,0.07)`
**Radius:** 16px cards, 10px inputs, 9999px pills
**Font:** Inter 300/400/600/700, tight tracking on headings
**Motion:** scale(0.97) on press, 200ms ease transitions

**Ready prompts:**
- "Build a dashboard card showing [metric] using the APMCB design system — card with 16px radius, brand-blue accent, Inter 600 heading, muted meta text"
- "Create a data table for [entity] — horizontal borders only, alternating rows, brand-blue row hover, 12px uppercase headers"
- "Build a status badge for [state] using the pill spec from DESIGN.md"
