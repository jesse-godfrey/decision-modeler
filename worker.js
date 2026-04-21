
const AGENT_ID = "agent_8801kphe7228fwma1j9gpf8fdr20";

const CORS = {
  "Access-Control-Allow-Origin": "https://jesse-godfrey.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    const url = new URL(request.url);

    // ── Route: /claude — proxy Gemini API calls ──
    if (url.pathname === "/claude") {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: { message: "GEMINI_API_KEY not configured" } }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }

      const body = await request.json();

      // Convert Anthropic message format to Gemini format
      const geminiContents = body.messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const geminiBody = {
        system_instruction: body.system ? { parts: [{ text: body.system }] } : undefined,
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: body.max_tokens || 1000,
          temperature: 0.7,
        },
      };

      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
        }
      );

      const data = await upstream.json();

      if (!upstream.ok) {
        return new Response(
          JSON.stringify({ error: { message: data.error?.message || "Gemini API error" } }),
          { status: upstream.status, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }

      // Convert Gemini response back to Anthropic-compatible format
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return new Response(
        JSON.stringify({ content: [{ type: "text", text }] }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // ── Route: / (default) — ElevenLabs signed URL ──
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const [tokenRes, signedRes] = await Promise.allSettled([
      fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${AGENT_ID}`,
        { headers: { "xi-api-key": apiKey } }
      ),
      fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`,
        { headers: { "xi-api-key": apiKey } }
      ),
    ]);

    if (tokenRes.status !== "fulfilled" || !tokenRes.value.ok) {
      const status = tokenRes.status === "fulfilled" ? tokenRes.value.status : 0;
      const body = tokenRes.status === "fulfilled"
        ? await tokenRes.value.text()
        : tokenRes.reason?.message;
      return new Response(
        JSON.stringify({ error: "Failed to create voice session", token_status: status, token_detail: body }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const tokenData = await tokenRes.value.json();
    const signedData = signedRes.status === "fulfilled" && signedRes.value.ok
      ? await signedRes.value.json()
      : null;

    return new Response(
      JSON.stringify({
        token: tokenData.token,
        signedUrl: signedData?.signed_url ?? null,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  },
};
