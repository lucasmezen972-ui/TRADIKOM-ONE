import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import { getTenantIdFromCookie } from "@/lib/security";
import { getCurrentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Sert une image publiée, ou un aperçu privé au membre de son organisation.
 * L'identifiant est un UUID non devinable et
 * le chemin de stockage n'est jamais construit à partir de l'URL : la ligne en
 * base fait foi. La réponse ne révèle ni l'organisation propriétaire ni la clé
 * de stockage.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const services = await getServices();
  let asset = await services.readPublicAsset(assetId);
  let isPublic = Boolean(asset);

  if (!asset) {
    try {
      const session = await getCurrentSession();
      if (session) {
        const tenantContext = await services.getTenantContext(
          session.user.id,
          await getTenantIdFromCookie(),
        );
        if (tenantContext) {
          asset = await services.readTenantAsset(
            session.user.id,
            tenantContext.tenant.id,
            assetId,
          );
        }
      }
    } catch {
      // A private identifier or storage error must not disclose its owner.
      asset = null;
    }
    isPublic = false;
  }

  if (!asset) {
    return new NextResponse("Fichier introuvable.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        vary: "Cookie",
      },
    });
  }

  return new NextResponse(Buffer.from(asset.bytes), {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "content-length": String(asset.byteSize),
      // Publication membership can change even though stored bytes are immutable.
      "cache-control": isPublic
        ? "public, max-age=0, must-revalidate"
        : "private, no-store, max-age=0",
      ...(isPublic ? {} : { vary: "Cookie" }),
      etag: `"${asset.checksum}"`,
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
