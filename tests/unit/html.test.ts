import { describe, expect, it } from "vitest";
import { htmlToText, MAX_PASTE_CHARS, parseBill } from "../../src/domain/parse";
import { canonical } from "../../src/domain/workbook";
import { rawRefs, rawText } from "./helpers";

/** Render a saved bill's text as plausible HTML: table lines → <tr><td>, everything else → paragraphs. */
const asHtml = (text: string): string => {
  const rows = text
    .split("\n")
    .map((l) => {
      if (/^\|[\s|-]*\|$/.test(l.trim())) return "";
      if (l.startsWith("|"))
        return `<tr>${l
          .split("|")
          .slice(1, -1)
          .map((c) => `<td>${c.trim().replace(/&/g, "&amp;")}</td>`)
          .join("")}</tr>`;
      return `<p>${l.replace(/&/g, "&amp;")}</p>`;
    })
    .join("\n");
  return `<html><head><title>x</title><style>.a{}</style><script>var a=1<2</script></head><body><table>${rows}</table></body></html>`;
};

describe("US-01 pasted page source is converted without interpreting it as markup", () => {
  it("parses to the same bill as the saved text, for all 21 saved e-bills", () => {
    for (const ref of rawRefs()) {
      const fromText = parseBill(rawText(ref), ref);
      const fromHtml = parseBill(htmlToText(asHtml(rawText(ref))), ref);
      // rawText differs (it keeps what was pasted); everything that was read must be identical
      expect(canonical({ ...fromHtml, rawText: undefined }), ref).toBe(
        canonical({ ...fromText, rawText: undefined }),
      );
    }
  });
  it("leaves plain text alone", () => {
    const t = rawText("FYQQRQ");
    expect(htmlToText(t)).toBe(t);
  });
  it("drops scripts, styles, head and comments with their contents", () => {
    const out = htmlToText(
      "<html><head><title>T</title></head><body><!-- c --><script>alert(1)</script><style>p{}</style><p>kept</p></body></html>",
    );
    expect(out.trim()).toBe("kept");
    expect(out).not.toMatch(/alert|title|\bT\b|p\{/);
  });
  it("turns table rows into pipe rows, collapsing whitespace and nested tags", () => {
    expect(htmlToText("<table><tr><th> Item </th><td><b>Net</b>   Amount</td></tr></table>").trim()).toBe(
      "| Item | Net Amount |",
    );
  });
  it("breaks lines at block ends and <br>", () => {
    expect(htmlToText("<div>a</div><p>b</p>c<br/>d<br>e").split("\n").filter(Boolean)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
  it("decodes the common entities, numeric ones, and leaves unknown ones as written", () => {
    expect(
      htmlToText(
        "<p>A &amp; B &lt;x&gt; &quot;q&quot; &#39;s&#39; &#x41; &nbsp;end &bogus; &#0; &#99999999;</p>",
      ).trim(),
    ).toBe("A & B <x> \"q\" 's' A  end &bogus; &#0; &#99999999;");
  });
  it("does not decode twice: &amp;lt; is the text &lt;, not <", () => {
    expect(htmlToText("<p>&amp;lt;</p>").trim()).toBe("&lt;");
  });
  it("never returns markup: the output has no tags to reinterpret", () => {
    const hostile =
      '<p onclick="x()">hi<img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a></p><svg onload=alert(1)>';
    const out = htmlToText(hostile);
    expect(out).not.toMatch(/<|>/);
    expect(out).toContain("hi");
    expect(out).toContain("link");
  });
  it("refuses an absurdly large paste", () => {
    expect(() => htmlToText("<p>" + "x".repeat(MAX_PASTE_CHARS) + "</p>")).toThrow(/too large/);
  });
  it("copes with unbalanced and malformed tags without hanging", () => {
    const t0 = performance.now();
    htmlToText("<tr><td>a<td>b" + "<script".repeat(2000) + "<p>".repeat(2000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
