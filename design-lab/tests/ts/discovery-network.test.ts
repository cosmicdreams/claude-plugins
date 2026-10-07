import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as compositions from "../../src/extract-compositions.ts";
import * as voice from "../../src/extract-voice.ts";
import * as examples from "../../src/find-examples.ts";
import * as rendered from "../../src/find-rendered-components.ts";
import * as published from "../../src/published-pages.ts";
import * as usage from "../../src/extract-drupal-usage.ts";
import { parseHtml, unescape } from "../../src/html-parser.ts";
import type { Page } from "../../src/find-rendered-components.ts";

type Dict = Record<string, any>;
const temp = (): string => mkdtempSync(join(tmpdir(), "design-lab-p3-"));
const events = (html: string): unknown[] => {
  const out: unknown[] = [];
  parseHtml(html, {
    starttag: (t, a) => out.push(["s", t, a]),
    startendtag: (t, a) => out.push(["se", t, a]),
    endtag: (t) => out.push(["e", t]),
    data: (d) => out.push(["d", d]),
  });
  return out;
};

// ---- the HTML tokenizer, against the event streams baseline 3.14's HTMLParser produced ----
test("HTML tokenizer reproduces baseline html.parser events", () => {
  assert.deepEqual(
    events('<p class="a&amp;b" hidden data-x="1"/>x &lt; y<br>'),
    [
      [
        "se",
        "p",
        [
          ["class", "a&b"],
          ["hidden", null],
          ["data-x", "1"],
        ],
      ],
      ["d", "x < y"],
      ["s", "br", []],
    ],
  );
  assert.deepEqual(events("a < b"), [
    ["d", "a "],
    ["d", "<"],
    ["d", " b"],
  ]); // a bare "<" is its own chunk
  assert.deepEqual(
    events("<title>A &amp; <b>B</title><script>if (a<b) {}</script>"),
    [
      ["s", "title", []],
      ["d", "A & <b>B"],
      ["e", "title"],
      ["s", "script", []],
      ["d", "if (a<b) {}"],
      ["e", "script"],
    ],
  );
  assert.deepEqual(
    events("<!DOCTYPE html><!-- c --><?pi x?><![CDATA[y]]><!bogus>z"),
    [["d", "z"]],
  );
  assert.deepEqual(events("<DIV CLASS=Q>t</DIV >"), [
    ["s", "div", [["class", "Q"]]],
    ["d", "t"],
    ["e", "div"],
  ]);
  assert.deepEqual(events('keep<div class="open'), [["d", "keep"]]); // input that ends inside a tag is dropped, as feed() without close()
  assert.deepEqual(events("<plaintext><b>x"), [
    ["s", "plaintext", []],
    ["d", "<b>x"],
  ]);
  assert.deepEqual(events('<a href="x&amp;y&copy=1&copy;">'), [
    ["s", "a", [["href", "x&y&copy=1©"]]],
  ]);
});
test("html.unescape follows the HTML5 rules", () => {
  assert.equal(
    unescape(
      "&amp; &AMP &notit; &#65;&#x42; &#128; &#0; &#xD800; &nosuch; &lt",
    ),
    "& & ¬it; AB € � � &nosuch; <",
  );
});

// ---- rendered components ----
test("rendered markers, public paths and example fallback", () => {
  const html =
    "<div data-component-id='demo:site-header'></div><section data-component-id='demo:photo-slide'><img data-component-id='demo:photo-slide'></section>";
  assert.deepEqual(rendered.parseComponents(html), {
    "demo:site-header": 1,
    "demo:photo-slide": 2,
  });
  assert.deepEqual(
    rendered.publicPaths(
      [
        ["/node/9", "/nine"],
        ["/page/2", "/resources"],
        ["/page/1", "/home"],
        ["/node/2", "/two"],
      ],
      3,
    ),
    ["/home", "/resources", "/two"],
  );
  assert.throws(() => rendered.publicPaths([], 0), /positive/);
  const components = {
    components: [
      { id: "sdc.demo.photo-slide", sourceSdcId: "demo:photo-slide" },
    ],
  };
  const evidence = rendered.summarizePages(
    [
      ["/b", 200, html],
      ["/a", 200, html],
      ["/offline", 0, html],
    ],
    components,
  );
  assert.equal(evidence["sdc.demo.photo-slide"]!["renderedInstances"], 4);
  const generic = {
    components: [
      {
        id: "photo-slide",
        sourceRef:
          "web/themes/custom/demo/components/photo-slide/photo-slide.component.yml",
      },
    ],
  };
  assert.equal(
    rendered.summarizePages([["/a", 200, html]], generic)["photo-slide"]![
      "renderedInstances"
    ],
    2,
  );
  const document: Dict = {
    source: {},
    usage: {
      "sdc.demo.photo-slide": {
        placements: 0,
        structuralRefs: 0,
        pages: 0,
        exampleCandidates: [],
      },
    },
  };
  rendered.enrichUsage(document, evidence, { baseUrl: "https://example.test" });
  assert.deepEqual(
    document["usage"]["sdc.demo.photo-slide"].exampleCandidates,
    ["/a", "/b"],
  );
  assert.equal(
    document["source"].renderedVerification.baseUrl,
    "https://example.test",
  );
});

