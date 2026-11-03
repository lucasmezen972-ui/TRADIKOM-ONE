import twilio from "twilio";
import { z } from "zod";
import { WhatsAppTwilioTransportError } from "@/modules/channels/whatsapp-twilio-outbound";
import type {
  WhatsAppTwilioClient,
  WhatsAppTwilioClientFactory,
} from "@/modules/channels/whatsapp-twilio-transport";

const credentialsSchema = z
  .object({
    accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/),
    authToken: z.string().min(1).max(512),
  })
  .strict();
const optionsSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
    maxSockets: z.number().int().min(1).max(20).default(5),
  })
  .strict();

type TwilioSdkClient = {
  messages: {
    create(input: {
      from: string;
      to: string;
      body: string;
      statusCallback: string;
    }): Promise<{ sid: string; status?: string | null }>;
  };
};

export type TwilioSdkClientFactory = (
  accountSid: string,
  authToken: string,
  options: {
    autoRetry: false;
    maxRetries: 0;
    lazyLoading: true;
    timeout: number;
    keepAlive: true;
    maxSockets: number;
    maxTotalSockets: number;
    maxFreeSockets: 1;
    scheduling: "fifo";
  },
) => TwilioSdkClient;

export function createOfficialWhatsAppTwilioClientFactory(
  options: { timeoutMs?: number; maxSockets?: number } = {},
  createSdkClient: TwilioSdkClientFactory = twilio,
): WhatsAppTwilioClientFactory {
  const parsedOptions = optionsSchema.safeParse(options);
  if (!parsedOptions.success) throw validationError();

  return (credentials): WhatsAppTwilioClient => {
    const parsedCredentials = credentialsSchema.safeParse(credentials);
    if (!parsedCredentials.success) throw authenticationError();

    let client: TwilioSdkClient;
    try {
      client = createSdkClient(
        parsedCredentials.data.accountSid,
        parsedCredentials.data.authToken,
        {
          autoRetry: false,
          maxRetries: 0,
          lazyLoading: true,
          timeout: parsedOptions.data.timeoutMs,
          keepAlive: true,
          maxSockets: parsedOptions.data.maxSockets,
          maxTotalSockets: parsedOptions.data.maxSockets,
          maxFreeSockets: 1,
          scheduling: "fifo",
        },
      );
    } catch {
      throw authenticationError();
    }

    return {
      messages: {
        async create(input) {
          const result = await client.messages.create(input);
          return { sid: result.sid, status: result.status };
        },
      },
    };
  };
}

function authenticationError() {
  return new WhatsAppTwilioTransportError("auth");
}

function validationError() {
  return new WhatsAppTwilioTransportError("validation");
}
