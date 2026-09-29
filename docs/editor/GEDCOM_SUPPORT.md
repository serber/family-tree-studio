# GEDCOM support and preservation contract

## Supported input

- GEDCOM 5.5.1 with an explicit `CHAR UTF-8` or `CHAR ASCII` header.
- GEDCOM 7.0 with UTF-8. A UTF-8 BOM is accepted and retained.
- LF, CRLF, and CR line endings, including a missing final line ending.
- Up to 5,000 people and 20 MiB per file. Files without any `INDI` records are accepted.

ANSEL, UTF-16, other legacy encodings (including `CHAR ANSI`/CP1251), GEDZIP, and other GEDCOM versions (including `5.5`) are explicitly rejected. Invalid UTF-8 is rejected rather than decoded with replacement characters. This avoids corrupting names during import.

## Documents created in the app

A new tree (and every demo tree) gets a generated GEDCOM 5.5.1 UTF-8 skeleton as its source: `HEAD` with `SOUR FAMILY_TREE_STUDIO`, a `SUBM` record, and `TRLR` (`src/editor/gedcom/skeleton.ts`). Everything the user adds is exported as structural insertions into that skeleton, so created and imported documents share one export path and one set of tests.

## Storage and export strategy

`TreeDocument.gedcom.text` contains the complete original decoded text. The UI edits a separate people/families projection. The source is included in IndexedDB drafts, automatic snapshots, and JSON backups.

The parser builds a line tree with original raw lines, line endings, cross-reference IDs, levels, tags, payloads, and children. On export, `exportGedcom` re-imports the original text as a baseline projection, compares it with the current document, and edits only what changed:

| Change | Output |
| --- | --- |
| Nothing | The original text, byte for byte |
| Supported field edited | Only the affected line payloads are rewritten; missing structures are inserted |
| Person or family added | A new `INDI`/`FAM` record is inserted before `TRLR` |
| Person or family deleted | Its record is removed, together with every line elsewhere that points to it (`FAMC`, `CHIL`, `ASSO`, …) |
| Relationship added or removed | Only the affected `FAMC`/`FAMS`/`HUSB`/`WIFE`/`CHIL` lines are added or removed, on both sides |

Link reconciliation looks only at relationships that differ from the baseline. Inconsistencies already present in the source (for example, a `FAMS` without a matching `HUSB`) are preserved as they were, not silently repaired.

New IDs come from monotonic counters (`TreeDocument.nextIds`). The counters start above the numeric suffix of every xref in the source, so a new record never collides with an existing one, and the ID of a deleted person is never reused. The exporter still refuses to write a new record whose ID already exists in the source.

For a new family, partner roles are derived from sex: a man is `HUSB` and a woman is `WIFE`; unknown sex fills the free role. Existing role lines are not rewritten.

Unit fixtures verify byte equality for unchanged files (BOM, line endings, trailing newline) and exact expected output for field edits, additions, deletions, and moved links. A 1,000-person generated tree round-trips through export and re-import with identical people and families. These are tested guarantees for the supplied fixtures, not certification of compatibility with every producer.

## Editable projection

| UI field | Source structure | Behavior |
| --- | --- | --- |
| Given name + patronymic | First `INDI.NAME` given portion, optional `GIVN` | Exported together as the given portion (`Иван Петрович /Сидоров/`, `GIVN Иван Петрович`). On import, a trailing word ending in -ович/-евич/-ич/-овна/-евна/-ична/-инична is shown as the patronymic; a lone such word (5+ letters) is a patronymic with no given name |
| Surname | First `INDI.NAME` surname portion, optional `SURN` | Replaced inside the slashes; the structured field is updated |
| Birth surname (урождённая) | Additional `NAME` with `TYPE birth`/`maiden` | Surname replaced in place; a new one is written as `NAME … /X/`, `TYPE birth` (`BIRTH` in 7.0), `SURN X`; clearing it removes that `NAME` substructure |
| Sex | `INDI.SEX` | Line updated or inserted after the names |
| Birth / death date and place | First `BIRT`/`DEAT` with `DATE`, `PLAC` | Raw values preserved; clearing every value of an event keeps the fact as `1 DEAT Y`; adding a value to an `… Y` event drops the `Y` |
| Note | First inline `INDI.NOTE` | Payload/continuations edited; citations and other children retained; shared note pointers unchanged |
| Marriage date and place | First `FAM.MARR` `DATE`, `PLAC` | Same rules as events |