test("a scan asks ddev for Canvas and node aliases, fetches at most the limit, and lists failures", async () => {
  const calls: string[][] = [];
  const run: usage.Runner = (_command, args) => {
    calls.push(args);
    return {
      status: 0,
      stdout: "/page/1\t/home\n/node/2\t/two\n/node/3\t/three\n",
      stderr: "",
    };
  };
  const html = '<div data-component-id="demo:a"></div>';
  const [evidence, details] = await rendered.scan(
    "https://x.test",
    tmpdir(),
    { components: [{ id: "a", sourceSdcId: "demo:a" }] },
    2,
    {
      run,
      fetch: async (_base, path) => [
        path,
        path === "/two" ? 500 : 200,
        path === "/two" ? "" : html,
      ],
    },
  );
  assert.deepEqual(calls[0]!.slice(0, 2), ["drush", "sqlq"]);
  assert.match(calls[0]![2]!, /REGEXP '\^\/\(page\|node\)\/\[0-9\]\+\$'/);
  assert.deepEqual(details, {
    baseUrl: "https://x.test",
    pathsSelected: 2,
    pagesFetched: 1,
    pathsFailed: ["/two"],
  });
  assert.equal(evidence["a"]!["renderedPages"], 1);
});

// ---- compositions ----
test("nested components are excluded and void elements keep the outer order", () => {
  const html =
    '<html><head><title>  One &amp; Two </title><meta name="x"></head><body><div data-component-id="outer"><img><div data-component-id="inner"></div></div><div data-component-id="next"></div><div data-component-id="outer"></div></body></html>';
  assert.deepEqual(compositions.parsePage(html), {
    title: "One & Two",
    components: ["outer", "next", "outer"],
  });
});
test("composition page and component order is stable", () => {
  const pages: Page[] = [
    ["/z", 200, '<title>Z</title><div data-component-id="b"></div>'],
    [
      "/a",
      200,
      '<title>A</title><div data-component-id="b"></div><div data-component-id="a"></div>',
    ],
    ["/x", 500, ""],
  ];
  const first = compositions.buildCompositions(pages),
    second = compositions.buildCompositions([...pages].reverse());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.components, { a: ["/a"], b: ["/a", "/z"] });
  assert.deepEqual(first.pagesFailed, ["/x"]);
  assert.deepEqual(
    first.pages.map((page) => page.address),
    ["/a", "/z"],
  );
});

// ---- voice ----
const HOME = `<html><head><title>Welcome to North Star</title><meta name="description" content="Join North Star"></head>
<body><header><h1>Hidden Site Heading</h1></header><main><h1>Find Your Path</h1>
<p>You can join North Star today. Your next step begins here.</p><p>North Star helps every neighbor.</p>
<a href="/join">Join Now</a><button>LEARN MORE</button><ul><li>First item</li></ul></main>
<footer>Ignore this</footer></body></html>`;
const SECOND =
  "<html><head><title>Programs at North Star</title></head><body><main><h1>Find your path</h1><p>We help North Star members. You can visit North Star.</p><a>Learn more</a></main></body></html>";
const THIRD =
  '<html><head><title>Contact North Star</title><meta name="description" content="Contact us"></head><body><main><p>North-Star members can apply today.</p><a>Apply Now</a></main></body></html>';
const AT = "2026-09-23T12:00:00+00:00";

