import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Boodschappen",
    short_name: "Boodschappen",
    description: "De gedeelde boodschappenlijst en het weekmenu voor iedereen in huis.",
    lang: "nl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F3F6F0",
    theme_color: "#F3F6F0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
