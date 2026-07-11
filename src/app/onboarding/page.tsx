import { redirect } from "next/navigation";
import { saveOnboardingAction } from "@/app/actions";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { tenant } = await requireTenantContext();

  if (!tenant) {
    redirect("/creer-organisation");
  }

  return (
    <main className="min-h-screen bg-[#08111f] px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm uppercase tracking-[0.16em] text-[#19c6b7]">
          Business Twin
        </p>
        <h1 className="mt-2 text-4xl font-bold">
          Construire le profil vivant de {tenant.name}
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-white/70">
          Ces informations alimentent le site, le CRM, les relances et les
          futures connexions metier.
        </p>

        <form
          action={saveOnboardingAction}
          className="mt-8 grid gap-5 rounded-lg bg-[#fffaf1] p-6 text-slate-950 shadow-2xl"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="companyName" label="Nom commercial" defaultValue={tenant.name} />
            <Field name="category" label="Categorie" defaultValue={tenant.category} />
          </div>
          <TextArea
            name="description"
            label="Description"
            defaultValue="Garage independant au Lamentin specialise dans l'entretien, le diagnostic et les reparations du quotidien."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextArea
              name="services"
              label="Produits et services"
              defaultValue="entretien automobile, diagnostic, climatisation, freinage, vidange"
            />
            <TextArea
              name="products"
              label="Offres ou produits"
              defaultValue="forfaits entretien, controles avant depart, devis reparation"
            />
          </div>
          <Field
            name="targetCustomers"
            label="Clients cibles"
            defaultValue="automobilistes de Martinique, familles, professionnels avec vehicules legers"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              name="address"
              label="Adresse"
              defaultValue="Zone de Californie, Le Lamentin, Martinique"
            />
            <Field
              name="serviceAreas"
              label="Zones desservies"
              defaultValue="Le Lamentin, Fort-de-France, Ducos, Schoelcher"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="phone" label="Telephone" defaultValue="+596 596 00 00 00" />
            <Field
              name="email"
              label="Email"
              defaultValue="contact@garage-caraibes-auto.example"
            />
          </div>
          <Field
            name="openingHours"
            label="Horaires"
            defaultValue="Lundi au vendredi 7h30-17h30, samedi matin sur rendez-vous"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              name="desiredCallsToAction"
              label="Appels a l'action"
              defaultValue="Demander un devis, Prendre rendez-vous"
            />
            <Field name="tone" label="Ton de marque" defaultValue="fiable, clair et rassurant" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field name="colors" label="Couleurs" defaultValue="#08111f, #19c6b7, #fffaf1" />
            <Field name="existingWebsite" label="Site existant" defaultValue="" required={false} />
            <Field
              name="socialLinks"
              label="Liens sociaux"
              defaultValue="https://facebook.example/garage-caraibes-auto"
              required={false}
            />
          </div>
          <Field
            name="photos"
            label="Photos"
            defaultValue="https://images.unsplash.com/photo-1486006920555-c77dcf18193c?auto=format&fit=crop&w=1400&q=80"
            required={false}
          />
          <Field
            name="mainObjective"
            label="Objectif commercial principal"
            defaultValue="Recevoir plus de demandes de devis qualifiees"
          />
          <TextArea
            name="faqs"
            label="Questions frequentes"
            defaultValue={"Puis-je demander un devis en ligne ? | Oui, decrivez votre besoin et nous vous recontactons rapidement.\nFaites-vous le diagnostic climatisation ? | Oui, nous controlons le circuit et proposons une intervention adaptee."}
          />
          <label className="grid gap-2">
            <span className="font-semibold">Modele de site</span>
            <select
              name="templateKey"
              defaultValue="artisan"
              className="rounded-md border border-slate-200 px-4 py-3"
            >
              <option value="artisan">Artisan / services</option>
              <option value="restaurant">Restaurant / hospitalite</option>
              <option value="beauty">Beaute / rendez-vous</option>
            </select>
          </label>
          <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
            Generer le Business Twin et le site
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required = true,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2">
      <span className="font-semibold">{label}</span>
      <input
        required={required}
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-slate-200 px-4 py-3"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="font-semibold">{label}</span>
      <textarea
        required
        name={name}
        defaultValue={defaultValue}
        rows={3}
        className="rounded-md border border-slate-200 px-4 py-3"
      />
    </label>
  );
}
