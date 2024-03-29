# claude-function-ts

Function calling sdk for claude in typescript (supports JSONSchema)


## Installation

```bash
npm add claude-function-ts
yarn add claude-function-ts
pnpm add claude-function-ts
bun add claude-function-ts
```

## Quick start (with Anthropic sdk)

```ts
import { Anthropic } from 'claude-function-ts';

const anthropic = new Anthropic({
  apiKey: "YOUR_API_KEY",
});

const resp = await anthropic.tools
  .create(
    [
      {
        name: "emailUser",
        description: "Send an email to a user",
        parameters: {
          type: "object",
          properties: {
            to: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                  },
                  name: {
                    type: "string",
                  },
                },
                required: ["email", "name"],
                additionalProperties: false,
              },
            },
            subject: {
              type: "string",
            },
            body: {
              type: "string",
            },
          },
          required: ["to", "subject", "body"],
          additionalProperties: false,
          $schema: "http://json-schema.org/draft-07/schema#",
        },
      },
    ] as const,
    {
      model: "claude-3-haiku-20240307",
      stream: false,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content:
            "Send an email to rahul,zack and malay from scalar.video, I want to talk to him about how they built their CRDTs for their video editor; I am reaching out cold",
        },
      ],
    }
  )
  .manual();
```

## API

### Tools definition

Would recommend using something like `zod` to generate the json schema for the tools.

```ts
.tools.create(tool: Tool[], message: MessageParams, options: RequestOptions)

export type Tool = {
  name: Readonly<string>;
  description: string;
  parameters: JSONSchema;
};
```

### Manual

Manual will just give you the output of one single function call, it will return either the assistant response or the tool inputs for your function call.

```ts
.tools.create(...).manual({forceFunctionCall = false}: {forceFunctionCall: boolean}): Promise<
      Result<
        | { role: "assistant"; content: string }
        | { role: "tool_inputs"; content?: string; tool_inputs: ToolInput[] },
        string
      >>;

export type ToolInput = {
  tool_name: string;
  tool_arguments: unknown;
};
```

- the `forceFunctionCall` will ensure the model ends with a function call but forcing the stop sequence

### Automatic

Automatic will keep calling the assistant with the function results till the assistant stops the conversation.

```ts
.tools.create(...).automatic(cb: {
    [toolName: string] : (params: unknown): Promise<{}> | {}
},{forceFunctionCall = false}: {forceFunctionCall: boolean}): Promise<
      Result<
        { role: "assistant"; content: string },
        string
      >
    >
```
In automatic mode you need to ensure you have the tool callbacks for the tools you are using in the conversation.

- if you use `as const` while defining the tools, you can use the toolNames and the params will be properly typed in the callback.


## Disclaimer
I think the anthropic function calling api is kinda jank and this doesn't strictly follow it, sorta diverges to enable easy arrays and objects in the `xml` output. I expect to that the xml parsing here isn't perfect and happy to accept PRs to improve it.

This is based on the alpha-sdk for function calling from anthropic [here](https://github.com/anthropics/anthropic-tools/)