# Vendors

A landlord's own directory of contractors, and a way to note which one is
handling a given maintenance request. This is the framework piece — see
"What's deliberately not here" before assuming it does more than it does.

## What it is

- `/app/maintenance/vendors` — list, add, edit. Each vendor has a name,
  an optional free-text trade ("Plumbing", "HVAC" — no fixed list, since a
  real vendor often covers more than one), contact name, email, phone, and
  internal notes (license/insurance info, service area, whatever's worth
  remembering).
- On a maintenance request's detail page, a "Vendor" card lets staff assign
  or clear one from a dropdown. Changing it writes an internal note to the
  request's activity log ("Assigned to Riverside Plumbing.") the same way a
  status change does, so the audit trail reads the same way regardless of
  which changed.
- Archiving a vendor (`active: false`) is a soft delete — they drop out of
  the assignment dropdown for *new* picks, but any request that already
  named them keeps showing it. `MaintenanceRequest.assignedVendorId` is
  `onDelete: SetNull` on the Vendor relation, and there is no hard-delete
  action in the UI at all, so "who fixed this" never silently disappears
  from history.

## What's deliberately not here

- **Still no login or portal — but assigning one now emails them.** A vendor
  with an email on file gets a plain FYI (`notifyVendorAssigned`) with the
  job details and who to contact back — no link into the app, since nothing
  on the other end would let them in. That's still a note plus an email, not
  a work-order system: no read receipt, no accept/decline, no status the
  vendor can update themselves. A vendor with no email on file gets nothing;
  staff still calls or texts them, same as before. Closing the rest of the
  gap with a tool like Innago (a vendor accepting/declining, updating status,
  seeing their own job list) is a real vendor-facing surface this app doesn't
  have — a bigger build than one notification.
- **No scheduling.** There's no appointment/date field, no calendar. "When"
  lives in the request's free-text notes for now, same as before vendors
  existed.
- **No cost tracking.** Nothing here touches `Expense` — a vendor's invoice
  is still a manual expense entry, unconnected to the request or the vendor
  record. Linking them (`Expense.vendorId`, a rollup of "spent with this
  vendor this year") is a natural next step once this framework is actually
  in use.
- **Trade is a free-text field, not an enum.** Picked deliberately — a rigid
  list of trades fights any vendor who covers more than one, and filtering
  by trade wasn't asked for yet. Add a `trade` filter on the list page if
  the directory grows past a size where scrolling is fine.

## Access

Vendor management sits at the same access level as maintenance itself —
any staff member, not admin-only (`assertStaff`, not `assertAdmin`). A
landlord coordinating with a plumber is day-to-day work, not an
organization-settings change.
