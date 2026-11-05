# To do (captured items, not scheduled)

## Statements screen: collapsible file lists
The list of imported files under each statement group should collapse, with the count shown in the heading, for example `AMEX (14)` and `Joint account (15)`. Tap the heading to open or close. Remember the open/closed state per group on this device. This is a UI change to the core app, so it is separate from the smart-parser branch and only done when asked.

## Smart parser
- Upload routing (PDF or CSV detected automatically) and "unreadable PDF is not kept, show a clear message to try the CSV" (see `SMART-PARSER-DESIGN.md` section 5c).
- CSV reader (plug-in), once real bank CSV exports are available.
- Cross-statement continuity check (closing balance of one statement equals the opening of the next).
- Tamper (mutation) tests: a verified statement with one amount changed must never stay verified.
