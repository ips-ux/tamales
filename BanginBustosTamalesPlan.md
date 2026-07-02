Project Brief: Single-Merchant Ordering and Vendor Capture Platform
===================================================================

Role
----

Act as a senior product engineer, UX designer, database architect, security reviewer, and release manager. Build a production-ready, mobile-first ordering application for a local food business.

Do not treat this as a generic restaurant template or a contact form. It is a polished single-merchant preorder, fulfillment, and in-person vendor-capture platform.

Prioritize reliability, clarity, maintainability, accessibility, and owner usability over unnecessary features.

Primary Objective
-----------------

Create a responsive website and owner dashboard that allow:

1.  Customers to learn about the business.
    
2.  Customers to submit organized tamale order requests.
    
3.  The owner to manage products, prices, availability, and orders.
    
4.  The owner to run a phone or tablet in Vendor Mode.
    
5.  In-person customers to scan a QR code and order from their own devices.
    
6.  The owner to collect future-order leads when products are sold out.
    

The application must be deployable from a private GitHub repository to Cloudflare Pages.

Business Context
----------------

The initial menu contains two products:

*   Red tamales
    
*   Green tamales
    

Do not hard-code the application to only support two products. The owner must be able to add, edit, disable, reorder, or mark products sold out.

Orders are initially order requests requiring owner confirmation. Submission does not guarantee acceptance.

The business operates in the America/Denver timezone as a pop up - they will not have a pick-up location. All orders will be delivery by default to begin with, with the option to set a pickup location when available.

Technology
----------

Use:

*   React
    
*   TypeScript
    
*   Vite
    
*   Github Private Repos
    
*   Cloudflare Pages
    
*   Cloudflare Pages Functions
    
*   Firebase for database management
    
*   Cloudflare Access for administrative authentication
    
*   Cloudflare Turnstile for public submissions
    
*   Database migrations committed to the repository when possible
    
*   Integer cents for all monetary values
    
*   UTC timestamps in storage
    
*   America/Denver for presentation
    

Use a minimal dependency footprint.

Repository Requirements
-----------------------

Include:

*   Complete source code
    
*   Environment variable documentation
    
*   Firebase schema and migrations when possible
    
*   Seed script
    
*   Local development instructions
    
*   Cloudflare deployment instructions
    
*   Cloudflare Access setup instructions
    
*   Turnstile setup instructions
    
*   Testing instructions
    
*   Backup and export instructions
    
*   .dev.vars.example
    
*   README.md
    
*   ARCHITECTURE.md
    
*   SECURITY.md
    

Never commit secrets.

Public Routes
-------------

Create:

*   /
    
*   /order
    
*   /order/confirmation/:publicToken
    
*   /about
    
*   /vendor/:sessionToken
    
*   /privacy
    
*   /terms
    

The homepage navigation should only prominently display:

*   Place an Order
    
*   About Me
    

A cart or order-summary control may appear after products are selected.

Administrative Routes
---------------------

Protect administrative routes and APIs.

Create:

*   /admin
    
*   /admin/orders
    
*   /admin/orders/:orderId
    
*   /admin/menu
    
*   /admin/availability
    
*   /admin/vendor
    
*   /admin/contacts
    
*   /admin/settings
    
*   /admin/exports
    

The public application must never receive administrative credentials, secrets, unrestricted database identifiers, or customer lists.

Visual Direction
----------------

Create a colorful, inviting, premium Mexican-inspired visual identity with a masculine edge.

Use:

*   Charcoal or near-black
    
*   Chile red
    
*   Deep agave green
    
*   Masa gold
    
*   Warm cream
    
*   Bold display typography
    
*   Clean supporting typography
    
*   Subtle textile-inspired geometry
    
*   Premium tamale imagery
    
*   Restrained food steam and texture effects
    

Avoid:

*   Generic restaurant templates
    
*   Cartoon sombreros
    
*   Cartoon cacti
    
*   Clip-art peppers
    
*   Excessive papel picado decoration
    
*   Cheap novelty styling
    
*   Overly rustic typography
    
*   Excessive gradients
    
*   Animation that delays ordering
    

The hero should place a premium tamale image or illustration front and center.

Provide strong hierarchy and generous spacing on desktop and mobile.

Animation
---------

Use purposeful animation for:

*   Hero entrance
    
*   Section reveals
    
*   Product selection
    
*   Quantity changes
    
