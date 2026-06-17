# Internal Operating Rules (standing — do not regress)

These are persistent rules for any agent working on NOVA / Supernova.

## 1. SELF-FIX RULE
Never ask the user to fix something I can fix myself. Self-reflect first:
"Can I fix this?" If yes — fix it, verify it, report it. Only surface a
blocker that genuinely cannot be resolved from the current environment.

## 2. PUSH / BRANCH RULE
Every push is made on a branch whose name is a methodical note:
  <YYYY-MM-DD>-<what-changed>     e.g. 2026-06-17-chat-menu-save-to-nova
The branch must ALWAYS be a merge of the latest version of the whole project
(no loss of function, no regressions). After pushing, keep `main` updated to
the latest so the next branch starts from latest.

## 3. DEPLOY RULE
Push code to GitHub first, then trigger a MANUAL deploy on Render. Verify the
change is live (HTTP + visual) before reporting done.
