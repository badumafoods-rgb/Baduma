# BADUMA live ordering

Supabase-backed customer ordering and staff panel.

- Customer: https://baduma-ordering-preview.spiffybard257.chatgpt.site/customer/
- Admin: https://baduma-ordering-preview.spiffybard257.chatgpt.site/admin/

Serve this repository as a static site; no build is required. Entry points are index.html, customer/index.html and admin/index.html, with realtime.js at the root. The retained Sites deployment uses the same assets under its dist directory.

Database integration uses project mduiomtaykqeenoohaee. Only a public publishable key is included in client code. Account passwords and privileged keys are never committed. Staff authorization is enforced by database roles and policies, not browser navigation.

Implemented: live catalogue, owned customer orders, server pricing and idempotency, manager confirmation/preparation/dispatch, POS sales, promotions, availability, rider GPS and delivery/COD signatures, cashier settlement.

Verified against the backend: master and test-customer login, anonymous order access denial, server pricing, duplicate submission handling, denial of customer staff actions, admin status transition, customer status read, and actual websocket insert/update delivery. One clearly labelled rejected verification order remains for inspection. Both public routes and live catalogue render in the browser. Rider/cashier physical-device flows remain for acceptance testing.

Delivery route distance is currently entered at checkout and is an estimate. Dining-table labels and rider staff accounts must be configured before those workflows can be used. GPS sharing requires an open browser and user location permission.

See backend/RELEASE.md for setup and acceptance notes. backend/realtime.sql has already been applied; do not rerun it unchanged.

Source note: index.html contains the recovered bundled React menu and embedded images; realtime.js is the editable backend integration.

Validation: node --check realtime.js; node backend/verify-client.cjs.
