import { describe, expect, it, vi } from "vitest";
import {
  CapabilityProviderFailure,
  compensateGenericCapability,
  executeGenericCapability,
  os3MockCapabilityManifest,
  strictMockCapabilityProvider,
  type CapabilityProvider,
} from "../src/modules/connector-execution";

describe("runtime de capacités OS-3", () => {
  it("publie deux capacités génériques dans un manifeste mock versionné", () => {
    expect(os3MockCapabilityManifest).toMatchObject({
      schemaVersion: 1,
      providerKey: "tradikom_mock",
      providerVersion: "1.0.0",
      environment: "mock",
      status: "mock",
      auth: "none",
    });
    expect(
      os3MockCapabilityManifest.capabilities.map((capability) => ({
        name: capability.name,
        mode: capability.mode,
        approval: capability.approval,
        idempotency: capability.idempotency,
        compensation: capability.compensation,
      })),
    ).toEqual([
      {
        name: "crm.contacts.search",
        mode: "read",
        approval: "none",
        idempotency: "required",
        compensation: null,
      },
      {
        name: "project.task.create",
        mode: "write",
        approval: "single",
        idempotency: "required",
        compensation: "project.task.archive",
      },
    ]);
  });

  it("exécute les deux capacités sans réseau avec une preuve déterministe", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun transport externe attendu."));
    const search = await executeGenericCapability({
      tenantId: "tenant_runtime",
      capability: "crm.contacts.search",
      environment: "mock",
      input: { query: "contact de démonstration" },
      idempotencyKey: "runtime-search-0001",
    });
    const taskInput = {
      tenantId: "tenant_runtime",
      capability: "project.task.create",
      environment: "mock" as const,
      input: { title: "Relancer le contact" },
      idempotencyKey: "runtime-task-0001",
    };
    const task = await executeGenericCapability(taskInput);
    const replay = await executeGenericCapability(taskInput);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(search).toMatchObject({
      capability: "crm.contacts.search",
      providerKey: "tradikom_mock",
      environment: "mock",
      output: { matchCount: 1 },
      evidence: { code: "mock_contact_matches", externalSideEffect: false },
    });
    expect(task).toMatchObject({
      capability: "project.task.create",
      output: { taskReference: expect.stringMatching(/^tache_mock_[a-f0-9]{24}$/) },
      evidence: { code: "mock_task_prepared", inputStored: false },
      compensation: {
        available: true,
        capability: "project.task.archive",
      },
    });
    expect(replay.output).toEqual(task.output);
  });

  it("retente une erreur temporaire et arrête une erreur permanente", async () => {
    const temporaryExecute = vi
      .fn<CapabilityProvider["execute"]>()
      .mockRejectedValueOnce(
        new CapabilityProviderFailure("temporary", "indisponible"),
      )
      .mockImplementation((input) => strictMockCapabilityProvider.execute(input));
    const recovered = await executeGenericCapability(
      {
        tenantId: "tenant_retry",
        capability: "crm.contacts.search",
        environment: "mock",
        input: { query: "contact" },
        idempotencyKey: "runtime-retry-0001",
        maxAttempts: 3,
      },
      { ...strictMockCapabilityProvider, execute: temporaryExecute },
    );
    expect(recovered.attempts).toBe(2);
    expect(temporaryExecute).toHaveBeenCalledTimes(2);

    const permanentExecute = vi
      .fn<CapabilityProvider["execute"]>()
      .mockRejectedValue(
        new CapabilityProviderFailure("permanent", "refus définitif"),
      );
    await expect(
      executeGenericCapability(
        {
          tenantId: "tenant_retry",
          capability: "crm.contacts.search",
          environment: "mock",
          input: { query: "contact" },
          idempotencyKey: "runtime-permanent-0001",
        },
        { ...strictMockCapabilityProvider, execute: permanentExecute },
      ),
    ).rejects.toMatchObject({
      classification: "permanent",
      retryable: false,
      attempts: 1,
    });
    expect(permanentExecute).toHaveBeenCalledTimes(1);
  });

  it("refuse les entrées invalides, environnements réels et providers désactivés", async () => {
    await expect(
      executeGenericCapability({
        tenantId: "tenant_policy",
        capability: "crm.contacts.search",
        environment: "mock",
        input: { query: "" },
        idempotencyKey: "runtime-invalid-0001",
      }),
    ).rejects.toMatchObject({ classification: "validation", retryable: false });
    await expect(
      executeGenericCapability({
        tenantId: "tenant_policy",
        capability: "crm.contacts.search",
        environment: "production",
        input: { query: "contact" },
        idempotencyKey: "runtime-production-0001",
      }),
    ).rejects.toMatchObject({ classification: "policy", retryable: false });
    await expect(
      executeGenericCapability(
        {
          tenantId: "tenant_policy",
          capability: "crm.contacts.search",
          environment: "mock",
          input: { query: "contact" },
          idempotencyKey: "runtime-disabled-0001",
        },
        { ...strictMockCapabilityProvider, status: "disabled" },
      ),
    ).rejects.toMatchObject({
      classification: "not_configured",
      retryable: false,
    });
  });

  it("compense la création mock sans produire d'effet externe", async () => {
    const execution = await executeGenericCapability({
      tenantId: "tenant_compensation",
      capability: "project.task.create",
      environment: "mock",
      input: { title: "Tâche compensable" },
      idempotencyKey: "runtime-compensation-0001",
    });
    const output = execution.output as { taskReference: string };
    await expect(
      compensateGenericCapability({
        tenantId: "tenant_compensation",
        capability: execution.capability,
        environment: "mock",
        idempotencyKey: "runtime-compensation-0001:archive",
        output,
      }),
    ).resolves.toMatchObject({
      status: "compensated",
      compensationCapability: "project.task.archive",
      environment: "mock",
      externalSideEffect: false,
      result: { archivedReference: output.taskReference },
    });
  });
});
