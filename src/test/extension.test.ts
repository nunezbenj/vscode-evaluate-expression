import * as assert from "assert";
import { dedent } from "../extension";

describe("dedent (extension.ts)", () => {
    it("removes common leading whitespace", () => {
        assert.strictEqual(dedent("    a\n    b"), "a\nb");
    });

    it("preserves relative indentation", () => {
        assert.strictEqual(dedent("    a\n        b"), "a\n    b");
    });

    it("normalizes tabs to 4 spaces before dedenting", () => {
        assert.strictEqual(dedent("\ta\n\t\tb"), "a\n    b");
    });

    it("returns as-is when no common indent", () => {
        assert.strictEqual(dedent("a\n    b"), "a\n    b");
    });

    it("ignores empty lines when computing indent", () => {
        assert.strictEqual(dedent("    a\n\n    b"), "a\n\nb");
    });

    it("handles single indented line", () => {
        assert.strictEqual(dedent("        hello"), "hello");
    });

    it("handles empty string", () => {
        assert.strictEqual(dedent(""), "");
    });

    it("handles all-whitespace input", () => {
        const result = dedent("   \n   ");
        assert.strictEqual(result, "   \n   ");
    });
});
