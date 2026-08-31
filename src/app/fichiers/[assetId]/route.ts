import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Sert une image d'un site publié. L'identifiant est un UUID non devinable et
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
  const asset = await services.readPublicAsset(assetId);

  if (!asset) {
    return new NextResponse("Fichier introuvable.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(Buffer.from(asset.bytes), {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "content-length": String(asset.byteSize),
      // Le contenu d'un identifiant donné est immuable : il n'est jamais
      // réécrit, un nouvel envoi crée un nouvel identifiant.
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${asset.checksum}"`,
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
