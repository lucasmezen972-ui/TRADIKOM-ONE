import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContactDetailPage from "../src/app/(app)/contacts/[contactId]/page";

const mocks = vi.hoisted(() => ({
  getContactDetail: vi.fn(),
  getTenantMembers: vi.fn(),
  requireTenantContext: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  addContactNoteAction: vi.fn(),
  completeContactTaskAction: vi.fn(),
  createContactTaskAction: vi.fn(),
  updateContactAction: vi.fn(),
  updateContactConsentAction: vi.fn(),
}));
vi.mock("@/lib/services", () => ({ getServices: async () => mocks }));
vi.mock("@/lib/session", () => ({
  requireTenantContext: mocks.requireTenantContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenantContext.mockResolvedValue({
    user: { id: "user_fixture" },
    tenant: { id: "tenant_fixture", name: "Entreprise fictive" },
  });
  mocks.getTenantMembers.mockResolvedValue([]);
});

async function renderStatusSelect(status: string) {
  mocks.getContactDetail.mockResolvedValue({
    contact: {
      id: "contact_fixture",
      name: "Contact fictif",
      email: "render-status@example.test",
      phone: "",
      status,
      tags: ["suivi"],
      assignedUserId: null,
    },
    notes: [], consent: null, tasks: [], activities: [], opportunities: [],
  });
  const page = await ContactDetailPage({
    params: Promise.resolve({ contactId: "contact_fixture" }),
  });
  const html = renderToStaticMarkup(page);
  const select = html.match(/<select name="status"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  expect(select).toBeDefined();
  expect(mocks.getContactDetail).toHaveBeenCalledWith(
    "user_fixture", "tenant_fixture", "contact_fixture",
  );
  return select!;
}

describe("contact detail status rendering", () => {
  it("keeps the imported status selected when editing another profile field", async () => {
    const select = await renderStatusSelect("Importé");
    expect(select).toContain('<option value="Importé" selected="">Importé</option>');
    expect(select.match(/ selected=""/g)).toHaveLength(1);
    expect(select).not.toContain('<option value="Nouveau" selected="">');
  });

  it("preserves only the current stored CSV status beside the standard choices", async () => {
    const select = await renderStatusSelect("Client historique");
    expect(select).toContain('<option value="Client historique" selected="">Client historique</option>');
    expect(select.match(/<option /g)).toHaveLength(7);
    expect(select).not.toContain('value="Importé"');
  });

  it("does not duplicate a standard current status or add unrelated statuses", async () => {
    const select = await renderStatusSelect("A qualifier");
    expect(select.match(/value="A qualifier"/g)).toHaveLength(1);
    expect(select).toContain('<option value="A qualifier" selected="">A qualifier</option>');
    expect(select.match(/<option /g)).toHaveLength(6);
    expect(select).not.toContain('value="Importé"');
  });

  it("escapes a stored status instead of rendering active markup", async () => {
    const select = await renderStatusSelect('<img src=x onerror="alert(1)">');
    expect(select).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(select).not.toContain("<img");
    expect(select.match(/ selected=""/g)).toHaveLength(1);
  });
});
