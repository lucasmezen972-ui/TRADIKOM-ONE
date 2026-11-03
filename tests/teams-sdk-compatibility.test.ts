import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { ServiceTokenValidator } from "@microsoft/teams.apps/dist/middleware";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resolve MSAL from Teams itself: a scoped pnpm override must change the SDK's
// dependency, rather than adding an unrelated MSAL copy beside the application.
const requireFromTest = createRequire(import.meta.url);
const requireFromTeams = createRequire(
  requireFromTest.resolve("@microsoft/teams.apps"),
);
const teamsVersion: string = requireFromTeams(
  "@microsoft/teams.apps/package.json",
).version;
const msalVersion: string = requireFromTeams("@azure/msal-node/package.json").version;

type TokenResult = {
  accessToken: string;
  fromCache: boolean;
  scopes: string[];
};
type NetworkOptions = { body?: string };
type FixtureNetworkClient = {
  sendGetRequestAsync(url: string): Promise<never>;
  sendPostRequestAsync(url: string, options?: NetworkOptions): Promise<{
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }>;
};
type ConfidentialClientConfiguration = {
  auth: {
    clientId: string;
    clientSecret?: string;
    clientAssertion?: () => Promise<string>;
    authority: string;
    authorityMetadata: string;
    knownAuthorities: string[];
  };
  system: {
    networkClient: FixtureNetworkClient;
    loggerOptions: { piiLoggingEnabled: false; loggerCallback(): void };
  };
};
type RealMsal = {
  version: string;
  ConfidentialClientApplication: new (
    configuration: ConfidentialClientConfiguration,
  ) => {
    acquireTokenByClientCredential(request: {
      scopes: string[];
    }): Promise<TokenResult | null>;
  };
  ManagedIdentityApplication: new (configuration: {
    managedIdentityIdParams: { userAssignedClientId: string } | undefined;
    system: ConfidentialClientConfiguration["system"];
  }) => { acquireToken(request: { resource: string }): Promise<unknown> };
};
// This small structural type only describes runtime calls made by Teams 2.0.14;
// it does not claim that Teams declares MSAL 7 support in its package manifest.
const msal = requireFromTeams("@azure/msal-node") as RealMsal;

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const authority = `https://login.microsoftonline.com/${tenantId}`;
const tokenEndpoint = `${authority}/oauth2/v2.0/token`;
const scope = "https://api.botframework.com/.default";
const fixtureSecret = "unit-test-secret-not-a-real-credential";
const fixtureAccessToken = fixtureJwt({ aud: "https://api.botframework.com" });

