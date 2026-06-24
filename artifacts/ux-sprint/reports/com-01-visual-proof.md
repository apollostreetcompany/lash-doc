# COM-01 Visual Proof - Comment Rail

Date: 2026-06-24 UTC

Branch: `codex/ux/com-01-comment-rail`

Baseline: `artifacts/ux-sprint/lash/com-01/baseline/desktop-1440-chat.png`

Final: `artifacts/ux-sprint/lash/com-01/final/desktop-1440-chat.png`

## Reference Behavior

- Quip accessibility docs describe comments as section-specific indicators while conversation remains available beside the document: `https://quip.com/training/accessibility-for-quip`.
- Salesforce Trailhead describes Quip as having both specific comment threads and an overall document conversation in the right sidebar: `https://trailhead.salesforce.com/content/learn/modules/quip-for-service-cloud/collaborate-with-quip-for-service-cloud`.
- Quip's chat direction emphasizes cleaner, compact chat across device classes: `https://quip.com/blog/chat-import-export`.

## Result

COM-01 moves Lash from an empty/admin-like chat rail toward a document-attached comment experience:

- The final desktop chat capture shows a small comment marker beside the selected document text.
- The selected target text is highlighted in the document and echoed as a compact Current target row in the rail.
- The thread row uses a light left rule and flat layout rather than a heavy card.
- The Show action reselects the mapped document range and is keyboard/screen-reader covered.
- History/current context remains visible for diff-aware reading.

## Screenshots Reviewed

- `artifacts/ux-sprint/lash/com-01/final/desktop-1440-chat.png`: pass. Shows the document-side marker beside `responsiveness`, compact rail target row, and active anchor status.
- `artifacts/ux-sprint/lash/com-01/final/desktop-1440.png`: pass. General writing surface remains calm; no new chat marker appears when no thread is created.
- `artifacts/ux-sprint/lash/com-01/final/tablet-1024.png`: pass. Existing rail/chrome layout remains stable.
- `artifacts/ux-sprint/lash/com-01/final/tablet-large-768.png`: pass. No text overlap or broken toolbar/rail layout observed.
- `artifacts/ux-sprint/lash/com-01/final/mobile-375.png`: pass. Existing mobile layout remains stable.
- `artifacts/ux-sprint/lash/com-01/final/focus-mode-1440.png`: pass. Focus mode remains document-first and does not expose the rail.

## Remaining Caveats

- COM-01 does not replace the current text-occurrence anchor model. If the same selected text appears multiple times, anchors can still resolve to the first matching occurrence until a later bead stores true editor positions.
- Reload of the test-seeded document preserves the thread but not the seeded document body, so the UI correctly shows `Context lost`, no marker, and a disabled Show action.

## Validation Receipts

- Packet: `artifacts/ux-sprint/reports/com-01-packet-validate.log`
- Focused e2e/a11y: `artifacts/ux-sprint/reports/com-01-e2e.log`
- Typecheck: `artifacts/ux-sprint/reports/com-01-typecheck.log`
- Lint: `artifacts/ux-sprint/reports/com-01-lint.log`
- Build: `artifacts/ux-sprint/reports/com-01-build.log`
- Tracker CSV: `artifacts/ux-sprint/reports/com-01-tracker-validate.log`
