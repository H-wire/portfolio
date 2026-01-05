type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type LlmResponse = {
  text: string;
  usage: LlmUsage | null;
  model: string;
};

export async function callLlm(prompt: string, input: Record<string, unknown>) {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY ?? "";
  const model = process.env.LLM_MODEL ?? "gpt-4";
  const maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 500);
  const temperature = Number(process.env.LLM_TEMPERATURE ?? 0.3);

  if (!baseUrl) {
    throw new Error("LLM_BASE_URL is required");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey ? `Bearer ${apiKey}` : "",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(input) },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message?.content ?? "";
  return {
    text: message.trim(),
    usage: data.usage ?? null,
    model: data.model ?? model,
  } as LlmResponse;
}
