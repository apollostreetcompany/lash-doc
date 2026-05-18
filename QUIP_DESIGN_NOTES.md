# Quip Design Language — Implementation Reference

_LLM-optimized reference for replicating Salesforce Quip's visual + interaction design in Lash. All values are CSS-ready._

---

## 1. Layout & Information Architecture

Quip uses a three-column shell with no traditional menubar/footer. The dark left sidebar stays distinct from the bright white document canvas; the right rail (chat/comments) is collapsible.

```
+------------------------------------------------------------------------+
|  TOP CHROME  (no global app bar — title sits inside document)          |
+----+-----------------------------------------+-------------------------+
| L  | DOC CANVAS (white "paper")              | R RAIL (chat/comments)  |
| E  |                                         |  - Conversation tab     |
| F  |  +-----------------------------------+  |  - Tasks tab            |
| T  |  |  Doc Title (H1, large)            |  |  - Activity tab         |
|    |  |  authors row · last edited        |  |                         |
| S  |  +-----------------------------------+  |  +-----------------+    |
| I  |  | Body content (max-width ~720px)   |  |  | message bubble  |    |
| D  |  |  paragraphs, tables, checklists   |  |  | sender · time   |    |
| E  |  |  inline @mentions, comments       |  |  +-----------------+    |
| B  |  |                                   |  |  ...                    |
| A  |  |                                   |  |  +-----------------+    |
| R  |  |                                   |  |  | type a message  |    |
|    |  +-----------------------------------+  |  +-----------------+    |
| 56 |              CONTENT 640-760            |        280-340           |
+----+-----------------------------------------+-------------------------+
```

**Key behaviors:**
- Left sidebar is dark, collapses to icon-only (56px wide) or expands (240-260px). Toggled via top-left icon. Hides by default when opening a doc (focus mode).
- Right rail is the document chat thread (every doc has one). 280-340px. Toggleable.
- **Floating outline** anchors to the far right of the doc canvas when window is wide enough (~>1280px). It floats outside the content column, not inside.
- **Formatting toolbar floats vertically on the right side of the cursor** (the famous "blue tab") rather than a thick top ribbon. On mobile it sits above the keyboard.
- No persistent footer. No status bar.
- Top-of-doc chrome contains: sidebar toggle (left), doc title breadcrumb (center, optional), Share + invitee avatars + bell (right).

---

## 2. Color Palette

Quip's signature is a warm coral red (officially `#C64A32` from brand guides, with `#F27557` as the lighter accent). Used sparingly — accents, notification glow, primary CTA, brand logo. The product is otherwise restrained white + dark slate.