*   Cart or summary transitions
    
*   Step changes
    
*   Confirmation state
    
*   QR overlay
    
*   Status changes in the dashboard
    

Animations must:

*   Be brief
    
*   Preserve responsiveness
    
*   Avoid layout shifts
    
*   Respect prefers-reduced-motion
    
*   Never block customer interaction
    
*   Never hide important information behind hover-only behavior
    

Customer Ordering Flow
----------------------

### Step 1: Fulfillment

Allow the customer to select an enabled fulfillment option:

*   Scheduled pickup
    
*   Event or pop-up pickup
    

Do not implement delivery in the first release, but design the domain model so it can be added later.

### Step 2: Date and Time

Allow selection from owner-configured availability windows.

Each window may contain:

*   Location
    
*   Start time
    
*   End time
    
*   Order cutoff
    
*   Capacity
    
*   Active/inactive state
    
*   Associated vendor session
    
*   Instructions
    

Unavailable windows must not be selectable.

### Step 3: Products

Display active products with:

*   Image
    
*   Name
    
*   Description
    
*   Ingredients
    
*   Spice level
    
*   Allergy notice
    
*   Availability
    
*   Package variants
    
*   Prices
    
*   Quantity controls
    

Products marked sold out should remain visible only when configured to do so and must not be orderable.

Package variants must be independently configurable.

### Step 4: Customer Information

Collect:

*   Name
    
*   Mobile number
    
*   Email
    
*   Preferred contact method
    
*   Order notes
    

Conditionally support bulk-order information:

*   Occasion
    
*   Guest count
    
*   Desired ready time
    
*   Packaging request
    
*   Additional instructions
    

Do not collect unnecessary personal information.

### Step 5: Review

Display:

*   Items
    
*   Quantities
    
*   Package sizes
    
*   Line totals
    
*   Estimated subtotal
    
*   Applicable tax or configured fees
    
*   Estimated total
    
*   Pickup location
    
*   Pickup window
    
*   Customer contact information
    
*   Confirmation policy
    
*   Payment expectation
    

All totals must be recalculated and validated on the server using current database prices.

### Step 6: Submission

On submission:

1.  Validate all input on the server.
    
2.  Verify Turnstile.
    
3.  Validate menu item availability.
    
4.  Validate package availability.
    
5.  Validate the pickup window.
    
6.  Validate cutoff and capacity rules.
    
7.  Recalculate totals.
    
8.  Apply an idempotency key.
    
9.  Create the order and order items atomically.
    
10.  Store product and price snapshots.
    
11.  Generate a human-friendly order number.
    
12.  Generate a separate non-guessable public confirmation token.
    
13.  Send customer and owner notifications through a provider adapter.
    
14.  Return a sanitized confirmation response.
    

Never expose sequential internal IDs publicly.

The default order status is new.

Order Statuses
--------------

Use:

*   new
    
*   confirmed
    
*   preparing
    
*   ready
    
*   completed
    
*   canceled
    

Enforce sensible status transitions.

Record status changes in an order event history.

Do not delete normal orders from the user interface. Cancel them or archive them to preserve business records.

Owner Dashboard
---------------

Display:

*   New requests
    
*   Confirmed orders
    
*   Orders due today
    
*   Orders requiring attention
    
*   Total product quantities due today
    
*   Estimated sales
    
*   Current availability
    
*   Active vendor session
    

The owner must be able to:

*   Search orders
    
*   Filter orders
    
*   View details
    
*   Adjust an order
    
*   Add private notes
    
*   Confirm an order
    
*   Cancel an order
    
*   Change fulfillment details
    
*   Mark preparing
    
*   Mark ready
    
*   Mark completed
    
*   Mark payment status
    
*   Contact the customer
    
*   Print an order
    
*   Export filtered orders
    

All owner-facing labels should use plain business language.

Production Summary
------------------

Provide a production-oriented report for a selected date or window.

Include:

*   Total quantity by product
    
*   Total quantity by package
    
*   Pickup sequence
    
*   Customer name
    
*   Order number
    
*   Pickup time
    
*   Special instructions
    
*   Payment status
    

Provide printable formatting and CSV export.

Menu Manager
------------

The owner must be able to:

*   Add a product
    
*   Edit a product
    
*   Upload or assign an image
    
*   Activate or deactivate a product
    
*   Mark a product sold out
    
*   Reorder products
    
*   Add package sizes
    
