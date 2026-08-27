import * as assert from "assert";
import {
    normalizeWhitespace,
    dedentCode,
    findLastNonEmptyLineIndex,
    looksLikeBareExpression,
    wrapSnippet,
    wrapPythonSnippet,
    wrapJavaScriptSnippet,
    getLanguageForSessionType,
} from "../dap";

describe("normalizeWhitespace", () => {
    it("converts \\r\\n to \\n", () => {
        assert.strictEqual(normalizeWhitespace("a\r\nb"), "a\nb");
    });

    it("converts bare \\r to \\n", () => {
        assert.strictEqual(normalizeWhitespace("a\rb"), "a\nb");
    });

    it("converts tabs to 4 spaces", () => {
        assert.strictEqual(normalizeWhitespace("\tx"), "    x");
    });

    it("trims trailing whitespace per line", () => {
        assert.strictEqual(normalizeWhitespace("a   \nb  "), "a\nb");
    });

    it("handles mixed issues in one pass", () => {
        assert.strictEqual(normalizeWhitespace("\ta\r\n  b  \r"), "    a\n  b\n");
    });

    it("preserves empty string", () => {
        assert.strictEqual(normalizeWhitespace(""), "");
    });
});

describe("dedentCode", () => {
    it("removes common leading whitespace", () => {
        assert.strictEqual(dedentCode("    a\n    b"), "a\nb");
    });

    it("preserves relative indentation", () => {
        assert.strictEqual(dedentCode("    a\n        b"), "a\n    b");
    });

    it("ignores empty lines when computing indent", () => {
        assert.strictEqual(dedentCode("    a\n\n    b"), "a\n\nb");
    });

    it("returns as-is when no common indent", () => {
        assert.strictEqual(dedentCode("a\n    b"), "a\n    b");
    });

    it("returns as-is for all-empty input", () => {
        assert.strictEqual(dedentCode("\n\n"), "\n\n");
    });

    it("handles single line", () => {
        assert.strictEqual(dedentCode("    hello"), "hello");
    });
});

describe("findLastNonEmptyLineIndex", () => {
    it("finds the last non-empty line", () => {
        assert.strictEqual(findLastNonEmptyLineIndex(["a", "b", ""]), 1);
    });

    it("skips trailing whitespace-only lines", () => {
        assert.strictEqual(findLastNonEmptyLineIndex(["a", "  ", "\t"]), 0);
    });

    it("returns -1 for all-empty lines", () => {
        assert.strictEqual(findLastNonEmptyLineIndex(["", "  ", ""]), -1);
    });

    it("returns 0 for single non-empty line", () => {
        assert.strictEqual(findLastNonEmptyLineIndex(["x"]), 0);
    });
});

describe("looksLikeBareExpression", () => {
    it("recognizes a bare function call", () => {
        assert.strictEqual(looksLikeBareExpression("foo()"), true);
    });

    it("recognizes a bare variable name", () => {
        assert.strictEqual(looksLikeBareExpression("x"), true);
    });

    it("recognizes an attribute access", () => {
        assert.strictEqual(looksLikeBareExpression("obj.attr"), true);
    });

    it("recognizes arithmetic expression", () => {
        assert.strictEqual(looksLikeBareExpression("a + b"), true);
    });

    it("rejects assignment", () => {
        assert.strictEqual(looksLikeBareExpression("x = 5"), false);
    });

    it("rejects augmented assignment", () => {
        assert.strictEqual(looksLikeBareExpression("x += 1"), false);
    });

    it("rejects return statement", () => {
        assert.strictEqual(looksLikeBareExpression("return x"), false);
    });

    it("rejects for loop", () => {
        assert.strictEqual(looksLikeBareExpression("for i in range(10):"), false);
    });

    it("rejects import", () => {
        assert.strictEqual(looksLikeBareExpression("import os"), false);
    });

    it("rejects class definition", () => {
        assert.strictEqual(looksLikeBareExpression("class Foo:"), false);
    });

    it("rejects def statement", () => {
        assert.strictEqual(looksLikeBareExpression("def foo():"), false);
    });

    it("rejects print call as statement", () => {
        assert.strictEqual(looksLikeBareExpression("print(x)"), false);
    });

    it("rejects empty/whitespace line", () => {
        assert.strictEqual(looksLikeBareExpression(""), false);
        assert.strictEqual(looksLikeBareExpression("   "), false);
    });

    it("handles indented expression", () => {
        assert.strictEqual(looksLikeBareExpression("    foo()"), true);
    });

    it("rejects indented assignment", () => {
        assert.strictEqual(looksLikeBareExpression("    x = 5"), false);
    });

    it("allows == comparison (not assignment)", () => {
        assert.strictEqual(looksLikeBareExpression("x == 5"), true);
    });

    it("allows != comparison", () => {
        assert.strictEqual(looksLikeBareExpression("x != 5"), true);
    });
});

