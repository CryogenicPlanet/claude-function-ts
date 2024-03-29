import * as Ant from "@anthropic-ai/sdk";
import * as AntApi from "@anthropic-ai/sdk/resources/index";
import { Err, Ok, Result } from "ts-results";

import { parseXml } from "./xml";
import {
  constructToolUseSystemPrompt,
  convertToolMessageToMessage,
} from "./prompt.constructor";

import type {
  Tool,
  ToolInput,
  MessageParams,
  ToolCallbacks,
  ToolParams,
  ToolNames,
  ToolOutput,
} from "./types";

const getRecursiveKeys = (obj: Record<string, unknown>): string[] => {
  const keys = Object.keys(obj);
  return keys.concat(
    ...keys.map((key) => {
      const value = obj[key];
      return typeof value === "object"
        ? getRecursiveKeys(value as Record<string, unknown>)
        : [];
    })
  );
};

const functionCallsValidFormatAndInvokeExtraction = async (
  lastCompletion: string
): Promise<
  Result<
    | { status: false }
    | {
        status: true;
        invokes: Array<{
          tool_name: string;
          parameters: unknown;
        }>;
        prefix_content?: string;
      },
    string
  >
> => {
  const functionCallTags = lastCompletion.match(
    /<function_calls>|<\/function_calls>|<invoke>|<\/invoke>|<tool_name>|<\/tool_name>|<parameters>|<\/parameters>/g
  );

  if (!functionCallTags) {
    return Ok({ status: false, reason: "No function calls found." });
  }

  const parsed = parseXml(lastCompletion);

  const prefixMatch = lastCompletion.match(/^([\s\S]*?)<function_calls>/);
  let funcCallPrefixContent = "";
  if (prefixMatch) {
    funcCallPrefixContent = prefixMatch[1];
  }

  if (!parsed.ok) {
    return Err(parsed.val);
  }

  return Ok({
    status: true,
    invokes: parsed.unwrap().invokes,
    prefix_content: funcCallPrefixContent,
  });
};

const parseFunctionCalls = async (
  lastCompletion: string,
  tools: Tool[]
): Promise<
  | { status: "DONE" }
  | { status: "ERROR"; message: string }
  | {
      status: "SUCCESS";
      invoke_results: Array<ToolInput>;
      content?: string;
    }
> => {
  // Check if the format of the function call is valid
  const invokeCalls = await functionCallsValidFormatAndInvokeExtraction(
    lastCompletion
  );

  if (!invokeCalls.ok) {
    return { status: "ERROR", message: invokeCalls.val };
  }

  if (!invokeCalls.val.status) {
    return { status: "DONE" };
  }

  // Parse the query's invoke calls and get its results
  const invokeResults: Array<ToolInput> = [];
  for (const invokeCall of invokeCalls.val.invokes) {
    // Find the correct tool instance
    const toolName = invokeCall.tool_name;
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        status: "ERROR",
        message: `No tool named <tool_name>${toolName}</tool_name> available.`,
      };
    }

    const parameters = invokeCall.parameters;

    invokeResults.push({
      tool_name: toolName,
      tool_arguments: parameters,
    });
  }

  return {
    status: "SUCCESS",
    invoke_results: invokeResults,
    content: invokeCalls.val.prefix_content,
  };
};

export class Tools {
  private api: Ant.Anthropic;

  constructor(api: Ant.Anthropic) {
    this.api = api;
  }