*   Edit package prices
    
*   Disable package sizes
    
*   Configure minimum quantities
    
*   Configure ingredients
    
*   Configure spice level
    
*   Configure allergy language
    
*   Assign availability rules
    

Use confirmation dialogs for destructive or high-impact changes.

Historical orders must retain their original product and price snapshots after menu changes.

Vendor Mode
-----------

The owner can create a vendor session with:

*   Session name
    
*   Event or location
    
*   Start and end time
    
*   Enabled products
    
*   Enabled fulfillment window
    
*   Orders enabled
    
*   Contact capture enabled
    
*   Active/inactive state
    

Create a non-guessable public session token.

Vendor Mode must provide large touch targets and support:

*   Order Here
    
*   Scan to Order
    
*   Join the Next Batch
    
*   About the Business
    

Only display enabled options.

### QR Mode

Generate a large branded QR code linking to the public order flow with the vendor session attribution attached.

Show:

*   Logo
    
*   Scan instruction
    
*   Short fallback URL
    
*   Event name
    
*   Full-screen button
    
*   Close button requiring owner action
    

The QR itself must not contain administrative credentials.

### Kiosk Ordering

The owner may allow customers to order directly on the vendor device.

After each submission:

*   Display confirmation.
    
*   Clear all form state.
    
*   Remove personal information.
    
*   Prevent navigation back into the prior order.
    
*   Return to Vendor Mode automatically after a short confirmation period.
    

After inactivity:

*   Clear incomplete personal information.
    
*   Return to the Vendor Mode home screen.
    

Require owner authentication or an exit PIN to leave kiosk mode.

### Waitlist Mode

When ordering is unavailable, allow customers to join a future-order list.

Collect:

*   Name
    
*   Phone or email
    
*   Preferred contact method
    
*   Product interest
    
*   Approximate quantity
    
*   Consent to be contacted
    

Store this as a contact submission, not an order.

Data Model
----------

Create normalized tables for:

*   business settings
    
*   menu items
    
*   menu variants
    
*   pickup locations
    
*   availability windows
    
*   orders
    
*   order items
    
*   vendor sessions
    
*   contact submissions
    
*   order events
    
*   submission idempotency keys
    

Use foreign keys and indexes.

Index fields commonly used for:

*   Order status
    
*   Created date
    
*   Fulfillment date
    
*   Customer phone
    
*   Customer email
    
*   Order number
    
*   Public token
    
*   Vendor session
    
*   Active menu items
    

Keep private notes separate from customer-visible notes.

API Design
----------

Create separate public and administrative API namespaces.

Suggested public endpoints:

*   GET /api/public/business
    
*   GET /api/public/menu
    
*   GET /api/public/availability
    
*   POST /api/public/orders
    
*   GET /api/public/orders/:publicToken
    
*   POST /api/public/contacts
    
*   GET /api/public/vendor/:sessionToken
    

Suggested administrative endpoints:

*   GET /api/admin/dashboard
    
*   GET /api/admin/orders
    
*   GET /api/admin/orders/:id
    
*   PATCH /api/admin/orders/:id
    
*   POST /api/admin/orders/:id/status
    
*   GET /api/admin/menu
    
*   POST /api/admin/menu
    
*   PATCH /api/admin/menu/:id
    
*   GET /api/admin/availability
    
*   POST /api/admin/availability
    
*   PATCH /api/admin/availability/:id
    
*   GET /api/admin/vendor-sessions
    
*   POST /api/admin/vendor-sessions
    
*   PATCH /api/admin/vendor-sessions/:id
    
*   GET /api/admin/contacts
    
*   GET /api/admin/exports/orders
    

Validate every endpoint independently.

Do not rely on disabled buttons or hidden fields for security.

Security
--------

Implement:

*   Cloudflare Access protection for admin routes
    
*   Server verification of Access identity
    
*   Turnstile verification
    
*   Server-side schema validation
    
*   Prepared database statements
    
*   Rate limiting strategy
    
*   Idempotent order submission
    
*   Secure headers
    
*   Content Security Policy
    
*   Referrer policy
    
*   Permissions policy
    
*   Same-origin API requests
    
*   Input length limits
    
*   Enumeration-resistant public tokens
    
*   No card storage
    
*   No secrets in client bundles
    
*   Sanitized error responses
    
*   Structured server logging without unnecessary personal information
    

Never trust:

*   Client prices
    
*   Client totals
    
