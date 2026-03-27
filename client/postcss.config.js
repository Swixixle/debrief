import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite is started from repo root (script/build.ts); Tailwind otherwise resolves
// config from cwd and misses client/tailwind.config.ts → empty content + @apply errors.
export default {
  plugins: {
    tailwindcss: {
      config: path.join(__dirname, "tailwind.config.ts"),
    },
    autoprefixer: {},
  },
};
