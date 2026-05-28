import protocolVersionJson from "../../../tests/contract/protocol-version.json";
import errorCodesJson from "../../../tests/contract/error-codes.json";
import eventsJson from "../../../tests/contract/events.json";

export interface ProtocolVersionContract {
  version: "v1";
}

export interface ErrorCodeContract {
  code: string;
  key: string;
}

export interface EventContract {
  type: string;
  description: string;
}

export const protocolVersion = protocolVersionJson as ProtocolVersionContract;
export const errorCodes = errorCodesJson as ErrorCodeContract[];
export const events = eventsJson as EventContract[];