beforeEach(() => {
  // A transport fixture is the only permitted HTTP seam. Block native sockets as
  // well as fetch so a changed SDK cannot accidentally contact a provider.
  vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
    throw new Error("Réseau interdit dans le test de compatibilité SDK.");
  });
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Fetch interdit dans le test de compatibilité SDK.");
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe(`SDK Teams réel ${teamsVersion} avec MSAL ${msalVersion}, sans réseau`, () => {
  it("résout la dépendance réellement chargée par Teams dans la comparaison bornée", () => {
    expect(teamsVersion).toBe("2.0.14");
    expect(msalVersion).toBe("7.1.0");
    expect(msal.version).toBe(msalVersion);
    expect(ServiceTokenValidator).toBeTypeOf("function");
    expect(msal.ConfidentialClientApplication).toBeTypeOf("function");
    expect(msal.ManagedIdentityApplication).toBeTypeOf("function");
  });

  it.each(["", "Bearer ", "Bearer not-a-jwt", "Bearer invalid.jwt"])(
    "le vrai validateur refuse un jeton absent ou mal formé : %j",
    async (authorization) => {
      const validator = new ServiceTokenValidator(clientId, tenantId);
      await expect(validator.check(authorization, {
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      })).rejects.toThrow();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(Socket.prototype.connect).not.toHaveBeenCalled();
    },
  );

  it("exécute le vrai flux client credentials et réutilise son cache", async () => {
    const network = createFixtureNetwork();
    const client = new msal.ConfidentialClientApplication(configuration(network, {
      clientSecret: fixtureSecret,
    }));

    const first = await client.acquireTokenByClientCredential({ scopes: [scope] });
    const cached = await client.acquireTokenByClientCredential({ scopes: [scope] });

    expect(first).toMatchObject({ accessToken: fixtureAccessToken, fromCache: false });
    expect(cached).toMatchObject({ accessToken: fixtureAccessToken, fromCache: true });
    expect(network.sendPostRequestAsync).toHaveBeenCalledTimes(1);
    const [url, options] = network.sendPostRequestAsync.mock.calls[0]!;
    expect(url.split("?")[0]).toBe(tokenEndpoint);
    const form = new URLSearchParams(options?.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe(clientId);
    expect(form.get("client_secret")).toBe(fixtureSecret);
    expect(form.get("scope")).toBe(scope);
    expectNoNetwork(network);
  });

  it("utilise le callback clientAssertion du chemin fédéré de Teams", async () => {
    const network = createFixtureNetwork();
    const assertion = fixtureJwt({ aud: tokenEndpoint });
    const clientAssertion = vi.fn(async () => assertion);
    const client = new msal.ConfidentialClientApplication(configuration(network, {
      clientAssertion,
    }));

    const result = await client.acquireTokenByClientCredential({ scopes: [scope] });

    expect(result).toMatchObject({ accessToken: fixtureAccessToken, fromCache: false });
    expect(clientAssertion).toHaveBeenCalledTimes(1);
    expect(network.sendPostRequestAsync).toHaveBeenCalledTimes(1);
    const form = new URLSearchParams(network.sendPostRequestAsync.mock.calls[0]![1]?.body);
    expect(form.get("client_assertion")).toBe(assertion);
    expect(form.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    expect(form.has("client_secret")).toBe(false);
    expectNoNetwork(network);
  });

  it("propage le rejet OAuth du transport local au lieu de fabriquer un jeton", async () => {
    const network = createFixtureNetwork({
      status: 400,
      body: { error: "invalid_client", error_description: "Local fixture rejection" },
    });
    const client = new msal.ConfidentialClientApplication(configuration(network, {
      clientSecret: fixtureSecret,
    }));

    await expect(client.acquireTokenByClientCredential({ scopes: [scope] }))
      .rejects.toMatchObject({ errorCode: "invalid_client" });
    expect(network.sendPostRequestAsync).toHaveBeenCalledTimes(1);
    expectNoNetwork(network);
  });

  it.each([clientId, undefined])(
    "construit le vrai client d’identité managée sans acquérir de jeton : %j",
    (userAssignedClientId) => {
      const network = createFixtureNetwork();
      const client = new msal.ManagedIdentityApplication({
        managedIdentityIdParams: userAssignedClientId ? { userAssignedClientId } : undefined,
        system: configuration(network, { clientSecret: fixtureSecret }).system,
      });
      expect(client.acquireToken).toBeTypeOf("function");
      expect(network.sendPostRequestAsync).not.toHaveBeenCalled();
      expectNoNetwork(network);
    },
  );
});

function configuration(
  networkClient: FixtureNetworkClient,
  credentials: Pick<ConfidentialClientConfiguration["auth"], "clientSecret" | "clientAssertion">,
): ConfidentialClientConfiguration {
  return {
    auth: {
      clientId,
      ...credentials,
      authority,
      knownAuthorities: ["login.microsoftonline.com"],
      // Deterministic metadata avoids real authority discovery. This suite does
      // not validate Microsoft's discovery service or the actual Azure identity.
      authorityMetadata: JSON.stringify({
        authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
        token_endpoint: tokenEndpoint,
        issuer: `${authority}/v2.0`,
        jwks_uri: `${authority}/discovery/v2.0/keys`,
        end_session_endpoint: `${authority}/oauth2/v2.0/logout`,
      }),
    },
    system: {
      networkClient,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback() {} },
    },
  };
}

function createFixtureNetwork(response?: { status: number; body: Record<string, unknown> }) {
  return {
    sendGetRequestAsync: vi.fn(async (url: string): Promise<never> => {
      void url;
      throw new Error("Découverte réseau inattendue dans le transport local.");
    }),
    sendPostRequestAsync: vi.fn(async (url: string, options?: NetworkOptions) => {
      void options;
      if (url.split("?")[0] !== tokenEndpoint) {
        throw new Error("Endpoint inattendu dans le transport local.");
      }
      return {
        status: response?.status ?? 200,
        headers: { "content-type": "application/json" },
        body: response?.body ?? {
          token_type: "Bearer",
          expires_in: 3_600,
          ext_expires_in: 3_600,
          access_token: fixtureAccessToken,
        },
      };
    }),
  };
}

function expectNoNetwork(network: ReturnType<typeof createFixtureNetwork>) {
  expect(network.sendGetRequestAsync).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
}

function fixtureJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: `https://sts.windows.net/${tenantId}/`,
    tid: tenantId,
    appid: clientId,
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    ...payload,
  })}.unit-test-signature`;
}
