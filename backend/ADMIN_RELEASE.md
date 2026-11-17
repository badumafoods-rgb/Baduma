# BADUMA Admin modules

Master Admin has a distinct dashboard with Users, Products, Expenses, POS, Orders, Promotions and Cashier modules. Existing masteradmin credentials are retained.

## Hierarchy

Only Master Admin can create Managers. A Manager with users.manage can create and manage their own Driver, Cashier and Employee accounts. They cannot create peer Managers, modify another Manager, manage another Manager's staff or grant permissions outside their authority. A Manager with orders.manage may delegate delivery.use to a Driver. No account creation route grants a new Master Admin role.

The Users form includes role defaults and individually selectable permissions. Account creation returns a generated password once and a login link containing only the username. Password reset is explicit. Disable removes backend staff authorization and bans subsequent sign-ins. Existing staff tokens consult live permissions on every operation.

User provisioning uses the authenticated baduma-staff-admin Supabase Edge Function and the server-side Auth Admin API. No service key or account password is committed.

## Products and expenses

Products supports creation/editing, category, preparation time, multiple sizes/prices, ingredients, spice level, optional HTTPS photo URL, and availability. Catalogue and POS load saved data live. Expenses supports date ranges, totals, add/edit and permission-controlled read/write. POS includes a server-backed bill and print action.

## Verification

- Master creates Manager; Manager creates Driver; each account signs in.
- Customer cannot create staff; Manager cannot create peer Managers.
- Driver cannot modify permissions or create products.
- Product sizes/prices and expense insertion verified through the API.
- Cashier without expense permission cannot write expenses.
- Unticking POS immediately prevents POS submission with an existing token; permission restored after the check.
- Temporary product/expense fixtures were removed after verification.
- Functional client rendering tests cover Master navigation, Driver/Cashier restrictions, permission checkboxes and product editor.

manager01, driver01 and cashier01 are available for device acceptance tests. Their initial passwords were returned directly to the user and are not stored here.
