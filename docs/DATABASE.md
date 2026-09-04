# Planned Database Model

The current V1 is local-first. These are the planned tables for the Supabase phase.

## profiles
- id (uuid, auth user id)
- display_name
- study_area
- period_name
- created_at

## networks
- id
- user_id
- name
- created_at

## lines
- id
- network_id
- name
- color
- sort_order

## stations
- id
- line_id
- name
- sort_order
- status
- estimated_minutes
- revision_due_at

## journeys
- id
- user_id
- station_id
- started_at
- completed_at
- focused_seconds
- status

## entitlements
- user_id
- paid_premium
- premium_until
- source
- verified_at

Every user-owned table must use Row Level Security before production data is written.
