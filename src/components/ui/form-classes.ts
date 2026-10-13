/**
 * Form styles of the closed-pages design (fields 40 px, radius 10 px, line
 * colour, 2 px brand focus; label above the field). Plain class strings so
 * server components can use them; the colours are the names from
 * src/app/globals.css, never a Tailwind palette.
 */
export const LABEL = "mb-1.5 block text-[13.5px] font-medium text-heading";

export const FIELD =
  "h-10 w-full rounded-md border border-line bg-card px-3 text-[15px] text-heading outline-offset-1 focus:outline-2 focus:outline-brand";

export const TEXTAREA =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[15px] text-heading outline-offset-1 focus:outline-2 focus:outline-brand";

export const SELECT = FIELD;

/** Button that deletes or revokes: white with the error colour, never a filled red block. */
export const DANGER_BUTTON = "by-app-btn by-app-btn-secondary text-err!";
