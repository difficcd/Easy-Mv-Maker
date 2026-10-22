# Undo history: what every change paid

Measured 2026-10-22 on the three largest saved projects (the cuts as the app holds them, pixels
excluded - those live in the bitmap store).

## The cost

Every change to the document - every stroke committed - is recorded for undo, and recording did
three passes over the whole document: stringify the new snapshot, stringify the previous one
**again** to compare them, and parse the new one back into a copy to keep. Per change:

| document | before | after |
|---|---|---|
| 3,575KB, 24 cuts | 89.0ms | **32.0ms** |
| 2,118KB, 11 cuts | 62.1ms | **20.4ms** |
| 871KB, 2 cuts | 21.0ms | **8.5ms** |

Paid on every stroke, before anything was drawn - the larger the project, the heavier every action.

## Change

Entries are kept **as their JSON** (`core/historyOps.HistoryEntry`). A string is already a copy
nothing can edit, the last entry's string is what the next change compares against, and parsing
happens only when undo actually steps. One stringify per change.

The catch was the bitmap collector, which freed pixels by scanning every history entry's cuts for the
ids they refer to - freeing one an undo still needs is an undo that comes back blank. Parsing the whole
history on each save to ask would have moved the cost rather than removed it. So each entry keeps, beside
its JSON, the ids it referred to, taken with `collectUsedBitmapIds` itself when the entry was recorded
(`useHistory`'s `summarize`); the collector takes them as `historyIds`. Tests pin that an id only an undo
step refers to is kept, and that the ids handed over equal what scanning the snapshot finds.

## Still on the table

The remaining 32ms is the one stringify of the whole document. Most changes touch one cut, and the
reducer hands back new objects only for what changed - so caching each cut's JSON by object identity
would make a change cost the size of one cut. It is not done, because it relies on no cut object ever
being edited in place after it is recorded; that needs an audit, not an assumption.
