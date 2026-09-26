/**
 * One-off: verify an NVIDIA build endpoint answers a non-streaming
 * OpenAI-compatible chat completion, exactly as the gateway would send it.
 *
 *   NVIDIA_KEY=… node --import tsx --import ./scripts/register-stub.mjs scripts/check-nvidia.ts
 */
async function main() {
  const key = process.env.NVIDIA_KEY;
  const model = process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b";
  const base = "https://integrate.api.nvidia.com/v1";
  if (!key) {
    console.error("Set NVIDIA_KEY first.");
    process.exit(1);
  }

  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: online" }],
      temperature: 0.7,
      max_tokens: 256,
      stream: false,
    }),
  });

  const elapsed = Date.now() - started;
  console.log(`  HTTP ${res.status}  ${elapsed}ms`);

  const text = await res.text();
  if (!res.ok) {
    console.log("  body:", text.slice(0, 500));
    process.exit(1);
  }

  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  console.log("  isi  :", JSON.stringify((message?.content ?? "").slice(0, 120)));
  if (message?.reasoning_content) {
    console.log(" <think>:", message.reasoning_content.slice(0, 80), "…");
  }
  console.log("  token:", JSON.stringify(json.usage ?? {}));

  // The gateway must never post a streaming request to a provider it cannot read.
  if (json.choices?.[0]?.message?.content === undefined) {
    console.log("  PERINGATAN: tidak ada message.content — adapter mungkin perlu penyesuaian");
  }
}

main().catch((error: unknown) => {
  console.error("  GAGAL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
