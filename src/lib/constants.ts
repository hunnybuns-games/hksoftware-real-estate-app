export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4 MB per photo
export const MAX_PHOTOS_PER_REQUEST = 5;

// A listing benefits from more photos than a maintenance ticket does — this is
// what gets copy-pasted into Zillow/Realtor.com/etc.
export const MAX_LISTING_PHOTOS = 12;

// Document vault (src/lib/document-storage.ts). Far larger than
// MAX_PHOTO_BYTES because these are scanned leases and inspection reports,
// not thumbnails — a 30-page scan at 300dpi lands in the tens of megabytes.
// The ceiling that actually matters is the Cloudflare Workers request-body
// size: 100 MB on Free and Pro, 200 MB on Business. Staying well under the
// lower of those keeps this limit valid on every plan.
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB per file

// One drop can carry a whole folder of paperwork, but every file in a batch
// is read into memory to hash and store it, so the batch total needs bounding
// too — not just the file count.
export const MAX_DOCUMENTS_PER_UPLOAD = 20;
export const MAX_DOCUMENT_BATCH_BYTES = 60 * 1024 * 1024; // 60 MB per drop

export const MAX_IMPORT_CSV_BYTES = 3 * 1024 * 1024; // 3 MB — statements are text, this is generous
export const MAX_IMPORT_ROWS = 2000;
export const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

// A drawn signature is a small canvas doodle, not a photo — this caps it well
// under MAX_PHOTO_BYTES while leaving plenty of room for a high-DPI capture.
export const MAX_SIGNATURE_IMAGE_BYTES = 300 * 1024; // 300 KB

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;
