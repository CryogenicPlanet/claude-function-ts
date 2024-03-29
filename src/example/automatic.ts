import Anthropic from "..";
// import Anthropic from "claude-function-ts"

const anthropic = new Anthropic({
  apiKey: "",
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
  .automatic({
    emailUser: (params) =>
      `Send an email to ${params.to
        .map((to) => `${to.name} <${to.email}>`)
        .join(", ")} with subject ${params.subject} and body ${params.body}`,
  });

console.log({ resp });
