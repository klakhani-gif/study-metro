# Station maintenance / revision

Maintenance is a due state derived from a completed station's review metadata. It does not revoke completion, change station order, or change Exam Terminal calculations. The map keeps the station filled and adds a quiet segmented service ring. A count appears in the network heading only while stations are due.

## Schedule

| Completion | Stored review count | Next maintenance |
| --- | --- | --- |
| Initial study | 0 | 7 days later |
| Revision 1 | 1 | 14 days later |
| Revision 2 | 2 | 30 days later |
| Revision 3 and later | 3+ | 45 days later |

Days mean elapsed 24-hour periods, added to the actual completed timer deadline. A delayed wake/reopen does not push the schedule into the future. At `now >= nextReviewAt`, the station is due. Map and panel readouts update at the next due timestamp and when the app becomes visible, without resetting an editor or moving keyboard focus.

Completed stations can be revised early. Finishing an early revision still increments the count and starts the corresponding interval from that completion. Cancellation and pause do not change review metadata. Only a successfully persisted completed journey advances the schedule.

## Data

Schema 4 adds these station fields:

- `firstCompletedAt`: timestamp of the first known study completion, or null if unknown.
- `lastReviewedAt`: most recent study/revision completion timestamp, or null if unknown. The panel labels it “Last studied.”
- `reviewCount`: completed revision journeys only; the initial study is zero.
- `nextReviewAt`: next deadline timestamp, or null when no dated completion is known.

Active journeys and history records carry `kind: "study" | "revision"`. New journeys on completed/mastered/legacy revision-due stations are revisions. They use the existing `JourneyTimer` and Focus Mode, with “MAINTENANCE SERVICE” context. Revision completion writes history and metadata together before arrival renders. The station remains completed throughout a revision, including pause and cancellation.

## Older saves

The existing localStorage key (`study-metro:v2`) and v1 fallback remain unchanged. Recovery continues to keep the original raw save in `study-metro:recovery` before writing migrated data. No history or exam is removed by this migration.

- Old history and active journeys without a kind remain `study`; their timestamps/timer snapshots are preserved.
- Missing completion dates are inferred from dated study history. The latest dated journey establishes the initial seven-day schedule; old repeated study records are not relabelled as revisions.
- Completed stations with no dated history keep unknown dates and are due for a baseline revision. The panel shows “Not recorded.” Their first-study date remains unknown after that revision and refresh; their next deadline becomes known.
- Existing valid review metadata survives reload unchanged. Invalid fields are repaired independently from valid station and journey data.
- Untouched and in-progress stations are never made due merely because their dates are absent. The legacy `revision_due` status still renders as due; new due states are derived without changing the stored `completed` status.

## Verification

Tests cover initial scheduling, all later intervals, deadline boundaries, elapsed-day behavior, revision completion, old/undated/malformed station migration, revision snapshot and history recovery, and unchanged exam progress. Browser checks cover desktop/mobile presentation, keyboard selection, pause/refresh/resume, cancellation, arrival, saved revision history, and due-date updates.
