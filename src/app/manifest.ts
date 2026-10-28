import type { MetadataRoute } from "next";

/** Lets people install Masar on iPhone, Android and desktop as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Masar · مسار",
    short_name: "Masar",
    description: "Find the decision makers your next conversation depends on.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF8F3",
    theme_color: "#101A1B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
