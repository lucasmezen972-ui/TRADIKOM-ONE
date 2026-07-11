import Link from "next/link";

export default async function ThanksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="grid min-h-screen place-items-center bg-[#fffaf1] px-5 text-slate-950">
      <div className="max-w-xl rounded-lg bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Demande envoyee</h1>
        <p className="mt-3 leading-7 text-slate-600">
          Merci, votre message a bien ete transmis. L&apos;entreprise revient vers
          vous rapidement.
        </p>
        <Link
          href={`/sites/${slug}`}
          className="mt-6 inline-flex rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white"
        >
          Retour au site
        </Link>
      </div>
    </main>
  );
}