Name edits replace the old `GIVN`/`SURN` text inside `NAME` only as a whole word. If the old text is missing, matches only part of a word, or appears more than once, the rewrite is refused. Prefixes, suffixes, and other name records stay untouched.

Dates are stored as GEDCOM values. The UI shows them in the current language and accepts Russian or English input (`src/editor/model/dates.ts`): `ок. 1900` ↔ `ABT 1900`, `12.03.1900` ↔ `12 MAR 1900`, `до`/`после`, `между … и …`/`1890–1895` ↔ `BET … AND …`, `с … по …` ↔ `FROM … TO …`, `ст. ст.` ↔ `@#DJULIAN@` (5.5.1) or `JULIAN` (7.0). English input: `abt.`/`about`/`circa`, `bef.`/`before`, `aft.`/`after`, `calc.`, `est.`, `between … and …`, `from … to …`, `12 Mar 1900`, `March 12, 1900`, `(O.S.)`/`julian`. Unrecognized text is stored as typed and listed in «Замечания» (Issues).

GEDCOM 5.5.1 note output escapes at-signs and uses `CONT`/`CONC` with a conservative UTF-8 line budget. Text is split before escaping, so `@@` never spans two lines, and `CONC` breaks avoid spaces at line edges. GEDCOM 7 output uses `CONT` and version-specific leading-at-sign escaping. Empty lines in notes are preserved.

ASCII sources cannot be exported with new non-ASCII characters; the edit is still in the browser draft and JSON backups. Implicit encoding conversion is intentionally absent.

## Data that is not exported

Review marks («Режим проверки», `TreeDocument.verified`) are stored in the browser draft, snapshots, and JSON backups, but never in GEDCOM. Marking people does not change the exported file (covered by an e2e test). Re-importing a GEDCOM starts with no marks.

## References and malformed data

Family cards and lines derive from `FAM.HUSB`, `FAM.WIFE`, and `FAM.CHIL`. These tags do not impose a person's displayed sex; `INDI.SEX` does. Repeated marriages and shared ancestors are allowed. A family with more than two `HUSB`/`WIFE` links is rejected.

Missing references and inconsistent reverse `FAMC`/`FAMS` links generate warnings (shown in «Проверка»). Missing people are omitted from the display, but the original link lines remain in exports. Warnings are capped at 100.

Duplicate cross-reference IDs, invalid line nesting, missing header/trailer, and cycles in the parent–child graph are rejected before replacing the current document. The editor also refuses edits that would create a cycle.

## Current limitations

- No full GEDCOM semantic validation or independent external-validator run yet.
- Only the fields in the table above are editable. Other events, sources/citations, media, shared notes, adoption details (`PEDI`, `ADOP`), and additional names are preserved but not editable.
- Deleting a person or a family deletes the whole record, including data the UI does not show (sources, other events). Merging duplicates keeps the first person's record and deletes the second one's record the same way.
- Child order is only appended to; reordering children is not supported.
- Header producer metadata and change timestamps (`CHAN`) are left untouched.
- No real user-provided files have been tested. Fixtures are synthetic and authored in this repository.

## Specification references

- [FamilySearch GEDCOM 7 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html): hierarchical lines, continuation pseudo-structures, version-specific escaping, and record structures.
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf): legacy structure and character-set declarations.

Before extending the editable projection, add a fixture and an exact-output test for the new structure.
