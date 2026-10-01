/**
 * Forward a PDF password to the worker.
 *
 * The password lives only in this request body. Nothing in this function
 * writes it to a log, a metric, or an error string.
 */

type UnlockResult = { payload: unknown; status: number };

export async function forwardUnlock(input: {
  statementId: string;
  userId: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<UnlockResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const worker = process.env.WORKER_BASE_URL || "http://127.0.0.1:4711";
  const response = await fetchImpl(`${worker}/unlock`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WORKER_TOKEN || "dev-worker-token"}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      statementId: input.statementId,
      userId: input.userId,
      password: input.password,
    }),
  });
  const payload = await response.json().catch(() => ({ error: "worker_unavailable" }));
  return { payload, status: response.ok ? 200 : response.status };
}
