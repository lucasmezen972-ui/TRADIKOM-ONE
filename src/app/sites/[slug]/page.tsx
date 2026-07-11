import { notFound } from "next/navigation";
import { submitSiteLeadAction } from "@/app/actions";
import { SiteRenderer } from "@/components/site-renderer";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function PublicSitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const services = await getServices();
  const site = await services.getPublishedSite(slug);

  if (!site) {
    notFound();
  }

  const action = submitSiteLeadAction.bind(null, slug);

  return (
    <main>
      <SiteRenderer
        website={site.website}
        sections={site.sections}
        formAction={action}
      />
    </main>
  );
}
