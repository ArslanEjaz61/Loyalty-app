import "./globals.css";
import ServiceWorker from "./ServiceWorker.js";

export const metadata = {
  title: "Loyalty Club",
  description: "Collect points and rewards at every branch.",
  manifest: "/loyalty/manifest.json",
  // iOS ignores the manifest for the home-screen icon and uses this instead.
  icons: {
    icon: "/loyalty/icon-192",
    apple: "/loyalty/icon-192",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Loyalty Club" },
};

export const viewport = {
  themeColor: "#C0392B",
  width: "device-width",
  initialScale: 1,
  // The card is a fixed layout; letting it zoom only breaks the QR framing.
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
