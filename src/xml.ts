import { XMLParser } from "fast-xml-parser";
import type { JSONSchema7Type } from "json-schema";
import { Err, Ok, Result } from "ts-results";

type LeafNode = {
  type: "leaf";
  value: unknown;
};

type ArrayNode = {
  type: "array";
  children: Node[];
};

type ObjectNode = {
  type: "object";
  children: Record<string, Node>;
};

export type Node = LeafNode | ArrayNode | ObjectNode;

const nodeToObject = (node: Node): unknown => {
  if (node.type === "leaf") {
    return node.value;
  } else if (node.type === "array") {
    return node.children.map((child) => nodeToObject(child));
  } else {
    const obj: Record<string, any> = {};

    for (const key in node.children) {
      obj[key] = nodeToObject(node.children[key]);
    }

    return obj;
  }
};

export const convertValue = (value: string, typeStr: JSONSchema7Type): any => {
  switch (typeStr) {
    case "array":
    case "object":
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    case "number":
      const parsedNumber = Number(value);
      return isNaN(parsedNumber) ? value : parsedNumber;
    case "boolean":
      return value.toLowerCase() === "true"
        ? true
        : value.toLowerCase() === "false"
        ? false
        : value;
    case "string":
    default:
      return value;
  }
};

export const parseXml = (
  xml: string
): Result<
  {
    invokes: Array<{
      tool_name: string;
      parameters: unknown;
    }>;
  },
  string
> => {
  const parser = new XMLParser({
    isArray(tagName, jPath, isLeafNode, isAttribute) {
      return isLeafNode ? false : true;
    },
  });

  const json = parser.parse(xml);

  //   console.dir({ json }, { depth: null });

  const function_calls = json["function_calls"]?.[0];

  if (!function_calls) {
    console.warn("No function calls found", { json });
    return Err("No function calls found");
  }

  const invokes = function_calls["invoke"];

  const parseParameters = (
    parameters: any,
    type: Node["type"]
  ): Result<Node, string> => {
    // if (!parameters) throw new Error("No parameters found");

    const arrayParams = parameters["array-parameter"] || [];
    const objectParams = parameters["object-parameter"] || [];
    const params = "parameter" in parameters ? parameters["parameter"] : [];

    let globalNode: Node =
      type === "leaf"
        ? { type, value: null }
        : type === "array"
        ? { type, children: [] }
        : { type, children: {} };

    for (const arr of arrayParams) {
      if (type === "leaf") return Err("Cannot have array as leaf node");

      const name = arr["name"] as string;

      const node = parseParameters(arr, "array");

      if (node.err) {
        return node;
      }

      switch (globalNode.type) {
        case "array": {
          globalNode.children.push(node.unwrap());
          break;
        }
        case "object": {
          globalNode.children[name] = node.unwrap();
          break;
        }
      }
    }

    for (const arr of params) {
      if (!arr["name"] || !arr["value"] || !arr["type"]) {
        return Err(`Invalid parameter ${JSON.stringify(arr)}`);
      }

      const name = arr["name"] as string;
      const value = convertValue(arr["value"], arr["type"]);

      const node: Node = {
        type: "leaf",
        value,
      };

      switch (globalNode.type) {
        case "array": {
          globalNode.children.push(node);
          break;
        }
        case "object": {
          globalNode.children[name] = node;
          break;
        }
      }
    }

    for (const obj of objectParams) {
      if (type === "leaf") return Err("Cannot have object as leaf node");

      const name = obj["name"] as string;

      const node = parseParameters(obj, "object");

      if (node.err) {
        return node;
      }

      switch (globalNode.type) {
        case "array": {
          globalNode.children.push(node.unwrap());
          break;
        }
        case "object": {
          globalNode.children[name] = node.unwrap();
          break;
        }
      }
    }

    return Ok(globalNode);
  };

  const invokeFuncs = [];

  for (const invoke of invokes) {
    const name = invoke["tool_name"];
    const parameters = invoke["parameters"][0];

    const node = parseParameters(parameters, "object");

    if (node.err) {
      return node;
    }

    invokeFuncs.push({
      name,
      parameters: nodeToObject(node.unwrap()),
    });
  }

  return Ok({
    invokes: invokeFuncs.map((func) => ({
      tool_name: func.name,
      parameters: func.parameters,
    })),
  });
};
