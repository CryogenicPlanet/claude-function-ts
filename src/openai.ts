import type { ClientOptions } from "@anthropic-ai/sdk";
import Openai from "openai";
import Anthropic from ".";
import type { Tool, ToolMessages } from "./types";
import type { ChatCompletion } from "openai/resources/index.mjs";
import type { APIPromise } from "openai/core.mjs";

export const withClaude = (openai: Openai, config: ClientOptions) => {
  const anthropic = new Anthropic(config);

  type Params = Parameters<typeof openai.chat.completions.create>;

  type AnthropicParams = Parameters<Anthropic["messages"]["create"]>;

  type OverwrittenParams = [
    body: Omit<Params[0], "model" | "max_tokens"> & {
      model: AnthropicParams[0]["model"];
      max_tokens: AnthropicParams[0]["max_tokens"];

      /**
       * Do not support function calling with streaming
       */
      stream?: false;
    },
    options?: Params[1]
  ];

  type WrappedChatCompletion = Omit<ChatCompletion, "id" | "choices"> & {
    /**
     * @deprecated This is a fake id that is generated on the client side
     */
    id: "fake-id-client-side";

    choices: Array<
      Omit<ChatCompletion.Choice, "logprobs"> & {
        /**
         * @deprecated This is always null on this wrapped library
         */
        logprobs: null;
      }
    >;
  };

  const wrappedCompletions = (...params: OverwrittenParams) => {
    const [prompt, o] = params;

    const { __streamClass, ...options } = o!;

    if (!prompt.tools && !prompt.functions) {
      throw new Error("tools or functions are required for this wrapper");
    }

    const tools: Tool[] = prompt.tools
      ? prompt.tools.map((tool) => tool.function)
      : prompt.functions || [];

    const max_tokens = prompt.max_tokens;

    let systemPrompt = "";
    const messages: ToolMessages[] = [];

    for (const message of prompt.messages) {
      switch (message.role) {
        case "user":
          messages.push({
            role: "user",
            content:
              typeof message.content === "string"
                ? message.content
                : message.content.join(" "),
          });
          break;
        case "assistant":
          messages.push({
            role: "assistant",
            content: message.content!,
          });
          break;
        case "system":
          systemPrompt = message.content;
          break;
        default:
          console.warn(`Unknown message role: ${message.role}`);
      }
    }

    if (!max_tokens) {
      throw new Error("max_tokens is required");
    }

    return anthropic.tools
      .create(
        tools,
        {
          ...prompt,
          max_tokens,
          stream: false,
          temperature: prompt.temperature || undefined,
          top_p: prompt.top_p || undefined,
          messages: messages,
          system: systemPrompt,
        },
        options
      )
      .manual()
      .then((r) => r.unwrap())
      .then((r) => {
        //   Format to openai response

        switch (r.role) {
          case "assistant": {
            const resp: WrappedChatCompletion = {
              id: "fake-id-client-side",
              model: prompt.model,
              object: "chat.completion",
              created: Date.now(),
              choices: [
                {
                  message: {
                    content: r.content,
                    role: "assistant",
                  },

                  index: 0,
                  finish_reason: "stop",
                  logprobs: null,
                },
              ],
            };
            return resp;
          }
          case "tool_inputs": {
            const funcs = r.tool_inputs.map((toolInput) => ({
              name: toolInput.tool_name,
              arguments: toolInput.tool_arguments as string,
            }));

            const resp: WrappedChatCompletion = {
              id: "fake-id-client-side",
              model: prompt.model,
              object: "chat.completion",
              created: Date.now(),
              choices: [
                {
                  finish_reason: "tool_calls",
                  index: 0,
                  message: {
                    content: r.content || "",
                    role: "assistant",
                    tool_calls: funcs.map((func) => ({
                      function: func,
                      type: "function",
                      id: "fake-id-client-side",
                    })),
                  },
                  logprobs: null,
                },
              ],
            };

            return resp;
          }
        }
      });
  };

  return {
    chat: {
      completions: {
        /**
         * This is the wrapped version of the completions endpoint that will use anthropic ann handle function calls
         *
         *
         */
        create: wrappedCompletions,
        /**
         * This is an untouched version of the completions endpoint
         */
        unwrapped: openai.chat.completions.create,
      },
    },
  };
};
