import { describe, it, expect } from "vitest";
import { newApiEndpoint } from "../shared/api-workspace.mjs";
import { debugOverrides, debugRequest } from "./api-debug-draft";

describe("per-request values are separate from shared definitions", () => {
  it("keeps temporary parameter, auth, body and timeout values out of the definition and shared examples", () => {
    const definition = newApiEndpoint("one");
    definition.parameters = [
      {
        id: "query",
        name: "q",
        location: "query",
        type: "string",
        required: false,
        enabled: true,
        description: "",
        example: "default",
        schema: "",
      },
    ];
    const before = structuredClone(definition),
      request = structuredClone(definition);
    request.parameters[0].example = "temporary";
    request.auth.type = "bearer";
    request.auth.token = "local-token";
    request.timeout = 4000;
    request.bodyKind = "text";
    request.body = "local-body";
    const overrides = debugOverrides(definition, request);
    request.parameters[0].example = "changed after snapshot";
    expect(debugRequest(definition, overrides).parameters[0].example).toBe(
      "temporary",
    );
    expect(debugRequest(definition, overrides).auth.token).toBe("local-token");
    expect(definition).toEqual(before);
    expect(debugRequest(definition, {})).toEqual(before);
  });
  it("follows later definition changes, restores history only as request values, and never replaces response contracts", () => {
    const definition = newApiEndpoint("one"),
      history = structuredClone(definition);
    history.path = "/old";
    history.responses[0].example = "historical response";
    history.auth.token = "historical value";
    const overrides = debugOverrides(definition, history);
    const updated = {
      ...definition,
      name: "new name",
      responses: [{ ...definition.responses[0], example: "current contract" }],
    };
    expect(debugRequest(updated, overrides)).toMatchObject({
      name: "new name",
      path: "/old",
      auth: { token: "historical value" },
      responses: [{ example: "current contract" }],
    });
    expect(debugOverrides(definition, structuredClone(definition))).toEqual({});
  });
});
