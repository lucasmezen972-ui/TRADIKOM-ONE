import type { Website, WebsiteSection } from "@/lib/types";

type SiteRendererProps = {
  website: Website;
  sections: WebsiteSection[];
  formAction?: (formData: FormData) => void | Promise<void>;
  preview?: boolean;
};

export function SiteRenderer({
  website,
  sections,
  formAction,
  preview = false,
}: SiteRendererProps) {
  const style = {
    "--site-primary": website.theme.primary,
    "--site-accent": website.theme.accent,
    "--site-bg": website.theme.background,
    "--site-text": website.theme.text,
    "--site-radius": website.theme.radius,
  } as React.CSSProperties;

  return (
    <div style={style} className="bg-[var(--site-bg)] text-[var(--site-text)]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <strong className="text-sm uppercase tracking-[0.18em] text-[var(--site-primary)]">
          {website.name.replace(/^Site\s+/i, "")}
        </strong>
        <a
          href="#contact"
          className="rounded-[var(--site-radius)] bg-[var(--site-primary)] px-4 py-2 text-sm font-semibold text-white"
        >
          Contact
        </a>
      </nav>

      {sections.map((section) => {
        if (!section.enabled) {
          return null;
        }

        switch (section.type) {
          case "hero":
            return <HeroSection key={section.id} section={section} />;
          case "services":
          case "benefits":
            return <ListSection key={section.id} section={section} />;
          case "faq":
            return <FaqSection key={section.id} section={section} />;
          case "contact":
            return (
              <ContactSection
                key={section.id}
                section={section}
                action={formAction}
                preview={preview}
              />
            );
          case "footer":
            return <FooterSection key={section.id} section={section} />;
          default:
            return <TextSection key={section.id} section={section} />;
        }
      })}
    </div>
  );
}

function HeroSection({ section }: { section: WebsiteSection }) {
  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-14 pt-8 md:grid-cols-[1.08fr_0.92fr] md:items-center">
      <div className="max-w-2xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--site-accent)]">
          {String(section.data.eyebrow ?? "Entreprise locale")}
        </p>
        <h1 className="text-4xl font-bold leading-tight text-[var(--site-primary)] md:text-6xl">
          {section.title}
        </h1>
        <p className="mt-5 text-lg leading-8 text-slate-700">{section.body}</p>
        {section.buttonLabel ? (
          <a
            href={section.buttonHref ?? "#contact"}
            className="mt-7 inline-flex rounded-[var(--site-radius)] bg-[var(--site-accent)] px-5 py-3 font-semibold text-slate-950"
          >
            {section.buttonLabel}
          </a>
        ) : null}
      </div>
      {section.imageUrl ? (
        <img
          src={section.imageUrl}
          alt=""
          className="aspect-[4/3] w-full rounded-[var(--site-radius)] object-cover shadow-2xl"
        />
      ) : null}
    </section>
  );
}

function TextSection({ section }: { section: WebsiteSection }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <div className="max-w-3xl">
        <h2 className="text-2xl font-bold text-[var(--site-primary)]">
          {section.title}
        </h2>
        <p className="mt-3 leading-7 text-slate-700">{section.body}</p>
      </div>
    </section>
  );
}

function ListSection({ section }: { section: WebsiteSection }) {
  const items = Array.isArray(section.data.items)
    ? (section.data.items as string[])
    : [];

  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <h2 className="text-2xl font-bold text-[var(--site-primary)]">
        {section.title}
      </h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-700">{section.body}</p>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-[var(--site-radius)] border border-slate-200 bg-white/85 p-5 shadow-sm"
          >
            <strong>{item}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function FaqSection({ section }: { section: WebsiteSection }) {
  const items = Array.isArray(section.data.items)
    ? (section.data.items as Array<{ question: string; answer: string }>)
    : [];

  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <h2 className="text-2xl font-bold text-[var(--site-primary)]">
        {section.title}
      </h2>
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <details
            key={item.question}
            className="rounded-[var(--site-radius)] border border-slate-200 bg-white/85 p-4"
          >
            <summary className="font-semibold">{item.question}</summary>
            <p className="mt-2 leading-7 text-slate-700">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ContactSection({
  section,
  action,
  preview,
}: {
  section: WebsiteSection;
  action?: (formData: FormData) => void | Promise<void>;
  preview: boolean;
}) {
  return (
    <section id="contact" className="mx-auto max-w-6xl px-5 py-12">
      <div className="grid gap-8 rounded-[var(--site-radius)] bg-[var(--site-primary)] p-6 text-white md:grid-cols-[0.9fr_1.1fr] md:p-8">
        <div>
          <h2 className="text-3xl font-bold">{section.title}</h2>
          <p className="mt-3 leading-7 text-white/80">{section.body}</p>
          <p className="mt-5 text-sm text-white/70">
            {String(section.data.phone ?? "")}
          </p>
        </div>
        <form action={action} className="grid gap-3">
          <input type="hidden" name="preview" value={preview ? "1" : "0"} />
          <input
            required
            name="name"
            placeholder="Votre nom"
            className="rounded-[var(--site-radius)] border border-white/15 bg-white px-4 py-3 text-slate-950"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              type="email"
              name="email"
              placeholder="Email"
              className="rounded-[var(--site-radius)] border border-white/15 bg-white px-4 py-3 text-slate-950"
            />
            <input
              required
              name="phone"
              placeholder="Telephone"
              className="rounded-[var(--site-radius)] border border-white/15 bg-white px-4 py-3 text-slate-950"
            />
          </div>
          <textarea
            required
            name="message"
            placeholder="Votre demande"
            rows={4}
            className="rounded-[var(--site-radius)] border border-white/15 bg-white px-4 py-3 text-slate-950"
          />
          <button
            disabled={preview}
            className="rounded-[var(--site-radius)] bg-[var(--site-accent)] px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {section.buttonLabel ?? "Envoyer"}
          </button>
        </form>
      </div>
    </section>
  );
}

function FooterSection({ section }: { section: WebsiteSection }) {
  return (
    <footer className="mt-10 border-t border-slate-200 px-5 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
        <strong className="text-[var(--site-primary)]">{section.title}</strong>
        <span>{section.body}</span>
      </div>
    </footer>
  );
}
