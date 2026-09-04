# Shareable journey tickets

View ticket is optional on arrival and available for each completed journey in the existing Journey log. Closing a ticket returns to the arrival screen or history entry. Tickets remain available from history after refresh. No ticket is created for an incomplete or cancelled session.

The fixed dark transit pass is an original 1080 × 1350 SVG, rasterized locally with a browser canvas. Download PNG saves the image. Share PNG appears only when Web Share supports the actual PNG file; the file is prepared before the share click to preserve browser user activation. Unsupported browsers offer Download PNG. Dismissing sharing leaves the ticket available; export failures show a retry action without altering saved progress. No external fonts, images, screenshot services, APIs or dependencies are used.

## Included data and privacy

An explicit allowlist reads saved history and its matching network references: line name and colour, route code, origin/context, destination, Study or Revision, completed duration, local completion date/time with timezone, and journey number. Revision passes say REVISION / MAINTENANCE SERVICE. An exam on the same line and the time of a linked scheduled departure are included when available. Private departure notes, profile information, email and other non-journey fields are never read into ticket data or artwork.

Long labels wrap within fixed text areas; overflow uses an ellipsis. The accessible SVG description retains full labels. The preview has keyboard focus containment, close/focus restoration and touch-sized actions. Ticket artwork has no animation or external resources.

## Persistence and compatibility

Tickets are derived on demand, so the storage schema, timer engine, revision rules, exams and timetable logic are unchanged. Completion is still persisted before arrival is rendered. Older saved history works through the existing recovery code, with sensible labels for missing references.

Tickets reflect the current network names, line order and associated exam when viewed. They are not immutable historical snapshots. Journey numbers follow the order of retained history, matching the arrival counter; later journeys do not renumber earlier ones, but deleting earlier history can. Completion timestamps and duration come from the original journey record. The exported PNG is a fixed copy of what was previewed. Downloading a ticket does not back up the underlying network.

## Verification

Tests cover data generation, study/revision/scheduled journeys, privacy, missing optional references, long/unbroken/non-Latin labels, chronological numbering, SVG escaping, share capability detection, and rasterization failure cleanup. Browser checks verify a real PNG signature and 1080 × 1350 dimensions, arrival and history access, refresh recovery, keyboard focus, mobile controls, and desktop layouts. Native share-target delivery depends on the browser and operating system; no message is sent automatically.
