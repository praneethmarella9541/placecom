# Handoff: Nucleus Workspace Redesign (Nav Regrouping + Visual Refresh)

## Overview
Redesign of the placecom (The Nucleus) workspace shell: sidebar navigation regrouped from a flat 9-item list into 3 labeled sections, a new content-area topbar (breadcrumb + search, separated from primary nav), sample module layouts (Mail, CRM, Calendar) restyled to match, and a new logo mark applied throughout.

## About the Design Files
The bundled file (`Nucleus Redesign.dc.html`) is a **design reference built in HTML** — a working prototype showing intended layout, spacing, color, and interaction, not production code to copy/paste. The task is to **recreate this design inside the existing placecom Next.js/React codebase**, using its existing component structure, styling approach, and design-token setup (CSS variables in `app/globals.css`) — not to introduce a new stack or inline-style everything as the prototype does.

## Fidelity
**High-fidelity.** Colors, spacing, typography, and layout below are final — implement pixel-close using the codebase's existing patterns (Tailwind classes / CSS vars / component library — whatever `WorkspaceSidebar.tsx`, `WorkspaceChrome.tsx`, and `AppHeader.tsx` currently use).

## Target files in the existing codebase
- `components/WorkspaceSidebar.tsx` — becomes the grouped sidebar nav
- `components/WorkspaceChrome.tsx` — owns the shell layout (sidebar + main), should also own the new content topbar
- `components/AppHeader.tsx` — retire its duplicate mobile nav drawer if unused after this change, or repurpose purely as content-area chrome (see below)
- `components/PlacecomLogo.tsx` — swap the mark to the new logo (SVG provided in `assets/logo-mark.svg`)
- `app/globals.css` — add/confirm design tokens listed below

## Screens / Views

### 1. Sidebar (240px fixed width, full height, sticky)
- Background: `#FDFCFA`, right border `1px solid rgba(20,18,14,0.09)`
- Subtle top-left radial warm glow: `radial-gradient(ellipse 120% 80% at 0% 0%, rgba(196,92,26,0.05), transparent 55%)` layered under content
- **Header row** (56px tall, border-bottom `1px solid rgba(20,18,14,0.09)`): logo mark (26x26, see Assets) + wordmark "The Nucleus" — Sora 700, 15px, letter-spacing -0.01em, color `#1A1612`
- **Nav groups**, 18px gap between groups, 14px/10px padding around the nav list:
  - **Comms**: Mail, WhatsApp, SMS, Broadcasting
  - **Pipeline**: CRM, Extraction
  - **Ops**: Drive, Calendar, Meetings, Forms
  - Group label: JetBrains Mono 600, 10px, letter-spacing 0.14em, uppercase, color `#A39A8C`, margin-bottom 6px
  - Nav item: 8px/12px padding, 10px border-radius, 11px gap between icon and label, font 13.5px/500, color `#4A443C`, icon 18x18 (stroke-based line icons, 1.75 stroke width)
  - **Active state**: 3px copper (`#c45c1a`) rounded bar on the left edge, vertically centered, 58% of row height
- **Footer** (border-top `1px solid rgba(20,18,14,0.09)`, 10px padding): 32px circular avatar (copper gradient `linear-gradient(135deg,#e8a04c,#c45c1a)`, white initial, 13px/600) + name (13px/600, `#1A1612`) + email (11px, `#8C857B`), both truncating with ellipsis

### 2. Content topbar (56px, NOT part of primary nav — lives above the module content)
- Background `rgba(245,243,239,0.85)` with `backdrop-filter: blur(8px)`, border-bottom `1px solid rgba(20,18,14,0.09)`
- Left: breadcrumb — group label (Sora 700, 16px) ` / ` (color `#C4BCAE`) active item label (14px/500, `#4A443C`)
- Right: search field (36px tall, 260px wide, background `#EDE9E1`, 10px radius, search icon + placeholder "Search {module}…" at 13px/`#8C857B`) + primary button "+ New" (36px tall, copper `#c45c1a` background, white text, 13px/600, 10px radius, no border)

### 3. Module content area (padding 22px/24px, scrollable)
- **Mail**: 320px fixed thread list (12px cards, white bg, 1px border `rgba(20,18,14,0.08)`, 12px radius, 34px circular avatar-initial, sender 13px/600, timestamp 11px `#A39A8C`, subject preview 12.5px `#6B6459` truncated) + flexible reader pane (white, 16px radius, 32px padding, eyebrow label in JetBrains Mono 10px uppercase copper, subject as Sora 700 22px heading, meta line 13px `#8C857B`, body 14.5px/1.7 `#4A443C`)
- **CRM**: 3-column kanban grid (16px gap), each column: white card container (16px radius, 1px border), stage name (13px/700) + count pill (`#EDE9E1` bg, 11px/600 `#8C857B`, pill radius), candidate cards nested inside (12px radius, cream `#FDFCFA` bg, name 13px/600 + company 11.5px `#8C857B`)
- **Calendar**: single white card (16px radius) listing events — each row: 3px copper accent bar (34px tall) + time (JetBrains Mono 12px/700) + title (13.5px/600) + attendee line (12px `#8C857B`)

## Interactions & Behavior
- Clicking a nav item sets it active (copper left-bar indicator) and swaps the breadcrumb + module content below
- Clicking a mail thread selects it and updates the reader pane
- No page reload between modules — client-side state swap (SPA behavior), matching how the existing WorkspaceChrome likely already routes between modules

## Design Tokens

### Colors
- Background (app): `#F5F3EF`
- Surface / sidebar: `#FDFCFA`
- Surface / cards: `#FFFFFF` (content area cards), `#FDFCFA` (nested cards)
- Border: `rgba(20,18,14,0.08)` (cards), `rgba(20,18,14,0.09)` (chrome dividers)
- Ink / primary text: `#1A1612`
- Secondary text: `#4A443C`
- Tertiary / muted text: `#8C857B`
- Faint / placeholder text: `#A39A8C`, `#C4BCAE`
- Accent (copper — primary brand accent): `#C45C1A`
- Accent gradient (avatar): `linear-gradient(135deg, #e8a04c, #c45c1a)`
- Chip / pill background: `#EDE9E1`

### Typography
- Display / headings: **Sora** — 700/800 weight, tight letter-spacing (-0.01em to -0.02em)
- Body / UI: **Plus Jakarta Sans** — 400/500/600
- Mono / labels / timestamps: **JetBrains Mono** — 500/600, wide letter-spacing (0.08–0.14em) for uppercase eyebrow labels

### Spacing & Radius
- Sidebar width: 240px · Topbar/header height: 56px
- Card radius: 16px (containers), 12px (nested cards/items), 10px (buttons, nav rows, search field)
- Nav row padding: 8px 12px · Card padding: 12–32px depending on container

## Assets
- `assets/logo-mark.svg` — new orbital mark (three intersecting rings, copper `#C45C1A` stroke, solid copper core), replaces the previous gradient/dashed orbital logo in `PlacecomLogo.tsx`
- Icons are inline stroke-based SVGs (Lucide-style, 1.75 stroke width, 18x18) — if the codebase already uses `lucide-react`, swap these for the equivalent Lucide icons (Mail, MessageCircle, MessageSquare, Radio, User, ScanLine, Folder, Calendar, FileText) instead of inlining new SVGs

## Files in this bundle
- `Nucleus Redesign.dc.html` — full interactive prototype (open in a browser to click through Mail / CRM / Calendar)
- `assets/logo-mark.svg` — new logo mark, vector source
