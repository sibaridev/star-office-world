# Moroccan Darija Compact Joke Card Specification

## Overview
This specification defines a compact, scannable card structure for Moroccan Darija jokes designed for a 5-second reading window (such as a 5-second cadence display or feed). Each card pairs natural Moroccan Darija in Arabic script with phonetic Arabizi, a clear category tag, and brief idiom or punchline notes so readers grasp both the literal wording and cultural humor quickly.

## Design Goals for 5-Second Reading
- **Total text budget:** Keep total card copy concise (typically 25–55 words across all fields) so an average reader can scan the joke, Arabizi, and note in under 5 seconds.
- **High visual hierarchy:** Separate the Arabic script joke, Arabizi transliteration, category tag, and punchline/idiom note into distinct visual slots.
- **Low cognitive friction:** Avoid multi-paragraph setups or dense linguistic footnotes; surface only the key cultural cue or wordplay needed for the punchline.

## Card Schema

| Field | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | string | Unique identifier (e.g., `mj-001`) | Tracking, deduplication, and rotation state |
| `category_tag` | string | 1–2 words, uppercase or pill label | Fast topical filtering (e.g., `FAMILY`, `DAILY LIFE`, `WORDPLAY`, `TRAVEL`, `TECH`) |
| `arabic_script` | string | Concise Darija (1–2 short lines; max ~18 words) | Authentic Arabic orthography for native/fluent readers |
| `arabizi` | string | Latin-script Darija matching the joke (`3`, `7`, `9` for `ع`, `ح`, `ق`) | Fast phonetic reading for diaspora or Latin-script readers |
| `punchline_note` | string | 1 short sentence (max ~15 words) | Explains the idiom, double meaning, or cultural punchline |

## Formatting & Style Rules
1. **Arabic Script (`arabic_script`):** Use natural Moroccan Darija phrasing rather than Modern Standard Arabic. Keep setup and punchline tight so there is no scrolling or long pause.
2. **Arabizi (`arabizi`):** Stay consistent with standard Moroccan Arabizi conventions (`3` for ع, `7` for ح, `9` for ق, `ch` for ش, `gh` for غ) and mirror the exact beats of the Arabic line.
3. **Category Tag (`category_tag`):** Assign a single clear domain tag so rapid 5-second cycles feel varied across consecutive cards.
4. **Idiom / Punchline Note (`punchline_note`):** Highlight the specific Darija expression, literal-vs-figurative twist, or everyday Moroccan context that makes the joke land—without over-explaining.

## Example Cards

### Example 1 — Wordplay / Everyday Wit
- **ID:** `mj-001`
- **Category Tag:** `WORDPLAY`
- **Arabic Script:**
  علاش الطوموبيل ما كتنعسش؟
  حيت ديما فيها الفران!
- **Arabizi:**
  3lach tomobil ma katn3assch? 7it dima fiha l-fran!
- **Punchline Note:** Plays on *fran* (car brake) sounding like a restless/alert mood in casual banter.

### Example 2 — Daily Life
- **ID:** `mj-002`
- **Category Tag:** `DAILY LIFE`
- **Arabic Script:**
  قال ليه: فوقاش غادي تخلصني؟ قال ليه: نهار يطيح الثلج ف الصحراء.
- **Arabizi:**
  Gal lih: fou9ach ghadi tkhallassni? Gal lih: nhar yti7 t-telj f s-se7ra.
- **Punchline Note:** Uses the classic "when snow falls in the desert" impossibility idiom to dodge paying up.

### Example 3 — Family & Habits
- **ID:** `mj-003`
- **Category Tag:** `FAMILY`
- **Arabic Script:**
  الواليدة كتسولني واش تغديت، وباقي ما حطيتش الساروت ف الباب.
- **Arabizi:**
  L-walida katswelni wach tghddit, w ba9i ma 7ttitch s-sarout f l-bab.
- **Punchline Note:** Captures the classic Moroccan mom reflex of checking if you ate before you even step inside.

## 5-Second Pacing Checklist
- Can the joke be read aloud or silently in ~2–3 seconds?
- Does the punchline/idiom note land in ~1–2 seconds without re-reading the joke?
- Is every field free of filler, long backstories, or ambiguous abbreviations?