test("the voice parser uses main and preserves authored labels", () => {
  const page = voice.parsePage(HOME);
  assert.deepEqual(page.headings["1"], ["Find Your Path"]);
  assert.deepEqual(page.labels, ["Join Now", "LEARN MORE"]);
  assert.ok(!page.text.includes("Ignore this"));
  assert.ok(!page.text.includes("Hidden Site Heading"));
  assert.equal(page.description, "Join North Star");
});
test("the voice reducer reports the core sections and is stable", () => {
  const pages: Page[] = [
    ["/third", 200, THIRD],
    ["/", 200, HOME],
    ["/bad", 404, ""],
    ["/second", 200, SECOND],
  ];
  const first = voice.buildVoice(pages, "North Star", AT),
    second = voice.buildVoice([...pages].reverse(), "North Star", AT);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first["positioning"].address, "/");
  assert.equal(first["corpus"].pagesFetched, 3);
  assert.deepEqual(first["corpus"].pagesFailed, ["/bad"]);
  assert.equal(first["evidence"].allCapsCallToActionShare.numerator, 1);
  assert.deepEqual(first["headlines"].noH1, ["/third"]);
  assert.equal(first["nameForms"].multipleForms, true);
  assert.ok(
    first["rules"].every(
      (row: Dict) =>
        row.evidence.quotes.length <= 2 && "numerator" in row.evidence,
    ),
  );
  assert.deepEqual(
    new Set(
      first["rules"]
        .filter((row: Dict) => row.kind === "OBSERVED")
        .map((row: Dict) => row.section),
    ),
    new Set([
      "Voice",
      "Naming & terminology",
      "Headlines",
      "Calls to action",
      "Readability",
      "Search",
    ]),
  );
  assert.equal(first["stats"].length, 5);
  assert.ok(
    first["stats"].every(
      (tile: Dict) =>
        Object.keys(tile).sort().join() === "label,qualifier,value" &&
        typeof tile.value === "string",
    ),
  );
  assert.equal(first["corpus"].fetchDate, "2026-09-23");
});
test("positioning skips statistics and uses long paragraphs, then falls back to long prose sentences", () => {
  const html = `<body><main><h1>Welcome to the community</h1><div class="stats"><p>20+</p><p>20</p></div>
    <p>Our students work together to build robots for the community.</p>
    <figure><p>This caption has enough words to appear but is not body prose.</p></figure>
    <p>Every season gives new members a chance to learn and lead.</p></main></body>`;
  assert.deepEqual(
    voice.buildVoice([["/", 200, html]], "Community", AT)["positioning"]
      .paragraphs,
    [
      "Our students work together to build robots for the community.",
      "Every season gives new members a chance to learn and lead.",
    ],
  );
  const prose =
    "<body><main><h1>Welcome</h1><p>20+</p><blockquote>Students design robots together and share what they learn. New members can practice skills with experienced teammates.</blockquote></main></body>";
  assert.deepEqual(
    voice.buildVoice([["/", 200, prose]], "Team", AT)["positioning"].paragraphs,
    [
      "Students design robots together and share what they learn.",
      "New members can practice skills with experienced teammates.",
    ],
  );
});
test("templated data does not enter the vocabulary", () => {
  const robot =
    '<body class="page-node-type-robot"><main><h1>Robot archive</h1><table><tr><th>Quick Facts Name</th><td>Size X X</td><td>Weight LBS</td></tr></table><p>Students build creative machines together every season.</p></main></body>';
  const article =
    '<body class="page-node-type-article"><main><h1>Our team</h1><p>Students build creative machines together every season.</p></main></body>';
  const pages: Page[] = [2022, 2023, 2024].map(
    (year) => [`/${year}-robot`, 200, robot] as Page,
  );
  pages.push(["/team", 200, article]);
  const phrases = new Set(
    voice
      .buildVoice(pages, "Team", AT)
      ["vocabulary"].phrases.map((item: Dict) => item.phrase),
  );
  assert.ok(phrases.has("students build creative"));
  assert.ok(
    ![...phrases].some((phrase) =>
      /size|weight|quick facts/.test(String(phrase)),
    ),
  );
  assert.deepEqual(
    voice.buildVoice(pages.slice(0, -1), "Team", AT)["vocabulary"].phrases,
    [],
  ); // one template alone is not a house style
});
test("the body is the fallback when there is no main, and navigation is excluded", () => {
  assert.equal(
    voice.parsePage(
      "<body><nav>Navigation</nav><p>Useful copy.</p><footer>End</footer></body>",
    ).text,
    "Useful copy.",
  );
});
test("voice numbers use baseline formatting and rounding", () => {
  assert.deepEqual(
    [0, 14, 12.5, 0.00001, 123456.7, 1234567, -3.4, 100].map(voice.formatG),
    ["0", "14", "12.5", "1e-05", "123457", "1.23457e+06", "-3.4", "100"],
  );
  assert.equal(voice.percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(voice.percentile([], 0.5), 0);
  assert.deepEqual(
    ["table", "the", "banana", "rhythm"].map(voice.syllables),
    [2, 1, 3, 1],
  );
  assert.equal(voice.grade("The cat sat. The dog ran."), -2.62);
});

// ---- published pages ----
test("project config and bounded homepage addresses", () => {
  const root = temp(),
    repo = join(root, "repo");
  mkdirSync(join(repo, "config", "sync"), { recursive: true });
  writeFileSync(
    join(repo, "config", "sync", "system.site.yml"),
    "name: 'North Star'\npage:\n  front: /node/2\n",
  );
  writeFileSync(
    join(root, "project.json"),
    JSON.stringify({ repository: { root: repo } }),
  );
  const config = published.siteConfig(root);
  assert.equal(config.name, "North Star");
  assert.equal(config.front, "/node/2");
  assert.ok(config.root.endsWith("/repo"));
  const aliases = [
    ["/node/3", "/other"],
    ["/node/2", "/welcome"],
  ];
  assert.deepEqual(
    published.addresses(repo, config.front, 2, () => aliases),
    ["/", "/welcome"],
  );
  assert.throws(
    () => published.addresses(repo, "/", 0, () => aliases),
    /positive/,
  );
});
test("two addresses serving the same page count once, under the shortest address", async () => {
  const main = (token: string): string =>
    `<html><body><nav class="x">m</nav><main><div class="a ${token}" id="${token}">Same page</div></main></body></html>`;
  const pages = await published.fetchPages(
    "https://x.test",
    ["/home", "/", "/other", "/home"],
    async (_base, path): Promise<Page> => [
      path,
      path === "/other" ? 404 : 200,
      path === "/other" ? "" : main(path === "/" ? "one" : "two"),
    ],
  );
  assert.deepEqual(
    pages.map((page) => page[0]),
    ["/", "/other"],
  );
});

// ---- real HTTP ----
async function withServer(
  handler: Parameters<typeof createServer>[1],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
test("fetchPage follows redirects, reports other statuses with an empty body, and never throws", async () => {
  const seen: Array<string | undefined> = [];
  await withServer(
    (req, res) => {
      seen.push(req.headers["user-agent"]);
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/ok" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" });
        res.end();
      } else if (req.url === "/ok") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("café");
      } else {
        res.writeHead(404);
        res.end("missing");
      }
    },
    async (base) => {
      assert.deepEqual(await rendered.fetchPage(base, "/redirect"), [
        "/redirect",
        200,
        "café",
      ]);
      assert.deepEqual(await rendered.fetchPage(base + "/", "ok"), [
        "ok",
        200,
        "café",
      ]);
      assert.deepEqual(await rendered.fetchPage(base, "/nope"), [
        "/nope",
        404,
        "",
      ]);
      assert.deepEqual(await rendered.fetchPage(base, "/loop"), [
        "/loop",
        302,
        "",
      ]);
      assert.deepEqual(await usage.fetchPage(base + "/nope"), [404, ""]);
    },
  );
  assert.ok(seen.every((agent) => agent === "design-lab/0.14"));
  assert.deepEqual(await rendered.fetchPage("http://127.0.0.1:1", "/x"), [
    "/x",
    0,
    "",
  ]); // nothing listens: status 0, not an exception
});
test("an idle connection times out", async () => {
  await withServer(
    () => {
      /* never answers */
    },
    async (base) => {
      await assert.rejects(
        usage.httpGet(base + "/", { timeoutMs: 100 }),
        /timed out/,
      );
    },
  );
});
test("certificates are verified except on local development hosts", () => {
  for (const url of [
    "https://localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://demo.ddev.site/",
    "https://demo.localhost/",
    "http://public.test/",
  ])
    assert.equal(
      usage.verifyTls(url) || url.startsWith("http:"),
      url.startsWith("http:"),
      url,
    );
  for (const url of [
    "https://public.test/",
    "https://not-ddev.site/",
    "https://ddev.site.attacker.test/",
  ])
    assert.equal(usage.verifyTls(url), true, url);
});
test("mapLimit bounds concurrency and keeps order", async () => {
  let active = 0,
    peak = 0;
  const out = await usage.mapLimit(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    3,
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((done) => setTimeout(done, 5));
      active--;
      return n * 2;
    },
  );
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.equal(peak, 3);
});

