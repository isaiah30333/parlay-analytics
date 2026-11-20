/* =====================================================================
   SITE CONFIG — same template as isaiah30333.github.io.
   site.js reads this to build the header, footer, colors and fonts.
   ===================================================================== */
window.SITE = {
  name: "Parlay Analytics",
  tagline: "Every leg, one screen",
  monogram: "PA",

  email: "",
  linkedin: "",

  nav: [
    { label: "Parlay",     href: "index.html" },
    { label: "Dashboards", href: "dashboards.html" }
  ],
  headerCta: null,

  theme: {
    accent: "#8A6A1F",          // bronze
    accentDark: "#E0C27A",      // light gold in dark mode
    radius: "12px",
    defaultMode: "system"
  },
  heroImage: "assets/img/denver-skyline.jpg",
  heroCredit: { text: "Photo: Ryan De Hamer / Unsplash", url: "https://unsplash.com/photos/A4RpHR83luM" },

  fonts: { heading: "Inter Tight", body: "Inter", mono: "JetBrains Mono" },

  tickerTape: [],

  footerNote: "For tracking only. Not affiliated with any sportsbook."
};
