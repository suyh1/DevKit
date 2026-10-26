import { checkApiSchema } from "./api-schema-validation";
import type { Schema } from "@cfworker/json-schema";
self.onmessage = (
  event: MessageEvent<{
    schema: Schema | boolean;
    body: string;
    checks?: { name: string; schema: Schema | boolean; body: string }[];
  }>,
) => {
  if (event.data.checks) {
    for (const item of event.data.checks) {
      const result = checkApiSchema(item.schema, item.body);
      if (result.state !== "pass") {
        self.postMessage({
          ...result,
          detail: `${item.name}：${result.detail}`,
        });
        return;
      }
    }
    self.postMessage({
      name: "请求Schema",
      state: "pass",
      detail: "请求参数和正文Schema检查通过。",
    });
  } else self.postMessage(checkApiSchema(event.data.schema, event.data.body));
};