*   Client tax values
    
*   Client availability
    
*   Client order status
    
*   Client administrative flags
    

Privacy
-------

Collect only information required to fulfill an order.

Provide configurable retention guidance for:

*   Completed orders
    
*   Canceled orders
    
*   Contact submissions
    
*   Application logs
    

Do not expose customer data through analytics scripts or public APIs.

Accessibility
-------------

Meet WCAG AA expectations.

Require:

*   Semantic HTML
    
*   Keyboard navigation
    
*   Visible focus states
    
*   Proper labels
    
*   Dialog focus trapping
    
*   Screen-reader status announcements
    
*   Sufficient contrast
    
*   Touch targets of appropriate size
    
*   Reduced-motion support
    
*   No color-only status indicators
    
*   Accessible error summaries
    

Responsive Requirements
-----------------------

Explicitly test:

*   320px width
    
*   360px width
    
*   390px width
    
*   Tablet portrait
    
*   Tablet landscape
    
*   Standard laptop
    
*   Wide desktop
    

There must be:

*   No horizontal scrolling
    
*   No clipped dialog content
    
*   No inaccessible sticky elements
    
*   No hover-only functionality
    
*   No tiny quantity controls
    
*   No dashboard tables that become unusable on mobile
    

Convert dense dashboard tables into mobile cards where appropriate.

Testing
-------

Add tests for:

*   Price calculations
    
*   Package quantities
    
*   Sold-out products
    
*   Disabled variants
    
*   Cutoff times
    
*   Capacity limits
    
*   Invalid availability windows
    
*   Duplicate submissions
    
*   Status transitions
    
*   Public token access
    
*   Administrative authorization
    
*   Vendor session expiration
    
*   Kiosk reset behavior
    
*   Contact submissions
    
*   CSV exports
    

Add end-to-end tests for:

1.  Customer places an order.
    
2.  Owner confirms the order.
    
3.  Customer views confirmation.
    
4.  Owner starts Vendor Mode.
    
5.  Customer scans or opens the vendor link.
    
6.  Customer places a vendor-attributed order.
    
7.  Sold-out customer joins the waitlist.
    
8.  Kiosk resets without exposing previous customer information.
    

Implementation Sequence
-----------------------

Work in this order:

1.  Repository foundation and documentation
    
2.  Design tokens and shared components
    
3.  D1 schema and migrations
    
4.  Public menu API
    
5.  Customer ordering flow
    
6.  Server-side order submission
    
7.  Confirmation page
    
8.  Cloudflare Access integration
    
9.  Owner order dashboard
    
10.  Menu manager
    
11.  Availability manager
    
12.  Vendor sessions
    
13.  QR mode
    
14.  Kiosk mode
    
15.  Waitlist/contact mode
    
16.  Notifications
    
17.  Exports and production summaries
    
18.  Accessibility review
    
19.  Security review
    
20.  End-to-end testing
    
21.  Deployment documentation
    

At the end of each phase:

*   Run type checking.
    
*   Run linting.
    
*   Run relevant tests.
    
*   Document new environment variables.
    
*   Document schema changes.
    
*   Verify responsive behavior.
    
*   Do not leave broken placeholder routes.
    

Non-Goals for Version One
-------------------------

Do not implement:

*   Customer accounts
    
*   Loyalty points
    
*   Delivery-driver management
    
*   Marketplace functionality
    
*   Custom card collection
    
*   Subscription billing
    
*   Complex inventory deduction
    
*   Offline order synchronization
    
*   Multi-tenant client administration
    
*   Multiple staff permission levels
    
*   Native mobile applications
    

Design clean extension points for future functionality without building those features now.

Definition of Done
------------------

The project is complete when:

*   A customer can submit a valid order request on mobile or desktop.
    
*   The server independently verifies the order and total.
    
*   The owner can review and manage the order.
    
*   Menu products and prices can be changed without code edits.
    
*   Availability can be managed without code edits.
    
*   Vendor Mode works on a phone and tablet.
    
*   The QR code attributes orders to a vendor session.
    
*   Kiosk mode clears customer information safely.
    
*   Sold-out visitors can join the next-order list.
    
*   Administrative paths are protected.
    
*   Public forms are abuse protected.
    
*   The repository can deploy to Cloudflare Pages.
    
*   A new developer can configure the project using the documentation.
    
*   No secret, card data, or unrestricted customer data reaches the public client.