// Mirrors FREE_TEXT_MAX in backend/app/services/application_service.py and the
// varchar(255) columns on `applications`. These are free-text fields ("18 LPA",
// "2 months, negotiable"), so the cap only exists to match the column width —
// exceeding it used to fail the whole insert in Postgres and surface as a 500.
export const FREE_TEXT_MAX = 255;

/** Trim a value coming from resume parsing to what the column can hold.
    `maxLength` on an input only limits typing, not values set in code. */
export const capFreeText = (value) =>
  typeof value === 'string' && value.length > FREE_TEXT_MAX
    ? value.slice(0, FREE_TEXT_MAX)
    : value;