// ---- find-examples ----
test("Site Studio placements are counted by instance uuid, not by element hash", () => {
  const body =
    '<div class="coh-ce-cpt_card-aaaaaa11 coh-component-instance-11111111-aaaa"><p class="coh-ce-cpt_card-bbbbbb22">x</p></div>' +
    '<div class="coh-ce-cpt_card-aaaaaa11 coh-component-instance-22222222-bbbb"></div><div class="coh-ce-cpt_text-cccccc33"></div>';
  const [presence, counts] = examples.scanSitestudio(body);
  assert.deepEqual([...presence].sort(), ["cpt_card", "cpt_text"]);
  assert.deepEqual(counts, { cpt_card: 2 });
  const [names, perName] = examples.scanParagraphs(
    '<div class="paragraph--type--full-width-row"></div><div class="paragraph--type--full-width-row paragraph--type--card"></div>',
  );
  assert.deepEqual([...names].sort(), ["card", "full_width_row"]);
  assert.deepEqual(perName, { full_width_row: 2, card: 1 });
});
test("sitemap walking follows one index level and falls back to the base address", async () => {
  const bodies: Record<string, string> = {
    "https://x.test/sitemap.xml":
      "<sitemapindex><loc>https://x.test/a.xml</loc></sitemapindex>",
    "https://x.test/a.xml":
      "<urlset><loc> https://x.test/1 </loc><loc>https://x.test/2</loc><loc>https://x.test/3</loc></urlset>",
  };
  const fetcher: examples.Fetcher = async (url) =>
    url in bodies ? [200, bodies[url]!] : [404, ""];
  assert.deepEqual(
    await examples.sitemapUrls("https://x.test", 2, 0, fetcher),
    ["https://x.test/1", "https://x.test/2"],
  );
  const logged: string[] = [];
  assert.deepEqual(
    await examples.sitemapUrls(
      "https://y.test",
      5,
      0,
      async () => [404, ""],
      (message) => logged.push(message),
    ),
    ["https://y.test"],
  );
  assert.match(logged[0]!, /no sitemap found at https:\/\/y.test\/sitemap.xml/);
});
test("crawl rehosts addresses, records failures, and the report tiers components", async () => {
  const [url, changed] = examples.canonical(
    "https://origin.acquia-sites.com/a?b=1",
    "www.x.org",
  );
  assert.deepEqual([url, changed], ["https://www.x.org/a?b=1", 1]);
  assert.deepEqual(examples.canonical("https://www.x.org/a", "www.x.org"), [
    "https://www.x.org/a",
    0,
  ]);
  const page =
    '<div class="paragraph--type--card"></div><div class="paragraph--type--card"></div>';
  const result = await examples.crawl(
    ["https://origin.acquia-sites.com/a", "https://www.x.org/missing"],
    "paragraphs",
    0,
    "www.x.org",
    async (fetched) => (fetched.endsWith("/a") ? [200, page] : [404, ""]),
  );
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.failed, [
    { url: "https://www.x.org/missing", status: 404 },
  ]);
  assert.equal(result.rehosted, 1);
  const report = examples.buildReport(result, {
    base: "https://www.x.org",
    strategy: "paragraphs",
    merge: true,
    components: {
      components: [
        { id: "card" },
        { id: "ghost", usage: { structuralRefs: 3 } },
        { id: "nobody" },
      ],
    },
  });
  const [card, ghost, nobody] = report["components"];
  assert.deepEqual(
    [card.usage.tier, card.usage.placements, card.usage.examples[0].marker],
    ["low", 2, "paragraph--type--card"],
  );
  assert.deepEqual(
    [ghost.usage.tier, nobody.usage.tier],
    ["structural only", "unused"],
  );
  assert.match(ghost.usage.note, /not observed on any of the 1 pages/);
  assert.deepEqual(
    [
      report["usageScan"].addressesRehostedOnto,
      report["usageScan"].componentsUnseen,
      report["usageScan"].placementsAreLowerBound,
    ],
    ["www.x.org", ["ghost", "nobody"], true],
  );
  assert.deepEqual(
    [0, 5, 10, 49, 50].map((n) => examples.tier(n)),
    ["unused", "low", "medium", "medium", "high"],
  );
  assert.equal(examples.tier(0, 1), "structural only");
});
test("find-examples verifies certificates even on local hosts", async () => {
  // Unlike the Drupal extractors, this crawler never relaxes TLS; a refused connection is [0, message].
  const [status, message] = await examples.fetchUrl("https://127.0.0.1:1/");
  assert.equal(status, 0);
  assert.ok(message.length > 0);
});