describe("getLanguageForSessionType", () => {
    it("maps 'python' to python", () => {
        assert.strictEqual(getLanguageForSessionType("python"), "python");
    });

    it("maps 'debugpy' to python", () => {
        assert.strictEqual(getLanguageForSessionType("debugpy"), "python");
    });

    it("maps 'node' to javascript", () => {
        assert.strictEqual(getLanguageForSessionType("node"), "javascript");
    });

    it("maps 'pwa-node' to javascript", () => {
        assert.strictEqual(getLanguageForSessionType("pwa-node"), "javascript");
    });

    it("maps 'chrome' to javascript", () => {
        assert.strictEqual(getLanguageForSessionType("chrome"), "javascript");
    });

    it("maps 'pwa-chrome' to javascript", () => {
        assert.strictEqual(getLanguageForSessionType("pwa-chrome"), "javascript");
    });

    it("maps 'cppdbg' to cpp", () => {
        assert.strictEqual(getLanguageForSessionType("cppdbg"), "cpp");
    });

    it("maps 'cppvsdbg' to cpp", () => {
        assert.strictEqual(getLanguageForSessionType("cppvsdbg"), "cpp");
    });

    it("defaults unknown types to python", () => {
        assert.strictEqual(getLanguageForSessionType("whatever"), "python");
    });
});

describe("wrapSnippet", () => {
    it("returns code as-is in expression mode", () => {
        assert.strictEqual(wrapSnippet("x + 1", "expression", "python"), "x + 1");
    });

    it("returns code as-is in expression mode regardless of session type", () => {
        assert.strictEqual(wrapSnippet("x + 1", "expression", "node"), "x + 1");
    });

    it("wraps Python code in statements mode", () => {
        const result = wrapSnippet("x + 1", "statements", "python");
        assert.ok(result.includes("def __eval__():"));
        assert.ok(result.includes("return x + 1"));
    });

    it("wraps JavaScript code in IIFE in statements mode", () => {
        const result = wrapSnippet("x + 1", "statements", "node");
        assert.ok(result.includes("(() => {"));
        assert.ok(result.includes("})()"));
    });

    it("returns code as-is for unknown language in statements mode", () => {
        const result = wrapSnippet("x + 1", "statements", "cppdbg");
        assert.strictEqual(result, "x + 1");
    });
});

describe("wrapPythonSnippet", () => {
    it("wraps a simple expression with return", () => {
        const result = wrapPythonSnippet("x + 1");
        assert.strictEqual(result, "def __eval__():\n    return x + 1\n__eval_result__ = __eval__()");
    });

    it("does not add return to an assignment", () => {
        const result = wrapPythonSnippet("x = 5");
        assert.strictEqual(result, "def __eval__():\n    x = 5\n__eval_result__ = __eval__()");
    });

    it("does not add return when last line is indented (nested block)", () => {
        const code = "for i in range(3):\n    tok.step()";
        const result = wrapPythonSnippet(code);
        assert.ok(!result.includes("return tok.step()"), "should NOT inject return into nested line");
        assert.ok(result.includes("        tok.step()"), "nested line should be double-indented");
    });

    it("adds return to a top-level expression after a block", () => {
        const code = "for i in range(3):\n    pass\nresult";
        const result = wrapPythonSnippet(code);
        assert.ok(result.includes("return result"));
    });

    it("handles dedenting indented input", () => {
        const code = "    x = 1\n    x + 1";
        const result = wrapPythonSnippet(code);
        assert.ok(result.includes("return x + 1"));
    });

    it("normalizes tabs", () => {
        const code = "\tx = 1";
        const result = wrapPythonSnippet(code);
        assert.ok(result.includes("    x = 1"));
    });
});

