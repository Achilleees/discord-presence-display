# Audit Decisions

Disputed findings from verified audit reports that require human judgment.

---

### 3.1 -- `CONTROL_CHAR` regex does not reject all invisible Unicode characters (RESOLVED, 2026-05-01)
- **Location:** `src/config.ts — sanitizeCustomWords()`
- **Issue:** Regex missed U+2060-2064, U+2066-2069, U+FFF9-FFFB (invisible/formatting Unicode)
- **Resolution:** Fixed — replaced hand-rolled character class with `\p{Cc}\p{Cf}` Unicode property escapes. Covers all current and future control/format characters.
- **Decided by:** Achille
