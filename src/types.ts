import type {
  MessageCreateParamsBase,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";

import type {
  JSONSchema7Type as JSONSchemaType,
  JSONSchema7 as JSONSchema,
} from "json-schema";

export type Tool = {
  name: Readonly<string>;
  description?: string;
  parameters?: JSONSchema;
};

export type ToolNames<T extends ReadonlyArray<Tool>> = {
  [K in keyof T]: T[K] extends Tool ? T[K]["name"] : never;
}[number];

type JSONSchemaTypeToTS = {
  string: string;
  number: number;
  boolean: boolean;
  object: Record<string, unknown>;
  array: unknown[];
};

type InferJSONSchemaType<S> = S extends { type: infer T }
  ? T extends keyof JSONSchemaTypeToTS
    ? JSONSchemaTypeToTS[T]
    : never
  : never;

type InferJSONSchemaProperties<S> = S extends { properties: infer P }
  ? { [K in keyof P]: InferJSONSchema<P[K]> }
  : never;

type InferJSONSchemaItems<S> = S extends { items: infer I }
  ? I extends Array<infer A>
    ? InferJSONSchema<A>[]
    : InferJSONSchema<I>[]
  : never;

type InferJSONSchema<S> = S extends { type: "array" }
  ? InferJSONSchemaItems<S>
  : S extends { type: "object" }
  ? InferJSONSchemaProperties<S>
  : InferJSONSchemaType<S>;

export type ParametersObject<T extends Tool> =
  T["parameters"] extends infer Schema ? InferJSONSchema<Schema> : never;

export type ToolParams<
  T extends ReadonlyArray<Tool>,
  K extends ToolNames<T>
> = ParametersObject<Extract<T[number], { name: K }>>;

export type ToolCallbacks<T extends ReadonlyArray<Tool>> = {
  [K in ToolNames<T>]: (params: ToolParams<T, K>) => Promise<{}> | {};
};

export type ToolOutput = {
  tool_name: string;
  tool_result: unknown;
};

export type ToolInput = {
  tool_name: string;
  tool_arguments: unknown;
};

export type ToolMessages =
  | MessageParam
  | {
      role: "tool_inputs";
      content: string;
      msg_str: string;
      tool_inputs: Array<ToolInput>;
    }
  | {
      role: "tool_outputs";
      tool_outputs: Array<ToolOutput>;
      tool_error?: string;
    };

export type MessageParams = Omit<MessageCreateParamsBase, "messages"> & {
  messages: ToolMessages[];
  max_tokens_to_sample?: number;
  max_tokens?: number;

  /**
   *
   * My implementation of function calling with claude doesn't support streaming atm */
  stream?: false;
};