describe("wrapJavaScriptSnippet", () => {
    it("wraps in an IIFE", () => {
        const result = wrapJavaScriptSnippet("42");
        assert.ok(result.startsWith("(() => {"));
        assert.ok(result.endsWith("})()"));
    });

    it("adds return to a bare expression on the last line", () => {
        const result = wrapJavaScriptSnippet("x + 1");
        assert.ok(result.includes("return x + 1"));
    });

    it("does not add return to a const declaration", () => {
        const result = wrapJavaScriptSnippet("const x = 5");
        assert.ok(!result.includes("return const"));
    });

    it("does not add return to a let declaration", () => {
        const result = wrapJavaScriptSnippet("let x = 5");
        assert.ok(!result.includes("return let"));
    });

    it("does not add return to a line ending with semicolon", () => {
        const result = wrapJavaScriptSnippet("doSomething();");
        assert.ok(!result.includes("return doSomething()"));
    });

    it("does not add return to an if statement", () => {
        const result = wrapJavaScriptSnippet("if (true) { }");
        assert.ok(!result.includes("return if"));
    });

    it("handles multi-line code", () => {
        const code = "const x = 1\nx + 1";
        const result = wrapJavaScriptSnippet(code);
        assert.ok(result.includes("const x = 1"));
        assert.ok(result.includes("return x + 1"));
    });
});

// ---- v1.4.0: planner tests ----
import { planPythonSnippet, prepareJavaScriptSnippet, cleanPythonTraceback, buildPythonOutputHarness, stripHarnessFrames } from "../dap";

describe("planPythonSnippet", () => {
    it("single expression becomes empty body + tail", () => {
        const p = planPythonSnippet("x + 1");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "");
        assert.strictEqual(p.tail, "x + 1");
    });

    it("assignment-only snippet has no tail", () => {
        const p = planPythonSnippet("x = 5\ny = x * 2");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "x = 5\ny = x * 2");
        assert.strictEqual(p.tail, undefined);
    });

    it("statements ending in bare expression split into body + tail", () => {
        const p = planPythonSnippet("x = 5\nx * 2");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "x = 5");
        assert.strictEqual(p.tail, "x * 2");
    });

    it("trailing top-level return is stripped into tail", () => {
        const p = planPythonSnippet("x = 5\nreturn x * 2");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "x = 5");
        assert.strictEqual(p.tail, "x * 2");
    });

    it("mid-block top-level return falls back to wrapper", () => {
        const p = planPythonSnippet("return 1\nx = 5");
        assert.strictEqual(p.kind, "wrapper");
        assert.ok(p.wrapped!.includes("def __eval__():"));
    });

    it("indented return without def falls back to wrapper", () => {
        const p = planPythonSnippet("if x:\n    return 1\ny = 2");
        assert.strictEqual(p.kind, "wrapper");
    });

    it("indented return inside user def stays direct", () => {
        const p = planPythonSnippet("def f():\n    return 1\nf()");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.tail, "f()");
    });

    it("does not split tail when brackets are unbalanced", () => {
        const code = "x = foo(\n    1,\n    2,\n)";
        const p = planPythonSnippet(code);
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.tail, undefined);
        assert.strictEqual(p.body, code);
    });

    it("does not split tail after line continuation", () => {
        const p = planPythonSnippet("x = 1 + \\\n2");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.tail, undefined);
    });

    it("loop ending with expression splits correctly", () => {
        const p = planPythonSnippet("for i in range(3):\n    total += i\ntotal");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "for i in range(3):\n    total += i");
        assert.strictEqual(p.tail, "total");
    });

    it("indented final line is not split into tail", () => {
        const p = planPythonSnippet("if x:\n    y = 1\n    y");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.tail, undefined);
    });

    it("dedents uniformly indented snippets", () => {
        const p = planPythonSnippet("    x = 5\n    x");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body, "x = 5");
        assert.strictEqual(p.tail, "x");
    });

    it("empty input yields empty direct plan", () => {
        const p = planPythonSnippet("\n\n");
        assert.strictEqual(p.kind, "direct");
        assert.strictEqual(p.body ?? "", "");
    });
});

