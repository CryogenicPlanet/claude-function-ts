import OpenAI from "openai";
import { withClaude } from "../openai";

const openai = new OpenAI({});

const claude = withClaude(openai, {
  apiKey: "sk",
});

const response = await claude.chat.completions.create({
  model: "claude-3-opus-20240229",
  max_tokens: 2000,
  messages: [],
});
