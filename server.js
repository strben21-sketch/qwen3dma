
const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.QWEN_MODEL || "qwen2.5:0.5b";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error("Ollama is not responding properly.");
    }

    const data = await response.json();
    const models = (data.models || []).map(m => m.name);

    res.json({
      ok: true,
      model: MODEL,
      installed: models.some(name =>
        name === MODEL || name.startsWith(MODEL + ":")
      )
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: "Ollama is not running. Start Ollama and load the Qwen model."
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (message.length > 6000) {
      return res.status(400).json({
        error: "Messages must be 6,000 characters or fewer."
      });
    }

    const safeHistory = Array.isArray(history)
      ? history.slice(-10).filter(item =>
          item &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string"
        ).map(item => ({
          role: item.role,
          content: item.content.slice(0, 3000)
        }))
      : [];

    // Never trust the browser to send system instructions.
    const messages = [
      {
        role: "system",
        content:
          "You are Nova, a helpful AI assistant. Be friendly, " +
          "accurate, and clear. Explain uncertainty when necessary. " +
          "Use readable formatting and useful code examples."
      },
      ...safeHistory,
      { role: "user", content: message.trim() }
    ];

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 1200
        }
      }),
      signal: AbortSignal.timeout(180000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const details = data.error || `Ollama HTTP ${response.status}`;
      return res.status(502).json({
        error: details
      });
    }

    const answer = data.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({
        error: "Qwen returned an empty response. Try again."
      });
    }

    res.json({
      answer,
      model: MODEL
    });
  } catch (error) {
    console.error("Chat error:", error.message);

    const timeout = error.name === "TimeoutError";

    res.status(timeout ? 504 : 502).json({
      error: timeout
        ? "Qwen took too long. Try a shorter prompt."
        : "Cannot reach Ollama. Check that it is running and the model is installed."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nova AI is running on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
});
