# BADUMA Ordering Preview

Existing BADUMA customer menu and staff panel preview migrated from BADUMA Ordering Preview (version 6).

## Run

Serve this repository as a static website. The entry point is `index.html`; images, styles and JavaScript are embedded. No install or build step is required.

## Current functionality

Customer menu and test orders, manager order handling and POS, promotions, rider delivery workflow, signature capture and cashier handover views.

## Data and authentication

This is a local test preview. Orders and promotions use browser localStorage and do not sync across devices. Role selection and the displayed preview sign-in code are simulations, not production authentication. Rider GPS is displayed locally. Use sample data only.

No Supabase backend is connected in this migrated version. Production use requires server-side authorization, shared order storage, validated pricing and status transitions, and authenticated staff roles.

## Source

`index.html` is the recovered bundled preview artifact, not the original editable framework source. The original hosted preview remains at https://baduma-ordering-preview.spiffybard257.chatgpt.site .
