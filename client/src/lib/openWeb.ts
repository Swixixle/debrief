/** When true, the web app calls the API without a user-supplied key (server must set `DEBRIEF_OPEN_WEB=1`). */
export const isOpenWeb = import.meta.env.VITE_DEBRIEF_OPEN_WEB === "true";
