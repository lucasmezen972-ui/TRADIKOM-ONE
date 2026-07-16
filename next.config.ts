import type { NextConfig } from "next";
import { validateEnvironment } from "./src/lib/environment";

validateEnvironment(process.env);

const noStoreRoutes = [
  "/mot-de-passe-oublie/:path*",
  "/reinitialiser-mot-de-passe/:path*",
  "/invitation/:path*",
  "/api/webhooks/:path*",
];

export function getGlobalSecurityHeaders(
  nodeEnvironment = process.env.NODE_ENV,
  appUrl = process.env.APP_URL,
) {
  const isHttpsOrigin = (() => {
    try {
      return appUrl ? new URL(appUrl).protocol === "https:" : false;
    } catch {
      return false;
    }
  })();

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    {
      key: "Content-Security-Policy",
      value:
        `default-src 'self'; script-src 'self' 'unsafe-inline'${nodeEnvironment === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
    },
    ...(nodeEnvironment === "production" && isHttpsOrigin
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
  ];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    return [
      ...noStoreRoutes.map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      })),
      {
        source: "/:path*",
        headers: getGlobalSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
