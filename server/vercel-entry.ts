import { Actions } from "./src/actions";
import { privilegedHandlers } from "./src/privileged";

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(value: unknown): unknown;
};

type PrivilegedContract = {
  name: string;
  request: { parse(value: unknown): unknown };
  response: { parse(value: unknown): unknown };
};

type ActionDefinition = {
  request: { parse(value: unknown): unknown };
  response: { parse(value: unknown): unknown };
  handler: (ctx: ActionContext, args: unknown) => Promise<unknown> | unknown;
};

type ActionContext = {
  executePrivileged: (contract: PrivilegedContract, args: unknown) => Promise<unknown>;
  invalidateQueries: () => void;
};

const privilegedByName = new Map(
  privilegedHandlers.entries.map((entry) => [entry.contract.name, entry] as const),
);

function readableError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    return "The request was not valid.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The action could not be completed.";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as { action?: unknown; args?: unknown } | undefined;
  const actionName = typeof body?.action === "string" ? body.action : "";
  const action = (Actions as unknown as Record<string, ActionDefinition>)[actionName];
  if (!action) return res.status(404).json({ error: "Action not found" });

  const ctx: ActionContext = {
    async executePrivileged(contract, rawArgs) {
      const entry = privilegedByName.get(contract.name);
      if (!entry) throw new Error(`Server capability ${contract.name} is unavailable.`);
      const args = contract.request.parse(rawArgs);
      const result = await entry.handler(args as never);
      return contract.response.parse(result);
    },
    invalidateQueries() {
      // Browser mutations update or refetch local state. RetailIQ's scoped
      // polling keeps other signed-in devices fresh.
    },
  };

  try {
    const args = action.request.parse(body?.args ?? {});
    const data = action.response.parse(await action.handler(ctx, args));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ data });
  } catch (error) {
    const status = error && typeof error === "object" && "issues" in error ? 400 : 500;
    return res.status(status).json({ error: readableError(error) });
  }
}
