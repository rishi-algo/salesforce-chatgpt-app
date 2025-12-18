import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { oauthStart, oauthCallback } from "./oauth.js";
import { handleToolCall } from "./tools.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_, res) => res.json({ ok: true }));

// OAuth
app.get("/oauth/start", oauthStart);
app.get("/oauth/callback", oauthCallback);

// Tool call endpoint (your Apps SDK / MCP runtime will hit this)
app.post("/tools/call", async (req, res) => {
  //const userKey = req.headers["x-user-key"] || "dev-user"; // replace with real identity
  const userKey = "rishi";
  //const { tool, input } = req.body || {};
  //const { tool, input = {} } = req.body || {};
  //const out = await handleToolCall({ userKey, tool, input });
  //res.json(out);
  const body = req.body || {};
  const tool = body.tool;
  const input = body.input ?? {}; // ✅ default

  try {
    const out = await handleToolCall({ userKey, tool, input });
    res.json(out);
  } catch (err) {
    console.error("Tool call error:", err);
    res.status(200).json({
      error: {
        code: "TOOL_RUNTIME_ERROR",
        message: err?.message || "Unknown error",
        details: err?.issues || err
      }
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});