  create<T extends Tool[]>(
    tools: T,
    body: MessageParams,
    options?: Parameters<AntApi.Messages["create"]>[1]
  ) {
    // prompt = ToolUser._construct_prompt_from_messages(messages)
    // constructed_prompt = construct_use_tools_prompt(prompt, self.tools, messages[-1]['role'])
    const { max_tokens: _, messages, ...messageParams } = body;
    const systemPrompt = constructToolUseSystemPrompt(tools);
    const lastRole = messages[messages.length - 1].role;

    const automatic = async (
      cb: ToolCallbacks<T>,
      {
        forceFunctionCall = false,
      }: {
        /**
         * Set the stop sequence to only </function_calls> if you want to force a function call
         **/
        forceFunctionCall?: boolean;
      } = {}
    ): Promise<Result<{ role: "assistant"; content: string }, string>> => {
      let newMessage = await this.api.messages.create(
        {
          ...messageParams,
          messages: convertToolMessageToMessage(messages),
          system: systemPrompt,
          max_tokens: body.max_tokens_to_sample ?? 2000,
          stream: false,
          stop_sequences: forceFunctionCall
            ? ["\n\nHuman:", "\n\nAssistant", "</function_calls>"]
            : ["</function_calls>"],
        },
        options
      );

      let content = newMessage.content[0].text;

      let count = 0;

      while (true) {
        count++;
        // because </function_calls> is the stop sequence, we sometimes it is not present
        if (
          content.includes("<function_calls>") &&
          !content.includes("</function_calls>")
        ) {
          content = `${content}</function_calls>`;
        }

        const parsedFunctionCalls = await parseFunctionCalls(content, tools);

        switch (parsedFunctionCalls.status) {
          case "DONE":
            return Ok({
              role: "assistant",
              content: newMessage.content[0].text,
            });

          case "ERROR":
            return Err(parsedFunctionCalls.message);
          case "SUCCESS":
            const invokeResults = parsedFunctionCalls.invoke_results;

            messages.push({
              role: "tool_inputs",
              content: content,
              msg_str: content,
              tool_inputs: invokeResults,
            });

            const toolResults: ToolOutput[] = [];
            for (const invokeResult of invokeResults) {
              const tool = tools.find((t) => t.name === invokeResult.tool_name);
              if (!tool) {
                return Err(`No tool named ${invokeResult.tool_name} found.`);
              }

              const result = cb[invokeResult.tool_name as ToolNames<T>](
                invokeResult.tool_arguments as ToolParams<T, ToolNames<T>>
              );

              toolResults.push({
                tool_name: invokeResult.tool_name,
                tool_result: result,
              });
            }

            messages.push({
              role: "tool_outputs",
              tool_outputs: toolResults,
            });

            newMessage = await this.api.messages.create(
              {
                ...messageParams,
                messages: convertToolMessageToMessage(messages),
                system: systemPrompt,
                max_tokens: body.max_tokens_to_sample ?? 2000,
                stream: false,
                stop_sequences: forceFunctionCall
                  ? ["\n\nHuman:", "\n\nAssistant", "</function_calls>"]
                  : ["</function_calls>"],
              },
              options
            );

            content = newMessage.content[0].text;
        }
      }
    };

    const manual = async ({
      forceFunctionCall = false,
    }: {
      /**
       * Set the stop sequence to only </function_calls> if you want to force a function call
       **/
      forceFunctionCall?: boolean;
    } = {}): Promise<
      Result<
        | { role: "assistant"; content: string }
        | { role: "tool_inputs"; content?: string; tool_inputs: ToolInput[] },
        string
      >
    > => {
      const newMessage = await this.api.messages.create(
        {
          ...messageParams,
          messages: convertToolMessageToMessage(messages),
          system: systemPrompt,
          max_tokens: body.max_tokens_to_sample ?? 2000,
          stream: false,
          stop_sequences: forceFunctionCall
            ? ["\n\nHuman:", "\n\nAssistant", "</function_calls>"]
            : ["</function_calls>"],
        },
        options
      );

      const content = newMessage.content[0].text.includes("</function_calls>")
        ? newMessage.content[0].text
        : `${newMessage.content[0].text}</function_calls>`;

      const parsedFunctionCalls = await parseFunctionCalls(content, tools);

      switch (parsedFunctionCalls.status) {
        case "DONE":
          return Ok({
            role: "assistant",
            content: newMessage.content[0].text,
          });

        case "ERROR":
          return Err(parsedFunctionCalls.message);
        case "SUCCESS":
          return Ok({
            role: "tool_inputs",
            content: parsedFunctionCalls.content,
            tool_inputs: parsedFunctionCalls.invoke_results,
          });
        default:
          return Err("Unrecognized status in parsedFunctionCalls.");
      }
    };

    return {
      manual,
      automatic,
    };
  }
}

export class Anthropic extends Ant.Anthropic {
  constructor(options?: ConstructorParameters<typeof Ant.Anthropic>[0]) {
    super(options);
  }

  tools = new Tools(this);
}

export default Anthropic;