| Token | Hex | Usage |
|---|---|---|
| `--quip-coral-600` | `#C64A32` | Primary brand red, logo, primary CTA, notification glow |
| `--quip-coral-500` | `#F27557` | Light coral, hover state on coral CTA, badges |
| `--quip-coral-50` | `#FDECE6` | Coral tint background (selected row, notification badge bg) |
| `--quip-paper` | `#FFFFFF` | Document canvas |
| `--quip-app-bg` | `#F4F5F7` | App shell background (behind paper) |
| `--quip-sidebar-bg` | `#2E3338` | Dark left sidebar |
| `--quip-sidebar-hover` | `#3B4147` | Sidebar row hover |
| `--quip-sidebar-active` | `#4A5158` | Sidebar row active/selected |
| `--quip-rail-bg` | `#F7F8FA` | Right rail (chat) background |
| `--quip-text-primary` | `#3D3D3D` | Body text (Quip's literal "black") |
| `--quip-text-secondary` | `#6B7280` | Metadata, byline, captions |
| `--quip-text-muted` | `#9CA3AF` | Placeholder, disabled |
| `--quip-text-on-dark` | `#E5E7EB` | Sidebar text |
| `--quip-text-on-dark-muted` | `#9AA1A8` | Sidebar secondary text |
| `--quip-border` | `#E5E7EB` | Dividers, table cell borders |
| `--quip-border-strong` | `#D1D5DB` | Toolbar dividers, modal borders |
| `--quip-hover-bg` | `#F1F3F5` | Generic row/button hover |
| `--quip-selection` | `#FDECE6` | Text selection (coral tint) |
| `--quip-focus-ring` | `#F27557` | Focus outline (2px) |
| `--quip-success` | `#2E844A` | Done status pill, online presence |
| `--quip-warning` | `#FFB75D` | In-progress pill, warning toasts |
| `--quip-danger` | `#BA0517` | Errors, destructive actions |
| `--quip-info` | `#0070D2` | Links, info badges (Salesforce blue) |
| `--quip-presence-cyan` | `#06B6D4` | Default user presence cursor color |

---

## 3. Typography

Quip's default theme is **Atlas**: headings in **Atlas Grotesk** (sans), body in **Lyon Text** (serif). The serif body is a distinctive choice that makes docs feel like prose. Other themes: Modern (Neue Haas Grotesk), Byline (Publico serif), Marseilles (Duplicate Sans), Manuscript (Courier Prime, centered headings).

**Web fallback stack (Atlas Grotesk and Lyon Text are commercial; use these open replacements):**

| Role | Quip Original | Web Fallback |
|---|---|---|
| Heading sans | Atlas Grotesk | `"Inter", "Helvetica Neue", -apple-system, sans-serif` |
| Body serif (Atlas theme) | Lyon Text | `"Source Serif Pro", "Charter", Georgia, serif` |
| UI / chrome | Atlas Grotesk | `"Inter", -apple-system, "Segoe UI", sans-serif` |
| Mono / code | Source Code Pro | `"JetBrains Mono", "SF Mono", Menlo, monospace` |

**Type scale** (assumes 16px root):

| Token | Size | Line height | Weight | Letter-spacing | Use |
|---|---|---|---|---|---|
| `--text-h1` | 2.25rem (36px) | 1.2 | 700 | -0.02em | Doc title |
| `--text-h2` | 1.625rem (26px) | 1.25 | 700 | -0.015em | Large heading |
| `--text-h3` | 1.25rem (20px) | 1.3 | 600 | -0.01em | Medium heading |
| `--text-h4` | 1.0625rem (17px) | 1.35 | 600 | 0 | Small heading |
| `--text-body` | 1rem (16px) | 1.65 | 400 | 0 | Body paragraph (serif in Atlas) |
| `--text-ui` | 0.875rem (14px) | 1.45 | 500 | 0 | Buttons, toolbar, sidebar |
| `--text-meta` | 0.8125rem (13px) | 1.4 | 400 | 0.01em | Bylines, timestamps |
| `--text-caption` | 0.75rem (12px) | 1.35 | 500 | 0.02em | Labels, pill text |

- Body line-length cap ~70 characters at 16px → content column **max-width 720px** (acceptable range 640-760px).
- Body uses serif in default Atlas theme; headings are sans. UI chrome is always sans regardless of theme.

---

## 4. Toolbar Design

Quip eschews the thick top ribbon. The default formatting affordance is a **floating vertical "blue tab"** that follows the cursor on the right side of the doc canvas. Salesforce-era Quip also added a thin top menu bar for Insert/Format/Tools on desktop.

```
DOCUMENT CANVAS                                   ┌─┐
┌──────────────────────────────────────────────┐  │+│  ← floating add tab
│  Heading                                     │  └─┘    (hover expands)
│  Body paragraph with cursor here  |          │   ▲
│                                              │   │  options panel slides
│                                              │  ┌───────────┐
│                                              │  │  H1 H2 H3 │
│                                              │  │  • 1. ☐   │
│                                              │  │  ─── Insert───│
│                                              │  │  📎 🖼 📊 │
│                                              │  └───────────┘
└──────────────────────────────────────────────┘
```

**Specs:**
- Floating tab: 32×32px, coral or muted blue background `#F27557` (or `#0070D2` in older builds), white "+" glyph, soft shadow `0 2px 8px rgba(0,0,0,0.12)`.
- Hover expands to a horizontal panel with **3 grouped sections**: text styles (H1/H2/H3/body), lists (bullet/number/check), insert (image, table, file, mention, code, divider).
- Top menu bar (when present): 40px tall, white background, 1px bottom border `#E5E7EB`, sans 14px, items: File · Edit · Insert · Format · Tools · Help. Buttons have 8px horizontal padding, hover bg `#F1F3F5`.
- Active button state: coral underline 2px from bottom, text `#3D3D3D`.
- Inline selection bubble: appears above selected text — 36px tall, dark `#2E3338` bg, white icons, rounded 6px. Contains: B, I, U, link, comment, color, more.

---

## 5. Comment Threading

Quip uses a **right-rail conversation per doc + inline anchored comments** that point into the rail. The rail itself toggles via the conversation icon. Unread is shown via a **coral notification glow** on the bell/sidebar button with numeric badge.

- Inline comment: highlights anchor text with `#FFF6E0` (warm cream) underline + 2px coral tick in left gutter.
- Clicking anchor scrolls the right rail to that thread.
- Thread bubble: 12px padding, 12px rounded corners, sender avatar 24px round, sender name 13px/600, timestamp 12px `#6B7280`, message body 14px/1.5.
- New activity badge: 16px circle, coral `#C64A32`, white 11px bold count.
- Resolved comments collapse with strike-through preview.
- @mentions render as inline pills: coral `#FDECE6` bg, `#C64A32` text, 2px radius, 13px medium.

---

## 6. Sharing UI

Share button lives **top-right of the document chrome**, next to invitee avatars and the bell. It opens a **centered modal** (not a popover) for the granular permissions UI.

**Specs:**
- Share button: 32px tall, coral `#C64A32` fill, white 14px/600 text, 6px radius, 12px horizontal padding. Hover lightens to `#F27557`.
- Avatar stack: 24px circles, 2px white border, overlap -8px, max 3 visible + "+N".
- Modal: 520px wide, white, 12px radius, drop shadow `0 12px 32px rgba(0,0,0,0.18)`, 24px padding.
- Permission rows: avatar + name + email left, permission dropdown right (Full Access · Can Edit · Can Comment · Can View).
- Link sharing section at bottom: toggle "Anyone with link can view/edit", copy link button.
- "Allow access from outside organization" is an explicit toggle.

---

## 7. Outline / Navigation

The outline is **auto-generated from headings** (H1/H2/H3) plus top-level checklist items. It anchors to the **far-right of the document canvas** (floating outside content), visible only when window width allows (~>1280px). Toggle via `Cmd-Shift-O` or Tools menu.

**Specs:**
- Width 200-220px. Sticky position. Sits in the gutter between content column and right rail.
- No card chrome — just a list of links, no border.
- Item: 13px/500, color `#6B7280`, 4px vertical padding, indent per level (0 / 12px / 24px).
- Active section: coral `#C64A32` text, 2px coral left border, font-weight 600.
- Hover: `#3D3D3D` text.
- Checklist items show a 12px checkbox glyph prefix.

---

## 8. Tables (Live Apps / Project Tracker)

Quip's hallmark was the **Project Tracker** table with status pills and dropdown chips per cell. Cell type is set via a column header dropdown, not per-cell.

**Specs:**
- Column header: 12px caps, letter-spacing 0.04em, `#6B7280`, with a small chevron to open the column type menu.
- Column types: Text · Number · Status · Person · Date · Checkbox · Dropdown.
- **Status pill**: 22px tall, 12px horizontal padding, 11px radius (full pill), 12px/600 caps text. Default palette:
  - Not Started: `#E5E7EB` bg / `#3D3D3D` text
  - In Progress: `#FFF1D6` bg / `#A65C00` text
  - Done: `#DEF3E1` bg / `#1F6F3F` text
  - Blocked: `#FCE3E0` bg / `#B0341E` text
- Cell-type chooser: click pill → small popover with the option list, each row prefixed by a colored swatch dot (10px).
- Row hover: `#F7F8FA` background; selected row: `#FDECE6` background.
- Borders: 1px `#E5E7EB`. No outer table border — only horizontal row separators. Cell padding 8px 12px.
- Hover toolbar (insert row/col, delete, sort): floats above the table at the top edge, 28px tall, white bg, soft shadow.

---

## 9. Document Feel

- Canvas is **flat white `#FFFFFF`** sitting on `#F4F5F7` app background — no paper shadow or skeuomorphic page edges.
- Content column **max-width 720px**, centered, with 64px top padding and 96px bottom.
- Doc title (H1) sits at the very top of content. Below it: thin metadata row — author avatars (24px), "Last edited X min ago", a star icon.
- No cover image area by default. Quip is text-first; images are inline only.
- Section spacing: 32px above H2, 24px above H3, paragraph spacing 12px.
- Selection color is the warm coral tint `#FDECE6`.

---

## 10. Mobile / Responsive

| Breakpoint | Behavior |
|---|---|
| ≥ 1280px | Full layout: sidebar (240px) + content + outline (220px) + right rail (320px) |
| 1024-1279px | Outline overlays; right rail collapses to icon |
| 768-1023px | Sidebar collapses to 56px icon strip; content full-bleed under chrome |
| < 768px | Sidebar becomes overlay drawer; right rail becomes full-screen sheet; floating "+" tab is replaced by a **gray formatting bar above the keyboard** |

Mobile-specific:
- Formatting bar (mobile): 44px tall, `#EEF0F2` bg, horizontally scrollable button row, 32px icons with 12px gap.
- Tap target minimum 44×44px.
- Header collapses on scroll — title shrinks to 17px and pins as a thin 44px bar.

---

## 11. Spacing & Radius Tokens

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--radius-sm` | 4px (chips, inline pills) |
| `--radius-md` | 6px (buttons, inputs) |
| `--radius-lg` | 12px (modals, message bubbles) |
| `--radius-pill` | 999px (status pills) |
| `--shadow-toolbar` | `0 2px 8px rgba(0,0,0,0.12)` |
| `--shadow-modal` | `0 12px 32px rgba(0,0,0,0.18)` |
| `--shadow-popover` | `0 6px 16px rgba(0,0,0,0.14)` |
| `--transition-fast` | `120ms ease-out` |
| `--transition-base` | `200ms ease-out` |

---

## Sources

- https://quip.com/blog/typography — Atlas Grotesk, Lyon Text, Publico, Duplicate Sans, Courier Prime themes
- https://quip.com/blog/new-quip-sidebar-menus — dark sidebar, notification glow, hierarchy
- https://quip.com/blog/document-outlines — outline anchored far-right of doc
- https://quip.com/blog/formatting — floating right-side blue tab, hover-expand panel
- https://quip.com/blog/granular-permissions-for-quip-docs — Full/Edit/Comment/View levels
- https://quip.com/blog/quip-editor-a11y — keyboard model, ARIA, focus
- https://quip.com/training/accessibility-for-quip — sidebar collapse, menu bar
- https://www.brandcolorcode.com/quip — `#C64A32`, `#F27557`, `#3D3D3D`, `#FFFFFF`
- https://help.salesforce.com/s/articleView?id=sf.quip_dropdown_lists_in_spreadsheet_cells.htm — status/dropdown column type with assignable colors
