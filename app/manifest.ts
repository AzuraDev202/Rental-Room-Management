import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HH HOME · Quản lý phòng trọ",
    short_name: "HH HOME",
    description: "Quản lý căn hộ, người thuê, hóa đơn và thu tiền",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "vi",
    background_color: "#f7f8f4",
    theme_color: "#245e4c",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
