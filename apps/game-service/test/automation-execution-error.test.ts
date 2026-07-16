import { describe, expect, it } from "vitest";
import { AutomationExecutionError } from "../src/contexts/automation/application/automation-execution-error.js";

describe("AutomationExecutionError", () => {
  it("carries an application code without transport metadata", () => {
    const error = new AutomationExecutionError(
      "AUTOMATION_ACTION_REJECTED",
      "Automation action was rejected",
    );

    expect(error).toMatchObject({
      code: "AUTOMATION_ACTION_REJECTED",
      message: "Automation action was rejected",
      name: "AutomationExecutionError",
    });
    expect(error).not.toHaveProperty("statusCode");
  });
});
