# Exam terminals

Each subject line can have one exam terminal. Exams have their own entity (`id`, `lineId`, `name`, `examDate`, optional `targetCompletionDate`); they are never study stations or focus-session destinations. Their map position is derived after the final study station. Editing/reordering study stations updates the display and counts automatically. Removing an exam leaves the subject, stations and history intact. Deleting its subject removes its exam as well.

Create an exam directly with the Network screen's `+ Add exam` action or the subtle action beside a line without an exam. The global form lists only eligible lines. Select an existing terminal for details and direct Edit exam / Remove exam actions. Exam controls also remain available in Edit Network.

## Dates and status

Dates are local calendar dates stored as `YYYY-MM-DD`. The optional target must be on or before the exam; past dates are allowed and displayed honestly. Days remaining compare local calendar-day ordinals, avoiding daylight-saving and UTC parsing offsets. Readouts update at local midnight and when returning to the app.

The pace rule is intentionally simple, **not a prediction or personalized study plan**:

- `Completed`: no unfinished subject stations. `completed` and `mastered` count as finished; all other statuses, including `revision_due`, remain unfinished. An empty line has no unfinished work.
- `On track`: calendar days until the target completion date (or exam date when no target is set) are at least the number of unfinished stations.
- `Attention needed`: fewer days than unfinished stations, including today or overdue with unfinished work.

This assumes one unfinished station per calendar day before the planning date; it does not model daily available hours. Estimated remaining minutes are the sum of unfinished stations' estimates, not a new timer or scheduling engine. The exam-date countdown always refers to the real exam date even when a target drives the pace rule.

## Migration and persistence

Schema 3 adds `exams: []` and `selectedExamId: null`. The existing `study-metro:v2` storage key and v1 fallback remain in place to preserve session recovery. Older saves receive empty exam defaults. Invalid/orphaned/duplicate exams are discarded independently of station/session data; invalid optional targets become null. A selected exam is separate from the last selected study station.

Exam form changes are written before updating application state or showing success. If storage fails, the form keeps its values and shows a retryable error. Session snapshots, timer calculations and station completion are unchanged. Exam terminals cannot start a focus journey.