describe("prepareJavaScriptSnippet", () => {
    it("plain statements pass through unwrapped", () => {
        assert.strictEqual(prepareJavaScriptSnippet("let x = 5;\nx * 2"), "let x = 5;\nx * 2");
    });

    it("top-level return without function gets IIFE", () => {
        const out = prepareJavaScriptSnippet("return 42");
        assert.ok(out.startsWith("(() => {"));
    });

    it("return inside user function stays unwrapped", () => {
        const code = "function f() {\n    return 1;\n}\nf()";
        assert.strictEqual(prepareJavaScriptSnippet(code), code);
    });
});

describe("cleanPythonTraceback", () => {
    const raw = [
        "Traceback (most recent call last):",
        '  File "c:\\Users\\bn408100\\.vscode\\extensions\\ms-python.debugpy-2026.6.0-win32-x64\\bundled\\libs\\debugpy\\_vendored\\pydevd\\_pydevd_bundle\\pydevd_comm.py", line 1245, in internal_evaluate_expression_json',
        "    pydevd_vars.evaluate_expression(py_db, frame, expression, is_exec=True)",
        '  File "c:\\...\\debugpy\\_vendored\\pydevd\\_pydevd_bundle\\pydevd_vars.py", line 369, in new_func',
        "    return _run_with_unblock_threads(original_func, py_db, curr_thread, frame, expression, is_exec)",
        "           ^^^^^^^^^^^^^^^^^^^^^^^^^",
        '  File "<string>", line 2, in <module>',
        "NameError: name 'foo' is not defined",
    ].join("\n");

    it("drops debugger-internal frames, keeps user frame and exception", () => {
        const out = cleanPythonTraceback(raw);
        assert.ok(!out.includes("pydevd_comm.py"));
        assert.ok(!out.includes("_run_with_unblock_threads"));
        assert.ok(!out.includes("^^^"));
        assert.ok(out.includes('File "<string>", line 2'));
        assert.ok(out.includes("NameError: name 'foo' is not defined"));
        assert.ok(out.includes("2 debugger-internal frames hidden"));
    });

    it("returns non-traceback errors unchanged", () => {
        assert.strictEqual(cleanPythonTraceback("SyntaxError: invalid syntax"), "SyntaxError: invalid syntax");
        assert.strictEqual(cleanPythonTraceback("Timed out"), "Timed out");
    });

    it("keeps exception when all frames are internal", () => {
        const allInternal = [
            "Traceback (most recent call last):",
            '  File "/x/debugpy/_vendored/pydevd/pydevd.py", line 1, in f',
            "    do()",
            "ZeroDivisionError: division by zero",
        ].join("\n");
        const out = cleanPythonTraceback(allInternal);
        assert.ok(out.includes("ZeroDivisionError"));
        assert.ok(!out.includes("pydevd.py"));
        assert.ok(!out.startsWith("Traceback"));
    });
});

describe("buildPythonOutputHarness / stripHarnessFrames", () => {
    it("embeds user code as a safe literal, tries eval first, stashes payload", () => {
        const h = buildPythonOutputHarness('print("a\\"b")\nx = 1');
        assert.ok(h.includes("redirect_stdout"));
        assert.ok(h.includes("'<evaluate>', 'eval'"));
        assert.ok(h.includes("'<evaluate>', 'exec'"));
        assert.ok(h.includes("__ebi.__eval_payload__"));
        assert.ok(h.includes("[output truncated]"));
    });

    it("strips only the harness exec frame from tracebacks", () => {
        const tb = [
            "Traceback (most recent call last):",
            '  File "<string>", line 12, in <module>',
            "    exec(compile(\"print(1/0)\", '<evaluate>', 'exec'))",
            '  File "<string>", line 10, in <module>',
            "    __eres = repr(eval(__ecode))",
            '  File "<evaluate>", line 1, in <module>',
            "ZeroDivisionError: division by zero",
        ].join("\n");
        const out = stripHarnessFrames(tb);
        assert.ok(!out.includes("exec(compile"));
        assert.ok(!out.includes("repr(eval"));
        assert.ok(out.includes('File "<evaluate>", line 1'));
        assert.ok(out.includes("ZeroDivisionError"));
    });
});
