# Weekly recap

Open **Weekly recap** in the Network footer. The report opens on this week (marked In progress); Previous week and Next week let you review past weeks, including the last completed week. Future weeks are unavailable. Reports are generated on demand from existing saved data, with no background job, automatic popup, notifications, new analytics store or backend.

## Week and counting rules

- Weeks run Monday 00:00 inclusive to the next Monday 00:00 exclusive in the device's local timezone: all of Sunday, including 23:59:59.999, belongs to the preceding week. Local calendar arithmetic accounts for daylight-saving changes; weeks need not contain exactly 168 hours.
- Only completed history records count. Each journey's entire focused duration belongs to its local completion day/week, even when it started on an earlier day/week. Running, paused and cancelled journeys are not counted, and future completion timestamps are excluded.
- Focus time is the sum of focusedSeconds; displayed durations use whole minutes. Journeys count all completed study and revision sessions.
- Stations studied counts distinct line/station pairs visited by those sessions. Stations completed counts existing stations whose recorded firstCompletedAt falls within the week. Repeat studies and revisions do not count as new station completions. Legacy stations with an unknown first-completion date cannot be assigned a completion week; their recorded journeys still count as activity.
- Revision sessions count history records explicitly marked revision.
- Busiest line has the greatest total focused time. Equal totals use stable line-ID order. Longest journey uses focused duration, then earliest completion timestamp and journey ID to break ties. Most productive day uses total focus time; tied days choose the earlier local calendar date.
- Scheduled results include departures whose scheduledAt falls within the selected week, evaluated at report generation time using the existing timetable status rules. Completed journeys may have boarded early or arrived later than the selected week. Missed means unstarted and more than 30 minutes late. Completion rate is completed / (completed + missed), rounded to a whole percentage. Pending/boarded and cancelled departures are shown separately and excluded from that denominator. With no completed or missed departures, the rate is unavailable rather than a fabricated percentage.

## Current network context

Maintenance due and nearest exam are explicitly labelled **Network now**, using the report's displayed As of time even when viewing a past week. Maintenance uses the existing revision predicate. The nearest exam is the earliest exam today or later on an existing line; expired exams are excluded and days remaining uses the existing local-calendar exam calculation. Exam ties use exam ID. No upcoming exam produces a clear empty readout.

Reports are snapshots while open. Reopen the view or navigate weeks to recalculate. Current network labels are used, and deleting source stations/history/departures can change past reports. There is no duplicate historical analytics store or change to existing persistence/recovery.

## Sharing

The share image is a self-contained 1080 × 1350 SVG rendered to PNG client-side using the existing ticket rasterization helper without modifying Journey Ticket behavior. It includes branding, date range, focus time, busiest line, new station completions, total journeys and revision sessions. An expandable image preview shows what will be exported. Private profile fields and departure notes never enter the report data or image. Zero-activity reports show actual zeros and an explicit no-services message.

Download recap image is available after PNG preparation. Share recap appears only if the browser supports sharing the actual PNG file. Export errors offer retry; cancelled or failed sharing leaves download available. No sharing occurs without a click. Rendering and sharing never mutate study data.

## Verification

Tests cover exact week boundaries, DST and year changes in four timezones, cross-day journeys, busiest line and ties, longest journey, most productive day, zero activity, first station completion vs revision, scheduled cohorts/completion rate, maintenance/exam snapshots, privacy, SVG escaping and read-only generation. Browser checks cover current/previous weeks, empty state, keyboard focus restoration, mobile overflow, download controls and a real PNG signature and dimensions.
