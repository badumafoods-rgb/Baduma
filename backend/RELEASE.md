# Realtime integration: pending database approval

Target: existing BADUMA Supabase project `mduiomtaykqeenoohaee`.

The live site has NOT been updated. The migration was rejected by automatic approval review because it changes production order schema, policies, grants, privileged routines and realtime publication without sufficiently specific authorization or staged verification. No database changes from this branch were applied.

## Prepared functionality

- Live catalogue and availability; authenticated customer ordering and owned order history.
- Server-calculated menu prices, supported extras, distance-based estimated delivery fee, discounts and idempotent submission.
- Manager order transitions, active rider assignment, POS cash sales, promotions and availability.
- Assigned-rider GPS updates, customer tracking, delivery signature/COD capture and cashier handover.
- Postgres Changes subscriptions, reconnect refresh and periodic fallback refresh under row-level security.

## Database changes for review

`backend/realtime.sql` adds order details, request IDs and discounts, allows POS channel, adds promotions and rider location tables, creates scoped read/write policies, adds authenticated RPCs and enables realtime for the required tables. Existing catalogue data and orders are retained. Signature data is stored in the existing settlement signature column with an explicit size limit and protected read access.

## Activation sequence after approval

1. Validate and apply `backend/realtime.sql` to the named project. No auth-user export is needed.
2. Verify public catalogue access, customer isolation, staff role restrictions and status transitions using scoped test accounts. End-to-end database and websocket tests have not yet run.
3. Confirm the intended administrator account and assign its role through a trusted administrative process. Never accept a browser-selected staff role. Existing employees table is empty; staff access requires provisioning.
4. Configure actual active dining-table labels; none currently exist. Dine-in orders intentionally reject unknown tables.
5. Confirm Supabase email authentication and allowed redirect URL for the retained site. Users create/sign into real accounts; no simulated code is accepted.
6. Package the repository with `dist` as the static directory, deploy to the retained Site and validate two independent authenticated sessions.

Delivery distance is currently entered at checkout and priced server-side. GPS provides directions and rider tracking; it does not calculate a verified road distance. Foreground browser GPS stops when the view changes or the user signs out. No background native location service is provided.

## Validation completed

`node --check dist/realtime.js` and `node backend/verify-client.cjs` pass. The pinned Supabase browser library URL returns HTTP 200. These checks do not prove database migration or cross-device realtime behavior; activation remains blocked until approval and database verification.
