export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4 MB per photo
export const MAX_PHOTOS_PER_REQUEST = 5;

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
