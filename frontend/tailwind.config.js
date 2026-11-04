/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        nx: {
          workspace: "#e8eff3",
          panel: "#f8fafb",
          raised: "#ffffff",
          line: "#ccd9df",
          ink: "#142f40",
          body: "#355160",
          muted: "#5d7380",
          accent: "#0b7465",
          accentdim: "#085c51",
          ok: "#0b7465",
          warn: "#886019",
          bad: "#a63d36",
          badink: "#912f2a",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
