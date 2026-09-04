# Timetable / Departures

Schedule journey on the Network screen opens the departure form. Timetable opens the compact board; pending journeys are grouped by local calendar day (Today, Tomorrow, Upcoming, with Earlier for older missed journeys). Completed and cancelled departures remain in a collapsed section. The map's Next departure strip chooses the earliest unstarted, non-missed departure. Missed departures stay available in Timetable.

## Status rules

All status calculations use the current timestamp, not a counter:

- Scheduled: more than 15 minutes before departure.
- Boarding soon: from exactly 15 minutes before, until the scheduled instant.
- Ready: from the scheduled instant through exactly 30 minutes after.
- Missed: more than 30 minutes after, if not boarded.
- Completed: the linked focus journey completed.
- Cancelled: the user cancelled the departure or ended its boarded journey early.

Only scheduled/completed/cancelled are stored as lifecycle states. Boarding soon, Ready and Missed are derived. A boarded departure reserves a journey ID and stays Ready until that journey completes or is cancelled; it cannot become missed or be boarded twice. Focus Mode is the interface while boarded. There is still only one active focus journey per browser origin, protected by the existing writer lock.

Start journey (or Start now for missed departures) can board early or late. Nothing starts automatically. There are no background notifications. Editing/rescheduling requires a future date, an existing station on the chosen line, an integer duration of 5–240 minutes, and an optional note of at most 280 characters. Date/time fields use the device's local timezone; saves store the absolute timestamp. Changing timezone changes the displayed local time, not the scheduled instant. Impossible dates and daylight-saving clock gaps are rejected. For an ambiguous fall-back time, the browser chooses its first occurrence.

## Journey integration

A departure is a separate entity in `AppState.departures`, with its own ID, line/station IDs, schedule timestamp, duration, note, lifecycle status, linked journey ID and creation timestamp. Its optional relation on ActiveJourney survives pause and refresh. Starting uses the existing JourneyTimer and Focus Mode unchanged. Study/revision context is determined by the station's completion state when boarding, rather than when scheduling.

On completion, the existing station completion/revision routine runs normally. History, departure completion and clearing the active journey are persisted together before arrival renders. Ending a journey cancels its departure without recording a completed session or changing station progress. A separate unscheduled journey does not complete a departure for the same station.

Deleting a station or line also removes its timetable entries, as described in the existing destructive-action confirmation. Reordering and renaming preserve departures through stable IDs. Cancelling a departure preserves the station, exams and study history.

## Compatibility and recovery

Schema 5 adds an empty departures array to earlier saves and preserves station metadata, exams, history and existing timer snapshots. The localStorage keys and backup architecture are unchanged. Existing recovery handling retains the original raw save before migration is written; unsupported newer schemas remain read-only.

Invalid departure records are salvaged independently, and entries pointing to missing stations are dropped. A matching historical journey repairs a scheduled departure to Completed. A stale link without a matching active or completed journey is released so the departure can be started/rescheduled again. Recovery never starts a timer on its own.

## Verification

Automated tests cover all time-status boundaries, local day grouping, input validation, missed rescheduling, next-departure selection, double boarding, active/paused recovery, linked completion, revision preservation, malformed records and migration/backup safety.
