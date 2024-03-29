import type {
  JSONSchema7Type as JSONSchemaType,
  JSONSchema7 as JSONSchema,
} from "json-schema";
import type { Tool, ToolMessages, ToolOutput } from "./types";
import dedent from "dedent";

import { Result } from "ts-results";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";

export const constructFormatToolForClaudePrompt = (tool: Tool): string => {
  const constructNestedParametersPrompt = (
    name: string,
    parameters: JSONSchema
  ): string => {
    if (parameters.type !== "object" && parameters.type !== "array") {
      return `<parameter>\n<name>${name}</name>\n<type>${parameters.type}</type>\n</parameter>\n`;
    }

    switch (parameters.type) {
      case "array": {
        if (!parameters.items) {
          throw new Error("Array parameters must have properties.");
        }

        let constructedPrompt = `<array-parameter>\n<name>${name}</name>\n`;

        if (Array.isArray(parameters.items)) {
          for (const item of parameters.items) {
            constructedPrompt += constructNestedParametersPrompt(
              name,
              item as JSONSchema
            );
          }
        } else {
          constructedPrompt += constructNestedParametersPrompt(
            name,
            parameters.items as JSONSchema
          );
        }

        return constructedPrompt + "</array-parameter>\n";
      }
      case "object": {
        if (!parameters.properties) {
          throw new Error("Object parameters must have properties.");
        }

        let constructedPrompt = "";

        const prefix =
          name === "" ? "" : `<object-parameter>\n<name>${name}</name>\n`;

        constructedPrompt += prefix;

        for (const [name, object] of Object.entries(parameters.properties)) {
          constructedPrompt += constructNestedParametersPrompt(
            name,
            object as JSONSchema
          );
        }

        const suffix = name === "" ? "" : "</object-parameter>\n";

        return constructedPrompt + suffix;
      }
    }
  };

  const constructedPrompt = dedent`<tool_description>
  <tool_name>${tool.name}</tool_name>
  ${tool.description ? `<description>${tool.description}</description>` : ""}
  <parameters>
  ${constructNestedParametersPrompt("", tool.parameters)}</parameters>
  </tool_description>
  `;

  return constructedPrompt;
};

export const constructToolUseSystemPrompt = (tools: Tool[]): string => {
  const toolUseSystemPrompt = `In this environment you have access to a set of tools you can use to answer the user's question.
  You may call them like this:
  <function_calls>
  <invoke>
  <tool_name>$TOOL_NAME</tool_name>
  <parameters>
  <$PARAMETER_NAME>$PARAMETER_VALUE</$PARAMETER_NAME>
  ...
  </parameters>
  </invoke>
  </function_calls>
  
  Here are the tools available:
  ${tools.map(
    (tool) => dedent`<tools>
  ${constructFormatToolForClaudePrompt(tool)}
  </tools>`
  )}`;

  return toolUseSystemPrompt;
};

const constructSuccessfulFunctionRunInjectionPrompt = (
  invokeResults: ToolOutput[]
): string => {
  const constructedPrompt = `<function_results>
  ${invokeResults
    .map(
      (res) => `<result>
  <tool_name>${res.tool_name}</tool_name>
  <stdout>
  ${res.tool_result}
  </stdout>
  </result>`
    )
    .join("\n")}
  </function_results>`;

  return constructedPrompt;
};

export const convertToolMessageToMessage = (
  message: ToolMessages[]
): MessageParam[] => {
  const newMessages: MessageParam[] = [];

  let lastMessage: MessageParam | undefined;

  for (const msg of message) {
    switch (msg.role) {
      case "assistant":
      case "user":
        newMessages.push(msg);
        break;
      case "tool_inputs": {
        if (lastMessage?.role !== "assistant") {
          const m: MessageParam = {
            role: "assistant",
            content: msg.msg_str,
          };

          newMessages.push(m);

          lastMessage = m;
        }

        const content = msg.msg_str.includes("</function_calls>")
          ? msg.msg_str
          : `${msg.msg_str}</function_calls>`;

        newMessages[
          newMessages.length - 1
        ].content = `${lastMessage.content}${content}`;
        break;
      }
      case "tool_outputs": {
        if (lastMessage?.role !== "assistant")
          throw new Error("Tool inputs must follow an assistant message.");

        const content = constructSuccessfulFunctionRunInjectionPrompt(
          msg.tool_outputs
        );

        newMessages[
          newMessages.length - 1
        ].content = `${lastMessage.content}${content}`;
        break;
      }
    }
  }
  return newMessages;
};
